/**
 * The half of importing that no broker owns.
 *
 * Grouping lots into positions, matching them against what the journal
 * already holds, and turning the survivors into rows — none of it depends on
 * whose report the numbers arrived in. Only the reading of the file does, and
 * that lives in `brokers/`.
 *
 * The seam between them is one shape. A broker adapter produces a flat list of
 * matched lots:
 *
 *   { section, symbol, isin, entryDate, exitDate,
 *     quantity, buyValue, sellValue, charges }
 *
 * and everything here works the same whether that came from Zerodha, Dhan or
 * anyone else. Which means a second broker is a file of column names and date
 * parsing, not a second copy of the reconciliation — and every hard-won rule
 * in here (free shares, split positions, the grow path, conflicts that refuse
 * to guess) is inherited rather than reimplemented.
 */

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * One position per symbol + entry date; every distinct exit date under it
 * becomes a tranche.
 *
 * The report lists a row per matched lot, so a holding sold down over three
 * days arrives as three rows sharing an entry date. Recorded flat they read
 * as three separate trades, each claiming the full entry — which triples the
 * trade count and gives each fragment its own R against a position that was
 * really scaled out of once.
 *
 * Lots sharing an entry AND exit date still merge into a single tranche at
 * the weighted-average price; that pair of days is one decision.
 */
export function groupLots(lots) {
  const positions = new Map();

  for (const l of lots) {
    const pk = `${l.symbol}|${l.entryDate}`;
    if (!positions.has(pk)) {
      positions.set(pk, {
        symbol: l.symbol, isin: l.isin, section: l.section,
        entryDate: l.entryDate,
        quantity: 0, buyValue: 0, sellValue: 0, profit: 0, charges: 0,
        lots: 0, holdingDays: l.holdingDays,
        byExit: new Map(),
      });
    }
    const p = positions.get(pk);
    p.quantity += l.quantity;
    p.buyValue += l.buyValue;
    p.sellValue += l.sellValue;
    p.profit += l.profit;
    p.charges += l.charges;
    p.lots += 1;

    const t = p.byExit.get(l.exitDate) || { quantity: 0, sellValue: 0, charges: 0 };
    t.quantity += l.quantity;
    t.sellValue += l.sellValue;
    t.charges += l.charges;
    p.byExit.set(l.exitDate, t);
  }

  return [...positions.values()]
    .map((p) => {
      const tranches = [...p.byExit.entries()]
        .map(([exitDate, t]) => ({
          exit_date: exitDate,
          quantity: t.quantity,
          price: t.quantity > 0 ? round2(t.sellValue / t.quantity) : NaN,
          charges: round2(t.charges),
        }))
        .sort((a, b) => (a.exit_date < b.exit_date ? -1 : a.exit_date > b.exit_date ? 1 : 0));

      const lastExit = tranches.length ? tranches[tranches.length - 1].exit_date : null;

      return {
        symbol: p.symbol, isin: p.isin, section: p.section,
        entryDate: p.entryDate,
        exitDate: lastExit,          // the date the position finished
        quantity: p.quantity,
        buyValue: p.buyValue, sellValue: p.sellValue,
        profit: p.profit, charges: p.charges,
        lots: p.lots,
        holdingDays: p.holdingDays,
        tranches,
        entryPrice: p.quantity > 0 ? p.buyValue / p.quantity : NaN,
        exitPrice: p.quantity > 0 ? p.sellValue / p.quantity : NaN,
        netProfit: p.profit - p.charges,
        pnlPct: p.buyValue > 0 ? (p.profit / p.buyValue) * 100 : NaN,
        intraday: p.section === "equity - intraday",
        // Keyed on the position, not a fragment of it, so re-importing an
        // overlapping year still recognises what's already here.
        dedupeKey: `${p.symbol}|${p.entryDate}|${lastExit || ""}|${p.quantity}`,
      };
    })
    .sort((a, b) => (a.exitDate < b.exitDate ? -1 : a.exitDate > b.exitDate ? 1 : 0));
}

/* ------------------------------------------------------------------ */
/*  To journal rows                                                    */
/* ------------------------------------------------------------------ */


/**
 * Stop loss is deliberately null. R stays uncomputable until a stop is filled
 * in, which is honest — the report doesn't know what you risked, and a guess
 * would quietly corrupt every statistic built on R.
 */
/**
 * Stop assumed at a fixed distance below entry, or null.
 *
 * Longs only, which is all the equity delivery sections carry. The same figure
 * goes to both columns because at import there is no history of trailing — the
 * stop it opened with is the stop it had.
 */
const assumedStop = (entryPrice, pct) =>
  pct > 0 && entryPrice > 0 ? round2(entryPrice * (1 - pct / 100)) : null;

export function toTradeRows(groups, { batchId, exchange = "NSE", assumeStopPct = 0, broker = null } = {}) {
  return groups.map((g) => {
    const free = isFreeShares(g);
    // No stop on shares that cost nothing. An assumed stop is a percentage
    // below the entry price, and a percentage below zero is zero — risk of
    // zero, which every R figure then divides by.
    const stop = free ? null : assumedStop(round2(g.entryPrice), assumeStopPct);
    return {
    symbol: g.symbol,
    exchange,
    side: "long",
    status: "closed",

    // Which file this came out of, so a later import from a different broker
    // knows this position is not one of its own.
    broker,

    entry_date: g.entryDate,
    // Zero is the truth for a bonus issue, not a missing value: those shares
    // really did cost nothing, so the whole sale price is profit.
    entry_price: free ? 0 : round2(g.entryPrice),
    quantity: g.quantity,
    acquisition: free ? "bonus" : "purchase",
    // Null unless the importer was told to assume one. Inventing a stop by
    // default would make every R figure a guess wearing a measurement's face.
    stop_loss: stop,
    initial_stop_loss: stop,
    stop_source: stop == null ? null : "assumed",

    exit_date: g.exitDate,
    exit_price: round2(g.exitPrice),
    exit_reason: null,
    // Zero, not the total: the same money is itemised per sell in `exits`
    // below, and derivePosition adds trades.charges to the tranche charges.
    // Putting the figure in both places deducts it twice. Attributing it to
    // the sells is also what makes a part-sold position honest — only the
    // costs of sells that have actually happened get counted.
    charges: 0,

    imported: true,
    import_batch: batchId,

    // Written to trade_exits, not to the trade row. The database trigger
    // recomputes status, exit_date and exit_price from these, so the flat
    // columns above are a starting value rather than the final word.
    exits: g.tranches,

    _preview: {
      lots: g.lots,
      tranches: g.tranches.length,
      grossProfit: round2(g.profit),
      netProfit: round2(g.netProfit),
      pnlPct: g.pnlPct,
      intraday: g.intraday,
      holdingDays: g.holdingDays,
      dedupeKey: g.dedupeKey,
      assumedStop: stop,
    },
  };
  });
}

/** Headline figures for the preview screen, before anything is written. */
export function importSummary(groups, { skipped = 0 } = {}) {
  const wins = groups.filter((g) => g.profit > 0);
  const dates = groups.map((g) => g.exitDate).sort();
  const grossPnl = groups.reduce((a, g) => a + g.profit, 0);
  const charges = groups.reduce((a, g) => a + g.charges, 0);

  return {
    trades: groups.length,
    lots: groups.reduce((a, g) => a + g.lots, 0),
    tranches: groups.reduce((a, g) => a + (g.tranches?.length || 1), 0),
    scaledOut: groups.filter((g) => (g.tranches?.length || 1) > 1).length,
    symbols: new Set(groups.map((g) => g.symbol)).size,
    intraday: groups.filter((g) => g.intraday).length,
    winRate: groups.length ? (wins.length / groups.length) * 100 : NaN,
    grossPnl: round2(grossPnl),
    charges: round2(charges),
    netPnl: round2(grossPnl - charges),
    chargesPctOfTurnover:
      groups.reduce((a, g) => a + g.buyValue + g.sellValue, 0) > 0
        ? (charges / groups.reduce((a, g) => a + g.buyValue + g.sellValue, 0)) * 100
        : NaN,
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
    skipped,
  };
}

/**
 * Work out what each group in the file means against the journal as it stands.
 *
 * Matching is on the POSITION — symbol and entry date — not on the whole of
 * symbol|entry_date|exit_date|quantity. Those last two describe how much of it
 * had been sold when a particular file was generated, which is precisely the
 * part that changes between one download and the next. Keying on them meant a
 * position that had been scaled out further since the last import looked like
 * a different trade, so the file inserted a second copy carrying the sells
 * already recorded on the first. That double-counted the P&L, silently.
 *
 * So: find the position, add the sells it hasn't got, leave everything else
 * alone. A hand-entered trade keeps its stop, its thesis and its pattern and
 * simply gets completed. Four outcomes, and only the first two write anything:
 *
 *   fresh        no such position — insert it, as before
 *   completions  it's here, and these sells are missing from it
 *   duplicates   it's here and every sell is already recorded
 *   conflicts    the file and the journal disagree; a human decides
 */
export function reconcile(groups, targets, { broker = null } = {}) {
  /**
   * Two known and different brokers are never the same position.
   *
   * Matching on symbol and entry date alone was right while there was one
   * source, and became a way of merging real positions the moment there were
   * two: the same stock bought the same day through two brokers is routine
   * for anyone with two accounts, and the second import would either skip the
   * position as a duplicate or graft its sells onto the first broker's trade
   * and grow the quantity to fit.
   *
   * An UNKNOWN broker still matches either way, and that is deliberate rather
   * than lax. A trade entered by hand has no broker; the whole point of
   * importing afterwards is to complete it, and a null that refused to match
   * would duplicate it instead.
   */
  const sameBroker = (a, b) => !a || !b || a === b;

  const byPosition = new Map();
  for (const t of targets || []) {
    const k = `${t.symbol}|${t.entry_date}`;
    if (!byPosition.has(k)) byPosition.set(k, []);
    byPosition.get(k).push(t);
  }

  const fresh = [];        // no such position here yet — insert
  const completions = [];  // position is here, these sells are not
  const duplicates = [];   // every sell already recorded
  const conflicts = [];    // needs a human; nothing written

  // Positions this same file has already claimed, so two groups in one file
  // can't both attach to the same journal row.
  const claimed = new Set();

  for (const g of groups) {
    const key = `${g.symbol}|${g.entryDate}`;
    const found = (byPosition.get(key) || [])
      .filter((t) => !claimed.has(t.id))
      .filter((t) => sameBroker(t.broker, broker));

    if (found.length === 0) { fresh.push(g); continue; }

    if (found.length > 1) {
      // Two positions opened in the same symbol on the same day. Guessing
      // which one these sells belong to could put them on the wrong trade,
      // and that is worse than doing nothing.
      conflicts.push({ ...g, reason: `${found.length} trades already start on this date — pick one by hand` });
      continue;
    }

    const target = found[0];
    const have = new Set((target.exits || []).map((e) => e.exit_date));
    const missing = g.tranches.filter((t) => !have.has(t.exit_date));

    if (missing.length === 0) { duplicates.push(g); continue; }

    const already = (target.exits || []).reduce((a, e) => a + Number(e.quantity || 0), 0);
    const adding = missing.reduce((a, t) => a + Number(t.quantity || 0), 0);
    const held = Number(target.quantity);
    let grow = null;

    // More sold than the journal thinks was ever held. For an imported row
    // that is normal rather than wrong: a Tax P&L file reports only the lots
    // matched within its own period, so July's file recorded a 900-share
    // position as 300 because that is all it could see. October's file, with
    // both sells in it, is simply the fuller account — take its numbers.
    //
    // For a position entered by hand the same sum means something else
    // entirely: the file disagrees with a size the trader typed deliberately.
    // Growing that silently would rewrite their record, so it goes to them.
    if (already + adding > held + 1e-6) {
      if (!target.imported) {
        conflicts.push({
          ...g,
          reason: `file sells ${already + adding} but you recorded ${held} — check which is right`,
        });
        continue;
      }
      /**
       * Quantity and entry price move together or not at all.
       *
       * This used to take the largest quantity it had ever seen and pair it
       * with the newest file's average price. Those need not describe the
       * same shares, and when they didn't the position ended up holding more
       * stock than its cost basis accounts for — the exact shape that turns
       * a real entry into a fraction of itself.
       *
       * So: if the file knows about more of this position than the journal
       * does, take its pair. Otherwise keep the pair already recorded.
       */
      const fileQty = Number(g.quantity) || 0;
      const needed = already + adding;
      grow = fileQty >= held && fileQty >= needed
        ? { quantity: fileQty, entry_price: g.entryPrice }
        : { quantity: Math.max(held, needed) };
    }

    claimed.add(target.id);
    completions.push({
      group: g,
      tradeId: target.id,
      tranches: missing,
      // Set only when the earlier import under-recorded the position size.
      grow,
      // For the preview: what is being added, and to what.
      already,
      adding,
      holding: held,
      status: target.status,
      skipped: g.tranches.length - missing.length,
    });
  }

  return { fresh, completions, duplicates, conflicts };
}

/**
 * Shares that arrived at no cost: a bonus issue, a split, an allotment.
 *
 * The report states this plainly as a buy value of 0, and it is a fact about
 * the shares rather than a gap in the file. Treating it as a gap is what made
 * a trader edit the number to get the row through, and a fabricated buy value
 * of 10 across three shares became an entry price of 3.33, a risk of almost
 * nothing, and an R of five thousand.
 *
 * Quantity and a sell still have to be there. Free shares that were never
 * sold have no P&L to record and no reason to be in a journal of trades.
 */
function isFreeShares(g) {
  return g.quantity > 0 && g.exitPrice > 0 && !(g.buyValue > 0);
}

/**
 * A position the journal can't record, held back rather than written.
 *
 * The insert is a single statement and one bad row rolls back the whole file,
 * which is a miserable way to find out about a blank cell.
 *
 * A zero buy value is deliberately NOT one of these. It used to be, and that
 * was the bug: the one thing the file was telling us clearly got read as the
 * one thing it couldn't tell us.
 */
function rejectReason(g) {
  if (!(g.quantity > 0)) return "no quantity";
  if (!(g.exitPrice > 0)) return "no sell value in the file, so no exit price";
  if (!g.entryDate || !g.exitDate) return "missing a date";
  if (!(g.entryPrice > 0) && !isFreeShares(g)) {
    return "no buy value in the file, so no entry price";
  }
  return null;
}


/* ------------------------------------------------------------------ */
/*  One call                                                          */
/* ------------------------------------------------------------------ */

/**
 * Everything after the file has been read.
 *
 * Takes what an adapter produced and returns what the preview renders. The
 * adapter has already decided which rows are equity, what the columns meant
 * and how the dates were written; from here on nothing knows or cares.
 */
export function assembleImport(parsed, { targets, batchId, exchange, assumeStopPct, broker } = {}) {
  const { lots, warnings = [], sectionCounts = {}, missingColumns = [], skippedSections = [] } = parsed;

  const grouped = groupLots(lots);
  const { fresh: matched, completions, duplicates, conflicts } =
    reconcile(grouped, targets, { broker });

  // Kept apart from `conflicts`, which the UI reports separately: a rejected
  // group has a value the journal can't store, and the fix is in the file or
  // in a hand-entered trade. A conflict's numbers are fine — what's missing is
  // a decision only the trader can make.
  const fresh = [];
  const rejected = [];
  for (const g of matched) {
    const reason = rejectReason(g);
    if (reason) rejected.push({ ...g, reason });
    else fresh.push(g);
  }

  return {
    trades: toTradeRows(fresh, { batchId, exchange, assumeStopPct, broker }),
    groups: fresh,
    // Sells to attach to positions already here. Carries the trade id, so
    // these never travel through toTradeRows — there is no new trade to make.
    completions,
    duplicates,
    rejected,
    conflicts,
    // Counted so the preview can say what it did rather than leaving a
    // stopless, R-less trade to be discovered later.
    freeShares: fresh.filter(isFreeShares).length,
    // Named separately from `rejected` because the remedy is different: this
    // is the parser failing to find a column, not the file lacking a value.
    missingColumns,
    summary: importSummary(fresh, { skipped: duplicates.length }),
    sectionCounts,
    skippedSections,
    warnings,
  };
}
