/**
 * Reading a Zerodha Tax P&L export.
 *
 * ONLY the reading. Grouping, reconciliation and row-building moved to
 * `import-pipeline.js` when a second broker appeared on the horizon — none of
 * that ever depended on whose report it was, and copying it per broker would
 * have meant maintaining the free-shares rule, the grow path and the conflict
 * handling four times over.
 *
 * What is genuinely Zerodha's, and would differ for anyone else: which sheet
 * holds the data, what the columns are called, how sections are marked, and
 * how dates and numbers are written.
 *
 * The output is the shape every adapter promises — see import-pipeline.js.
 */

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
 * Stops are left empty unless asked for. A tax report cannot know them, and
 * deriving one from each trade's own loss would put every loser at −1R by
 * construction and report false discipline back at you.
 *
 * What the importer will do, on request, is assume one fixed percentage below
 * entry for every trade. That is a different claim — not "this was your stop"
 * but "here is your record as if you had risked this much each time" — and it
 * is what makes a freshly imported journal show anything at all, since every
 * R figure is blank without a stop. Those rows are written with
 * stop_source: 'assumed' so nothing downstream mistakes the assumption for a
 * measurement; see migration 011.
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
export function findSheet(workbook) {
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

/* ------------------------------------------------------------------ */
/*  The adapter contract                                              */
/* ------------------------------------------------------------------ */

export const id = "zerodha";
export const label = "Zerodha";

/**
 * Does this file look like ours?
 *
 * The sheet name is the tell and it is a strong one — no other broker calls
 * anything "Tradewise Exits". Detection is by evidence in the file rather
 * than by asking the user, because a person who has just downloaded one
 * report should not have to know what shape it is.
 */
/**
 * A "Tradewise" sheet is not enough on its own.
 *
 * IIFL's tax P&L has a sheet called "Tradewise Exists from 20250401" and
 * column headings that match this one field for field — Symbol, ISIN, Entry
 * Date, Exit Date, Quantity, Buy Value, Sell Value, Profit, Period of
 * Holding. All nine. Matching on the sheet name alone, this adapter claimed
 * that file and would have parsed it *successfully*: every trade correct, and
 * every charge zero, because IIFL states none.
 *
 * Which is the dangerous shape of wrong. An imported zero is treated as a
 * fact the broker stated — right for demerged shares that genuinely cost
 * nothing — so the trades would sit there permanently costless, flattering
 * every R, with nothing anywhere saying so. A file that fails to import is a
 * message; a file that imports wrongly is a lie in the journal.
 *
 * So the charge columns decide it. They are what this report has and IIFL's
 * does not, which makes them the actual difference rather than a proxy for
 * it.
 */
export function detect(workbook) {
  const sheet = findSheet(workbook);
  if (!sheet) return false;
  const text = sheetText(workbook, sheet);
  return CHARGE_COLS.some((c) => text.includes(c));
}

/** Cell text straight off the worksheet — detection runs before anything has
 *  decided to load a parser, so it must not need one. */
function sheetText(workbook, name, limit = 400) {
  const ws = workbook?.Sheets?.[name];
  if (!ws) return "";
  const out = [];
  let n = 0;
  for (const ref of Object.keys(ws)) {
    if (ref[0] === "!") continue;
    const v = ws[ref]?.w ?? ws[ref]?.v;
    if (v != null) out.push(String(v));
    if (++n > limit) break;
  }
  return out.join(" | ").toLowerCase();
}

/**
 * Rows in, lots out, plus what could not be read and why.
 *
 * Takes rows rather than the workbook because this report is also offered as
 * CSV, where there are no sheets to choose between.
 */
export function parseRows(rows) {
  const { lots, warnings, sectionCounts, missingColumns } = parseTradewiseRows(rows);
  return {
    lots,
    warnings,
    sectionCounts,
    missingColumns,
    // The adapter names its own sections, so it decides which were skipped.
    skippedSections: Object.entries(sectionCounts)
      .filter(([s]) => !INCLUDED_SECTIONS.includes(s))
      .map(([s, n]) => ({ section: s, rows: n })),
  };
}
