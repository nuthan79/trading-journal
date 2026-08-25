/**
 * ICICI Direct's equity P&L.
 *
 * Downloaded from Portfolio → Equity → P&L Statement as a CSV, which matters
 * for detection: the CSV path in ImportTrades never calls `detectBroker`,
 * because a CSV was Zerodha's alone for as long as only Zerodha offered one.
 * So this module exports `detectRows` as well, and the import screen asks it
 * before falling through to that assumption. Left unasked, an ICICI file would
 * be handed to Zerodha's parser — the failure dhan.js calls out, where an
 * adapter claims a file it cannot read and produces numbers that look right.
 *
 * WHAT THE FILE STATES, AND WHAT IT DOES NOT. Three header lines (account,
 * name, period), one column header, then rows grouped under holding-period
 * headings. Every row is a matched lot: quantity, both dates, both rates, both
 * values and a profit. No charge column anywhere.
 *
 * CHARGES ARE DERIVED, AND THE FILE PROVES THE DERIVATION. Purchase Value is
 * exactly Purchase Rate × Quantity, but Sale Value is NOT Sale Rate × Quantity
 * — it is short by a consistent fraction, and the file's own Profit/Loss is
 * Sale Value − Purchase Value. So the gap is what ICICI deducted:
 *
 *     charges = Sale Rate × Quantity − Sale Value
 *
 * Measured on the two reference exports, that gap is 0.346% of turnover in
 * 2025-26 and 0.892% / 0.893% in 2017-18 — one figure per era, which is
 * brokerage falling over eight years rather than rounding noise, since
 * rounding would scatter. And it reconciles to the paisa on every row:
 * (Sale Rate − Purchase Rate) × Qty − charges equals the stated Profit/Loss
 * exactly, for all three lots across both files. That identity is checked per
 * row below, so a format change is reported rather than absorbed.
 *
 * GROSS VALUES GO OUT, NOT THE FILE'S NET ONES. `import-pipeline` computes
 * exitPrice as sellValue / quantity and netProfit as profit − charges. Handing
 * it ICICI's net Sale Value would put the exit price 0.35% below the price
 * actually traded, and would subtract the charges a second time from a profit
 * that already had them taken out. So `sellValue` here is Sale Rate × Quantity
 * and `profit` is gross; the pipeline subtracts `charges` and arrives back at
 * ICICI's own number.
 *
 * ONLY THE SELL LEG IS IN THE FILE. Purchase Value carries no charges at all,
 * so the buy-side brokerage, stamp duty and GST are simply absent from this
 * report. What imports is therefore an understatement of what the round trip
 * cost — but it is the understatement ICICI itself publishes, and matching the
 * broker's own P&L is worth more here than a computed figure that would
 * disagree with every statement the user has.
 *
 * THE OLD FORMAT IS REFUSED ON PURPOSE. Before ICICI added ISIN, the report
 * named stocks by ICICI's internal codes — `HDFSTA` for HDFC Standard Life,
 * `SHALIM` for Shalimar Paints. Neither is a trading symbol, nothing maps them,
 * and guessing is worse than refusing: `SHALIM` is one fuzzy match away from
 * `SHALIWIR`, Shalimar Wires, a different company entirely. Without the ISIN
 * column there is no honest way to know which security a row is about, so the
 * file is recognised and declined with the reason.
 */

export const id = "icicidirect";
export const label = "ICICI Direct";

/** The export is UTF-8 with a BOM, and nothing upstream strips it — so the
 *  very first cell arrives as "﻿Account" and would fail every match. */
const norm = (v) => String(v ?? "").replace(/^﻿/, "").trim();
const key = (v) => norm(v).toLowerCase().replace(/\s+/g, " ");

function num(v) {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const round2 = (n) => Math.round(n * 100) / 100;

const MONTHS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * `07-Aug-25` → `2025-08-07`.
 *
 * Two-digit years, which need a century. Everything in an equity P&L is after
 * 2000 and nothing in one is in the future, so 00-69 reads as 20xx and 70-99
 * as 19xx — the ordinary pivot, and the wrong half of it can never appear in a
 * file like this.
 *
 * Unreadable returns null and the row is reported rather than guessed. A date
 * read the wrong way round moves a trade into another financial year, which is
 * the one error this file exists to get right.
 */
export function toDate(v) {
  const s = norm(v);
  let m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec(s);
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()];
    if (!mm) return null;
    const yy = Number(m[3]);
    const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
    return `${yyyy}-${mm}-${m[1].padStart(2, "0")}`;
  }
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s);
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()];
    return mm ? `${m[3]}-${mm}-${m[1].padStart(2, "0")}` : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? s : null;
}

/**
 * Holding-period headings, matched by prefix.
 *
 * Both are delivery trades and both are wanted — the split is a tax
 * distinction, not a trading one, and a journal measuring R has no use for it.
 * It is kept as `section` so the import report can say what came from where.
 *
 * ANYTHING ELSE IS COUNTED AND SKIPPED rather than assumed to be delivery. If
 * ICICI ever adds an intraday or speculative block, its rows are not round
 * trips of the kind this app records, and importing them because the heading
 * was unrecognised is how a day trade becomes a swing position.
 */
export const INCLUDED_SECTIONS = ["> 1 year profit/loss", "<= 1 year profit/loss"];

const sectionOf = (text) => {
  const k = key(text);
  if (!k.includes("profit/loss")) return null;
  return INCLUDED_SECTIONS.find((s) => k.startsWith(s)) || k;
};

/** Read from the header row, never by position — the old format has no ISIN
 *  column, so every index after the first would be off by one. */
const COLS = {
  symbol: ["stock symbol"],
  isin: ["isin"],
  quantity: ["quantity", "qty"],
  sellDate: ["sale date"],
  sellRate: ["sale rate"],
  sellValue: ["sale value"],
  buyDate: ["purchase date"],
  buyRate: ["purchase rate"],
  buyValue: ["purchase value"],
  profit: ["profit/loss(-)", "profit/loss", "profit/loss(-) "],
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
  const cells = (row || []).map(key);
  return cells.includes("stock symbol") && cells.includes("sale rate")
      && cells.includes("purchase rate");
};

/**
 * Recognised on the header row alone, because the file never names ICICI.
 *
 * There is no title cell, no sheet name and no branding anywhere in the export
 * — only "Account", "Name", "Equity PL" and the columns. So detection leans on
 * the column vocabulary, and "Sale Rate" beside "Purchase Rate" is ICICI's
 * phrasing: Zerodha says Buy Value and Sell Value, Dhan says Avg. Buy Price.
 * Requiring all three of Stock Symbol, Sale Rate and Purchase Rate together is
 * what keeps it from claiming somebody else's file.
 */
export function detectRows(rows) {
  return (rows || []).some(isHeaderRow);
}

export function findSheet(workbook) {
  const names = workbook?.SheetNames || [];
  for (const n of names) {
    const ws = workbook.Sheets?.[n];
    if (!ws) continue;
    const text = Object.keys(ws)
      .filter((r) => r[0] !== "!")
      .slice(0, 400)
      .map((r) => key(ws[r]?.w ?? ws[r]?.v))
      .join(" | ");
    if (text.includes("stock symbol") && text.includes("sale rate")) return n;
  }
  return names[0] || null;
}

export function detect(workbook) {
  const sheet = findSheet(workbook);
  if (!sheet) return false;
  const ws = workbook.Sheets?.[sheet];
  const text = Object.keys(ws || {})
    .filter((r) => r[0] !== "!")
    .slice(0, 400)
    .map((r) => key(ws[r]?.w ?? ws[r]?.v))
    .join(" | ");
  return text.includes("stock symbol") && text.includes("sale rate")
      && text.includes("purchase rate");
}

export function parseRows(rows) {
  const lots = [];
  const warnings = [];
  const sectionCounts = {};

  let section = null;
  let cols = null;
  let sawIsinColumn = false;

  (rows || []).forEach((row, i) => {
    if (!Array.isArray(row)) return;
    const cells = row.map((c) => norm(c)).filter(Boolean);
    if (!cells.length) return;

    if (isHeaderRow(row)) {
      cols = headerMap(row);
      if (cols.isin !== undefined) sawIsinColumn = true;
      return;
    }

    // Headings occupy the first cell with the rest of the row empty; a trade
    // row always has a sale date beside it.
    if (cells.length === 1) {
      const head = sectionOf(cells[0]);
      if (head) { section = head; return; }
      return;                       // account / name / period lines
    }
    if (!cols) return;

    const symbol = norm(row[cols.symbol]);
    if (!symbol || key(symbol) === "stock symbol") return;
    // Totals lines carry no dates and would otherwise read as a trade.
    if (!norm(row[cols.sellDate])) return;

    const sec = section || "unlabelled";
    sectionCounts[sec] = (sectionCounts[sec] || 0) + 1;
    if (!INCLUDED_SECTIONS.includes(sec)) return;

    const entryDate = toDate(row[cols.buyDate]);
    const exitDate = toDate(row[cols.sellDate]);
    const quantity = num(row[cols.quantity]);

    if (!quantity || !entryDate || !exitDate) {
      warnings.push(
        `Row ${i + 1} (${symbol}): skipped — ${!quantity ? "no quantity"
          : !entryDate ? "unreadable purchase date" : "unreadable sale date"}.`
      );
      return;
    }

    const sellRate = num(row[cols.sellRate]);
    const buyValue = num(row[cols.buyValue]);
    const statedSellValue = num(row[cols.sellValue]);
    const statedProfit = num(row[cols.profit]);

    // Gross, so the exit price the pipeline derives is the price traded.
    const sellValue = round2(sellRate * quantity);
    let charges = round2(sellValue - statedSellValue);

    /**
     * The identity that says this reading is still correct.
     *
     * Gross profit minus the derived charge must be the file's own
     * Profit/Loss. It holds to the paisa on every reference row, so a
     * disagreement means the format moved — Sale Value became gross, or a
     * charge moved to the buy leg — and the honest response is to say so on
     * that row rather than import a number nobody can reconcile against their
     * statement.
     */
    const grossProfit = round2(sellValue - buyValue);
    const drift = round2(grossProfit - charges - statedProfit);
    if (Math.abs(drift) > 0.02) {
      warnings.push(
        `Row ${i + 1} (${symbol}): the stated profit is ${statedProfit} but sale ` +
        `rate × quantity less sale value gives ${round2(grossProfit - charges)}. ` +
        `Charges imported as ${charges}, which may be wrong — check this trade.`
      );
    }
    if (charges < 0) {
      warnings.push(
        `Row ${i + 1} (${symbol}): sale value is above sale rate × quantity, so no ` +
        `charge could be worked out. Imported with none.`
      );
      charges = 0;
    }

    lots.push({
      section: sec,
      symbol,                       // a label; the ISIN is the key
      isin: cols.isin !== undefined ? norm(row[cols.isin]) : "",
      entryDate,
      exitDate,
      quantity,
      buyValue,
      sellValue,
      profit: grossProfit,
      charges,
      holdingDays: null,
    });
  });

  /**
   * No ISIN column means the pre-2018 layout, whose symbols are ICICI's own
   * codes. Refused rather than imported: see the head of this file.
   */
  if (!sawIsinColumn && lots.length) {
    return {
      lots: [],
      warnings: [
        "This is ICICI Direct's older P&L format, which names stocks by ICICI's " +
        "internal codes rather than trading symbols — HDFSTA for HDFC Standard " +
        "Life, SHALIM for Shalimar Paints — and carries no ISIN to resolve them. " +
        "Guessing would file trades under the wrong company, so nothing has been " +
        "imported. Re-download the statement from ICICI Direct; the current " +
        "export includes an ISIN column and reads fine.",
      ],
      sectionCounts,
      chargesStated: false,
      missingColumns: ["ISIN"],
      skippedSections: [],
    };
  }

  return {
    lots,
    warnings,
    sectionCounts,
    // Worked out from sale rate against sale value, not read off a column.
    chargesStated: false,
    missingColumns: [],
    skippedSections: Object.entries(sectionCounts)
      .filter(([s]) => !INCLUDED_SECTIONS.includes(s))
      .map(([s, n]) => ({ section: s, rows: n })),
  };
}
