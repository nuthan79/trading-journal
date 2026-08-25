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
 * CHARGES ARE DERIVED, AND THE TWO RATE COLUMNS ARE WHAT MAKE IT POSSIBLE.
 * There is no charge column, but both Rates are prices traded while both
 * Values are the cash that actually moved. So each leg's cost is the gap
 * between them:
 *
 *     charges = (Purchase Value − Purchase Rate × Qty)     the buy leg
 *             + (Sale Rate × Qty − Sale Value)             the sell leg
 *
 * You pay charges on top of a purchase and have them taken out of a sale,
 * which is why the buy gap is positive above the rate and the sell gap
 * positive below it. Checked across every row of two reference exports: the
 * stated Profit/Loss is always Sale Value − Purchase Value, so gross profit
 * less the two gaps reproduces ICICI's own number to the paisa on all 18.
 *
 * THE BUY LEG WAS MISSED AT FIRST, off a single reference row where Purchase
 * Value happened to equal rate × quantity — from which buy-side charges looked
 * absent from the report altogether. They are not; they simply are not on
 * every lot. An FY2024-25 export hides ₹253.95 inside one HDFCLIFE row and
 * nothing inside the next, ₹321.92 across the file. Reading Purchase Value as
 * the cost put that money into the ENTRY PRICE instead — 368.46 for shares
 * bought at 365.20 — where it silently shifted R and never appeared as a cost
 * at all.
 *
 * GROSS VALUES GO OUT, NOT THE FILE'S NET ONES. `import-pipeline` computes
 * entryPrice and exitPrice as value / quantity, and netProfit as profit −
 * charges. So both values here are rate × quantity: the prices that reach the
 * journal are the prices traded, both legs' charges land in `charges` where
 * the app can see them, and the pipeline subtracts them to arrive back at
 * ICICI's own figure.
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

    const buyRate = num(row[cols.buyRate]);
    const sellRate = num(row[cols.sellRate]);
    const statedBuyValue = num(row[cols.buyValue]);
    const statedSellValue = num(row[cols.sellValue]);
    const statedProfit = num(row[cols.profit]);

    /**
     * Both Rates are prices traded; both Values are the cash that moved.
     *
     * Gross either side, so the entry and exit prices the pipeline derives are
     * the prices actually paid and received, and BOTH legs' charges land in
     * `charges` where the app can see them.
     *
     * Read the other way round at first, off a single reference row where
     * Purchase Value happened to equal rate x quantity — from which buy-side
     * charges looked absent from the report entirely. They are not. On a
     * fuller file some lots carry them and some do not: an FY2024-25 export
     * hides 253.95 inside one HDFCLIFE row's Purchase Value and nothing inside
     * the next, and taking the stated value as the cost put that 253.95 into
     * the entry price instead — 368.46 for shares bought at 365.20.
     */
    const buyValue = buyRate > 0 ? round2(buyRate * quantity) : statedBuyValue;
    const sellValue = round2(sellRate * quantity);
    const buyCharges = round2(statedBuyValue - buyValue);
    const sellCharges = round2(sellValue - statedSellValue);
    let charges = round2(buyCharges + sellCharges);

    const grossProfit = round2(sellValue - buyValue);

    /**
     * The file's own columns must agree with each other.
     *
     * Gross-minus-charges reducing to the stated profit is now true by
     * construction — the charge is defined as the two gaps — so checking it
     * would check nothing. What is still worth asserting is ICICI's internal
     * consistency: Profit/Loss should be Sale Value less Purchase Value. If
     * that ever stops holding, the two Value columns no longer mean what this
     * parser reads them as, and every charge derived from them is wrong.
     */
    const statedDrift = round2(statedSellValue - statedBuyValue - statedProfit);
    if (Math.abs(statedDrift) > 0.02) {
      warnings.push(
        `Row ${i + 1} (${symbol}): the file states a profit of ${statedProfit}, but ` +
        `its own sale value less purchase value is ` +
        `${round2(statedSellValue - statedBuyValue)}. Charges may be wrong on this ` +
        `trade — check it against your statement.`
      );
    }

    /**
     * A charge is a cost. Negative means a Value column moved to the other
     * side of its Rate, which is a format change rather than a rebate.
     */
    if (buyCharges < -0.02 || sellCharges < -0.02) {
      warnings.push(
        `Row ${i + 1} (${symbol}): worked out a negative charge ` +
        `(buy ${buyCharges}, sell ${sellCharges}), so this trade imported with none. ` +
        `Its purchase or sale value sits on the wrong side of the rate.`
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
