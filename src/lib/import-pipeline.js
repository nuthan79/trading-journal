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

  let fresh = [];          // no such position here yet — insert
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
      /**
       * A trade with no broker is claimed by the first file that completes it.
       *
       * Null matches anything, which is what lets an import finish a position
       * typed in by hand. Left null afterwards it goes on matching anything —
       * so a Zerodha file could complete it today and a Dhan file add ITS
       * sells to the same position tomorrow, and one trade would end up
       * holding two brokers' exits. Verified before this existed.
       *
       * Stamping records which file claimed it and changes nothing the trader
       * wrote: not the size, not the entry, not the stop. It only stops the
       * position being a magnet for every import that follows.
       */
      claimsBroker: !target.broker && !!broker ? broker : null,
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

  /**
   * AN INVENTED DATE IS CORRECTED BY THE FILE THAT KNOWS THE REAL ONE.
   *
   * A holdings file creates a complete position and has no purchase date, so
   * it invents one and flags it `assumed` (036). A tradebook can sometimes say
   * what the date really was — but only when it accounts for every share, and
   * a position built over several buys usually has at least one of them before
   * the file's window, so it stays assumed. That is the honest answer and it
   * leaves the date wrong.
   *
   * The tax P&L that arrives when the position is finally sold DOES carry the
   * real buy date, per lot. Matching on symbol AND date can never see it — the
   * date it is matching against is the invented one — so the sells landed on a
   * brand-new trade and the holding stayed open forever beside them.
   *
   * So an assumed date does not participate in matching. Symbol alone is
   * enough here, and only here: the date being matched is one this app made up,
   * so there is no fact to overwrite and nothing the trader chose. Adopting it
   * corrects the date and clears the flag, which is what makes the correction
   * count everywhere — `calc.js` and `positions.js` both refuse to measure a
   * holding period from an assumed date.
   *
   * ALL the file's groups for that symbol adopt the SAME position, because a
   * holding bought over N days appears in a tax P&L as N groups keyed by their
   * own buy dates, and letting the first claim the position would send the
   * rest back to being new trades — the very duplicate this removes. The
   * earliest of those dates wins, matching what the tradebook path chose for
   * the same question and for the same reason: it is the day a trader means by
   * "I have held this since".
   *
   * TWO of them in one symbol and it does nothing. Which position a sell came
   * out of is then a real question, and guessing it would put a year of
   * holding on the wrong row. Those fall through to the warning below.
   */
  const adoptable = new Map();
  for (const t of targets || []) {
    if (t.status === "closed") continue;
    if (t.entry_date_source !== "assumed") continue;
    if (claimed.has(t.id)) continue;
    const k = String(t.symbol || "").toUpperCase();
    if (!adoptable.has(k)) adoptable.set(k, []);
    adoptable.get(k).push(t);
  }

  const bySymbol = new Map();
  for (const g of fresh) {
    const k = String(g.symbol || "").toUpperCase();
    if (!bySymbol.has(k)) bySymbol.set(k, []);
    bySymbol.get(k).push(g);
  }

  const adopted = new Set();
  for (const [symbol, gs] of bySymbol) {
    const cands = (adoptable.get(symbol) || []).filter((t) => sameBroker(t.broker, broker));
    if (cands.length !== 1) continue;
    const target = cands[0];

    const have = new Set((target.exits || []).map((e) => e.exit_date));
    const tranches = [];
    let skipped = 0;
    for (const g of gs) {
      for (const tr of g.tranches) {
        if (have.has(tr.exit_date)) { skipped++; continue; }
        tranches.push(tr);
      }
    }
    if (!tranches.length) continue;

    const already = (target.exits || []).reduce((a, e) => a + Number(e.quantity || 0), 0);
    const adding = tranches.reduce((a, t) => a + Number(t.quantity || 0), 0);
    const holdV = Number(target.quantity);
    /* Same rule as an exact match, and it reaches the same place: a holdings
       row is `imported`, so a file showing more shares than the holdings
       snapshot knew about corrects the size rather than stopping. */
    let grow = null;
    if (already + adding > holdV + 1e-6) {
      if (!target.imported) continue;   // hand-typed size — leave it to the warning
      const fileQty = gs.reduce((a, g) => a + (Number(g.quantity) || 0), 0);
      const needed = already + adding;
      grow = fileQty >= holdV && fileQty >= needed
        /* The price travels with the quantity only when ONE group accounts
           for the whole position. Across several buys each group has its own
           price for its own lots, and picking any of them — or averaging
           them here — would describe different shares than the quantity
           does. The holdings file's average is a real broker figure for the
           real position, so it stays. */
        ? { quantity: fileQty, ...(gs.length === 1 ? { entry_price: gs[0].entryPrice } : {}) }
        : { quantity: Math.max(holdV, needed) };
    }

    const to = gs.reduce((a, g) => (!a || g.entryDate < a ? g.entryDate : a), null);
    claimed.add(target.id);
    for (const g of gs) adopted.add(g);
    completions.push({
      group: gs[0],
      groups: gs,
      tradeId: target.id,
      tranches,
      claimsBroker: !target.broker && !!broker ? broker : null,
      grow,
      /* What the writer acts on: the date to take, and the flag to clear. */
      adopts: { from: target.entry_date, to, buys: gs.length },
      already,
      adding,
      holding: holdV,
      status: target.status,
      skipped,
    });
  }
  if (adopted.size) fresh = fresh.filter((g) => !adopted.has(g));

  /**
   * A POSITION YOU STILL HOLD, UNDER A DIFFERENT ENTRY DATE.
   *
   * Matching is exact on symbol AND entry date, so a buy date typed as the
   * 12th when the contract note says the 11th does not match — and the group
   * is inserted as a new trade beside the one already there. The trader is
   * left with two rows for one position: a closed one that is right, and an
   * open one that stays open forever, holding stock they no longer own.
   *
   * Nothing here changes what gets written. Merging on symbol alone would be
   * wrong — buying the same stock twice on different days is ordinary — and
   * silently rewriting a date the trader typed is not the import's decision to
   * make. So this only says what it sees, and the correction stays a hand
   * edit: fix the entry date, import again, and the sells attach.
   *
   * Only OPEN and part-sold positions qualify. A closed trade with a different
   * entry date is far more likely to be a genuinely earlier round-trip in the
   * same name, and flagging those would bury the real finding in noise.
   *
   * Computed after the loop so `claimed` is final — a target another group in
   * this same file legitimately completed is not a near miss.
   */
  const stillOpen = new Map();
  for (const t of targets || []) {
    if (t.status === "closed") continue;
    if (!stillOpen.has(t.symbol)) stillOpen.set(t.symbol, []);
    stillOpen.get(t.symbol).push(t);
  }

  const flagged = fresh.map((g) => {
    const open = (stillOpen.get(g.symbol) || [])
      .filter((t) => !claimed.has(t.id))
      // The same broker test the matching uses. Two accounts holding the same
      // stock is not a near miss, it is two positions.
      .filter((t) => sameBroker(t.broker, broker))
      .filter((t) => t.entry_date !== g.entryDate);
    if (!open.length) return g;
    return {
      ...g,
      openElsewhere: open.map((t) => ({
        id: t.id, entry_date: t.entry_date, quantity: t.quantity, status: t.status,
      })),
    };
  });

  return { fresh: flagged, completions, duplicates, conflicts };
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
  const { lots, warnings = [], notes = [], sectionCounts = {}, missingColumns = [], skippedSections = [] } = parsed;

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
    /* Groups that WILL be inserted, next to a position of the same name the
       journal still has open. Drawn from `fresh` rather than reconcile's, so a
       group held back as rejected is not warned about — nothing is written for
       it, so it cannot duplicate anything. */
    nearMisses: fresh.filter((g) => g.openElsewhere?.length),
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
    /**
     * Advisories, kept apart from `warnings`.
     *
     * `warnings` means a row was skipped, and the screen says so in those
     * words. Groww's charge reconciliation is not that — nothing was lost, the
     * computed total simply disagrees with the file's own — and it was being
     * reported as "1 row unreadable, skipped before anything was matched",
     * which is a claim of data loss that did not happen.
     */
    notes,
  };
}
