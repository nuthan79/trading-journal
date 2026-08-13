/**
 * Dhan's tax P&L.
 *
 * A genuine BIFF8 `.xls` rather than the xlsx everyone else sends, which
 * matters not at all here — SheetJS reads both and hands this module rows
 * either way.
 *
 * WHAT IT GIVES THAT GROWW DOES NOT is a stated charge per trade: a
 * `Total Charges` column on every row. So unlike Groww, nothing is computed —
 * the figure is imported as the fact it is, and `charges_auto` stays false so
 * that nothing ever recalculates over the top of it.
 *
 * WHAT IT DOES NOT GIVE, like every tax report, is a symbol. Only a security
 * name and an ISIN, and the names are not symbols: "Route Mobile" is `ROUTE`
 * and "Godfrey Phillips" is `GODFRYPHLP`. ISIN is the key; the name is a
 * label.
 *
 * MULTI-YEAR FILES ARE NOT A SPECIAL CASE. Dhan will produce a report for any
 * range, and the reference file spans January 2024 to August 2026 — three
 * financial years. Every row carries its own buy and sell date, so nothing
 * here needs the header's range, and reading it would be actively wrong: a
 * Route Mobile lot in that file was bought in July 2023, before the report's
 * own start. The range describes sells, not trades.
 */

export const id = "dhan";
export const label = "Dhan";

const norm = (v) => String(v ?? "").trim();
const key = (v) => norm(v).toLowerCase().replace(/\s+/g, " ");

/**
 * Sections, matched by prefix rather than equality.
 *
 * "Equity Segment - Free Holdings from 01-01-2024 to 13-08-2026" carries the
 * report's date range in its own heading, so an exact match would miss it and
 * the rows beneath would be read as whatever section came before — which is
 * the worst kind of failure available here, since Free Holdings are OPEN
 * positions with no sell date and would arrive as closed trades sold for
 * nothing.
 */
export const INCLUDED_SECTIONS = [
  "equity segment - short term",
  "equity segment - long term",
];

export const EXCLUDED_SECTIONS = [
  "equity segment - intraday / speculation",
  "equity segment - open sell",
  "equity segment - free holdings",
];

const sectionOf = (text) => {
  const k = key(text);
  return [...INCLUDED_SECTIONS, ...EXCLUDED_SECTIONS].find((s) => k.startsWith(s)) || null;
};

function num(v) {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** `21-02-2025` → `2025-02-21`. Day-first, fixed by the report rather than by
 *  a locale. Unreadable returns null and the row is reported, never guessed —
 *  a date read the wrong way round moves a trade to another financial year. */
export function toDate(v) {
  const s = norm(v);
  let m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  return null;
}

export function findSheet(workbook) {
  const names = workbook?.SheetNames || Object.keys(workbook || {});
  return names.find((n) => key(n) === "equity") || null;
}

/**
 * Two pieces of evidence, as with Groww.
 *
 * An "Equity" sheet alone proves nothing — plenty of brokers have one. The
 * file names Dhan in its own text, and pairing that with the section headings
 * this parser depends on means detection fails rather than half-succeeds if
 * the report is ever restructured.
 */
export function detect(workbook) {
  const sheet = findSheet(workbook);
  if (!sheet) return false;
  const text = sheetText(workbook, sheet);
  return text.includes("dhan") && text.includes("equity segment");
}

/** Cell text straight off the worksheet, so detection costs no spreadsheet
 *  library — see the same note in groww.js. */
function sheetText(workbook, name, limit = 600) {
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

/** Read from the header row, never by position. Dhan repeats the same header
 *  under every section, and a fixed index would move silently if a column
 *  were ever inserted. */
const COLS = {
  name: ["security name"],
  isin: ["isin"],
  buyDate: ["buy date"],
  buyQty: ["buy qty.", "buy qty"],
  buyPrice: ["avg. buy price", "avg buy price"],
  buyValue: ["buy value"],
  sellDate: ["sell date"],
  sellQty: ["sell qty.", "sell qty"],
  sellPrice: ["avg. sell price", "avg sell price"],
  sellValue: ["sell value"],
  holding: ["holding period"],
  profit: ["gross p&l"],
  charges: ["total charges"],
};

function headerMap(row) {
  const map = {};
  row.forEach((cell, i) => {
    const k = key(cell);
    for (const [field, names] of Object.entries(COLS)) {
      if (names.includes(k)) map[field] = i;
    }
  });
  return map;
}

const isHeaderRow = (row) => {
  const cells = row.map(key);
  return cells.includes("isin") && cells.includes("buy date");
};

export function parseRows(rows) {
  const lots = [];
  const warnings = [];
  const sectionCounts = {};

  let section = null;
  let cols = null;

  rows.forEach((row, i) => {
    if (!Array.isArray(row)) return;
    const cells = row.map((c) => norm(c)).filter(Boolean);
    if (!cells.length) return;

    const head = sectionOf(cells[0]);
    if (head) { section = head; cols = null; return; }
    if (isHeaderRow(row)) { cols = headerMap(row); return; }
    if (!section || !cols) return;

    // "Sub total" and similar summary lines carry no ISIN and would otherwise
    // be read as a trade with no security.
    const isin = norm(row[cols.isin]);
    if (!isin) return;

    sectionCounts[section] = (sectionCounts[section] || 0) + 1;
    if (!INCLUDED_SECTIONS.includes(section)) return;

    const entryDate = toDate(row[cols.buyDate]);
    const exitDate = toDate(row[cols.sellDate]);
    const quantity = num(row[cols.sellQty]) || num(row[cols.buyQty]);

    if (!quantity || !entryDate || !exitDate) {
      warnings.push(
        `Row ${i + 1}: skipped — ${!quantity ? "no quantity"
          : !entryDate ? "unreadable buy date" : "unreadable sell date"}.`
      );
      return;
    }

    const buyValue = num(row[cols.buyValue]);
    const sellValue = num(row[cols.sellValue]);

    lots.push({
      section,
      symbol: norm(row[cols.name]),   // a label; ISIN is the key
      isin,
      entryDate,
      exitDate,
      quantity,
      buyValue,
      sellValue,
      profit: num(row[cols.profit]) || sellValue - buyValue,
      /**
       * Stated by the broker, so imported rather than computed.
       *
       * A zero here is left alone deliberately. Shares from a demerger carry
       * an apportioned cost and no brokerage, so a zero from this column came
       * from Dhan and is the truth — LTI, NLSL, TRANSINDIA and
       * ALLCARGOTERMINALS all sit at zero for exactly that reason.
       */
      charges: num(row[cols.charges]),
      holdingDays: num(row[cols.holding]) || null,
    });
  });

  return {
    lots,
    warnings,
    sectionCounts,
    missingColumns: [],
    skippedSections: Object.entries(sectionCounts)
      .filter(([s]) => !INCLUDED_SECTIONS.includes(s))
      .map(([s, n]) => ({ section: s, rows: n })),
    // Stated, not worked out — the import screen says so, and nothing
    // downstream should recalculate over them.
    chargesComputed: false,
  };
}
