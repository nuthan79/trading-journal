/**
 * Zerodha Tax P&L import.
 *
 * WHY THIS FILE AND NOT THE TRADEBOOK
 *
 * The Tax P&L report has already matched every entry to its exit and itemised
 * every charge — brokerage, exchange fees, IPFT, SEBI, GST, stamp duty, STT.
 * So there is no FIFO reconstruction to do and no charges to estimate: the
 * real numbers are in the file.
 *
 * WHAT IT DOES NEED
 *
 * The report splits a single position across one row per matched lot. In a
 * real export, 441 rows collapsed to 26 trades — one holding produced 23 rows
 * across three exit days. So the whole job here is grouping.
 *
 * The grouping rule: symbol + entry date + exit date. Everything filled on the
 * same pair of days is one trade at the weighted-average price. Tested against
 * the stricter alternative of one position per entry with exits as tranches,
 * the difference was 57.7% versus 57.9% win rate on identical P&L — not worth
 * the complexity.
 *
 * Stops are left empty. A tax report cannot know them, and inventing one from
 * the losses would make every loser land near -1R by construction, which would
 * then report false discipline back at you.
 */

/* ------------------------------------------------------------------ */
/*  What to take                                                       */
/* ------------------------------------------------------------------ */

/** Swing and intraday equity. Everything else in the report is a different game. */
export const INCLUDED_SECTIONS = [
  "equity - intraday",
  "equity - short term",
  "equity - long term",
];

export const EXCLUDED_SECTIONS = [
  "equity - buyback", "debt etf", "mutual funds",
  "f&o", "currency", "commodity",
];

const norm = (v) => String(v ?? "").trim();
const key = (v) => norm(v).toLowerCase().replace(/\s+/g, " ");

/** Column labels in the header row, matched loosely in case Zerodha renames one. */
const COLS = {
  symbol: ["symbol"],
  isin: ["isin"],
  entryDate: ["entry date"],
  exitDate: ["exit date"],
  quantity: ["quantity", "qty"],
  buyValue: ["buy value"],
  sellValue: ["sell value"],
  profit: ["profit"],
  holding: ["period of holding"],
};

/** Every charge column. Summed to give the real cost of the trade. */
const CHARGE_COLS = [
  "brokerage", "exchange transaction charges", "ipft", "sebi charges",
  "cgst", "sgst", "igst", "stamp duty", "stt",
];

function num(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Excel dates arrive as strings, Date objects or serial numbers depending on the reader. */
export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);

  const s = norm(v);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmy) {
    let [, a, b, y] = dmy;
    if (y.length === 2) y = String(2000 + Number(y));
    const day = Number(a) > 12 ? a : Number(b) > 12 ? b : a;
    const month = day === a ? b : a;
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // Excel serial: days since 1899-12-30
  const serial = Number(s);
  if (Number.isFinite(serial) && serial > 20000 && serial < 60000) {
    return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Finding the data inside the sheet                                  */
/* ------------------------------------------------------------------ */

/**
 * The sheet name carries the report start date, so match on the stem.
 * Accepts a SheetJS workbook or a plain { name: rows } map.
 */
export function findTradewiseSheet(workbook) {
  const names = workbook.SheetNames || Object.keys(workbook);
  return (
    names.find((n) => key(n).startsWith("tradewise exit")) ||
    names.find((n) => key(n).includes("tradewise")) ||
    null
  );
}

function headerMap(row) {
  const map = {};
  row.forEach((cell, i) => {
    const k = key(cell);
    if (!k) return;
    for (const [field, labels] of Object.entries(COLS)) {
      if (map[field] === undefined && labels.some((l) => k === l || k.startsWith(l))) {
        map[field] = i;
      }
    }
    if (CHARGE_COLS.some((c) => k === c || k.startsWith(c))) {
      (map.charges ||= []).push(i);
    }
  });
  return map;
}

const isSectionHeading = (row) => {
  // A heading is one populated cell of text with nothing beside it
  const filled = row.map((c, i) => [c, i]).filter(([c]) => norm(c) !== "");
  if (filled.length !== 1) return null;
  const [value] = filled[0];
  const k = key(value);
  if (!k || k.length > 40) return null;
  if (INCLUDED_SECTIONS.includes(k) || EXCLUDED_SECTIONS.includes(k)) return k;
  return null;
};

/* ------------------------------------------------------------------ */
/*  Parse                                                              */
/* ------------------------------------------------------------------ */

/**
 * `rows` is a 2D array of cell values. Client metadata at the top of the
 * report — name, PAN, client id — is skipped rather than read; the importer
 * has no use for it.
 */
export function parseTradewiseRows(rows) {
  const lots = [];
  const warnings = [];
  const sectionCounts = {};
  // Columns the header row didn't yield. Distinguishing this from bad data
  // matters: an unmatched "Buy Value" header zeroes the price on every row
  // beneath it, and skipping those quietly would discard a whole good file.
  const missingColumns = new Set();

  let section = null;
  let map = null;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];

    const heading = isSectionHeading(row);
    if (heading) { section = heading; map = null; continue; }

    // A header row resets the column mapping for the section beneath it
    if (row.some((c) => key(c) === "symbol")) {
      map = headerMap(row);
      if (INCLUDED_SECTIONS.includes(section)) {
        for (const col of ["buyValue", "sellValue", "quantity", "entryDate", "exitDate"]) {
          if (map[col] === undefined) missingColumns.add(col);
        }
      }
      continue;
    }

    if (!section || !map || map.symbol === undefined) continue;

    const symbol = norm(row[map.symbol]).toUpperCase();
    if (!symbol || key(symbol) === "symbol") continue;

    sectionCounts[section] = (sectionCounts[section] || 0) + 1;
    if (!INCLUDED_SECTIONS.includes(section)) continue;

    const entryDate = toDate(row[map.entryDate]);
    const exitDate = toDate(row[map.exitDate]);
    const quantity = num(row[map.quantity]);

    if (!entryDate || !exitDate) {
      warnings.push(`${symbol}: row ${r + 1} has no usable dates — skipped`);
      continue;
    }
    if (!(quantity > 0)) {
      warnings.push(`${symbol}: row ${r + 1} has no quantity — skipped`);
      continue;
    }

    lots.push({
      section,
      symbol,
      isin: map.isin !== undefined ? norm(row[map.isin]) : "",
      entryDate,
      exitDate,
      quantity,
      buyValue: num(row[map.buyValue]),
      sellValue: num(row[map.sellValue]),
      profit: num(row[map.profit]),
      holdingDays: map.holding !== undefined ? num(row[map.holding]) : null,
      charges: (map.charges || []).reduce((a, i) => a + num(row[i]), 0),
    });
  }

  return { lots, warnings, sectionCounts, missingColumns: [...missingColumns] };
}

/* ------------------------------------------------------------------ */
/*  Group into trades                                                  */
/* ------------------------------------------------------------------ */

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

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Stop loss is deliberately null. R stays uncomputable until a stop is filled
 * in, which is honest — the report doesn't know what you risked, and a guess
 * would quietly corrupt every statistic built on R.
 */
export function toTradeRows(groups, { batchId, exchange = "NSE" } = {}) {
  return groups.map((g) => ({
    symbol: g.symbol,
    exchange,
    side: "long",
    status: "closed",

    entry_date: g.entryDate,
    entry_price: round2(g.entryPrice),
    quantity: g.quantity,
    stop_loss: null,

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
    },
  }));
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
 * Drop anything already in the journal.
 *
 * The report only covers one financial year, so importing several files is
 * normal and overlap is expected — a position entered in March and exited in
 * April appears in both years' reports.
 */
export function dedupe(groups, existingKeys) {
  const seen = new Set(existingKeys || []);
  const fresh = [];
  const duplicates = [];
  for (const g of groups) {
    if (seen.has(g.dedupeKey)) duplicates.push(g);
    else { seen.add(g.dedupeKey); fresh.push(g); }
  }
  return { fresh, duplicates };
}

export const dedupeKeyFor = (t) =>
  `${t.symbol}|${t.entry_date}|${t.exit_date}|${t.quantity}`;

/* ------------------------------------------------------------------ */
/*  One call                                                           */
/* ------------------------------------------------------------------ */

/**
 * A position the journal can't record. `trades` requires a positive entry
 * price and quantity, so a group that can't produce one has to be held back —
 * the insert is a single statement and one bad row rolls back the entire
 * file, which is a miserable way to find out about a blank cell.
 */
function rejectReason(g) {
  if (!(g.quantity > 0)) return "no quantity";
  if (!(g.entryPrice > 0)) return "no buy value in the file, so no entry price";
  if (!(g.exitPrice > 0)) return "no sell value in the file, so no exit price";
  if (!g.entryDate || !g.exitDate) return "missing a date";
  return null;
}

export function parseZerodhaTaxPnl(rows, { existingKeys, batchId, exchange } = {}) {
  const { lots, warnings, sectionCounts, missingColumns } = parseTradewiseRows(rows);
  const grouped = groupLots(lots);
  const { fresh: deduped, duplicates } = dedupe(grouped, existingKeys);

  const fresh = [];
  const rejected = [];
  for (const g of deduped) {
    const reason = rejectReason(g);
    if (reason) rejected.push({ ...g, reason });
    else fresh.push(g);
  }

  const skippedSections = Object.entries(sectionCounts)
    .filter(([s]) => !INCLUDED_SECTIONS.includes(s))
    .map(([s, n]) => ({ section: s, rows: n }));

  return {
    trades: toTradeRows(fresh, { batchId, exchange }),
    groups: fresh,
    duplicates,
    rejected,
    // Named separately from `rejected` because the remedy is different: this
    // is the parser failing to find a column, not the file lacking a value.
    missingColumns,
    summary: importSummary(fresh, { skipped: duplicates.length }),
    sectionCounts,
    skippedSections,
    warnings,
  };
}
