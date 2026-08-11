/**
 * Zerodha's tradebook — the file that knows what you still hold.
 *
 * WHY A SECOND ZERODHA ADAPTER. The tax P&L in `zerodha.js` covers closed
 * trades by definition, so importing one leaves somebody staring at an empty
 * Holdings page while actually holding stock. The tradebook is the only export
 * carrying open positions WITH the date they were opened, which is what makes
 * an entry price and a holding period possible at all.
 *
 * THE TWO DO NOT OVERLAP, on purpose. This adapter contributes open positions
 * and nothing else; closed trades keep coming from the tax P&L. Letting both
 * write closed trades is how an import doubles a sell — which has happened
 * here before, and cost a day to find.
 *
 * DETECTION cannot collide with the tax P&L: that file is recognised by a
 * "Tradewise Exits" sheet, this one by a header row carrying Symbol, Trade
 * Date and Trade Type. Different sheets, different columns, no ambiguity.
 *
 * THE HEADER IS NOT THE FIRST ROW. Zerodha writes a title block first — a
 * client id, a "Tradebook for Equity from … to …" line, and several blank
 * rows — so the header sits around row 15 and its position is not guaranteed.
 * It is found by looking for the columns rather than by counting rows.
 */

/** Delivery equity. Anything else in the file is reported, not imported. */
const KEPT_SERIES = ["EQ", "BE", "BZ"];

const norm = (v) => String(v ?? "").trim();
const key = (v) => norm(v).toLowerCase().replace(/[^a-z]/g, "");
const num = (v) => {
  // Indian grouping survives a round trip through some exports.
  const n = Number(norm(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * YYYY-MM-DD out of whatever the cell holds.
 *
 * `cellDates: true` gives a Date for a real date cell; a CSV gives a string.
 * The Date branch reads local parts rather than toISOString, which would shift
 * a morning trade in IST back to the previous day.
 */
function toDate(v) {
  if (v instanceof Date && !isNaN(v)) {
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = norm(v);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

const WANTED = {
  symbol: ["symbol"],
  isin: ["isin"],
  date: ["tradedate"],
  side: ["tradetype"],
  quantity: ["quantity"],
  price: ["price"],
  series: ["series"],
  exchange: ["exchange"],
};

/** The row that names the columns, and where each one landed. */
function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const cells = (rows[r] || []).map(key);
    if (cells.includes("symbol") && cells.includes("tradedate") && cells.includes("tradetype")) {
      const map = {};
      for (const [want, names] of Object.entries(WANTED)) {
        const i = cells.findIndex((c) => names.includes(c));
        if (i >= 0) map[want] = i;
      }
      return { row: r, map };
    }
  }
  return null;
}

export const id = "zerodha_tradebook";
export const label = "Zerodha tradebook";

/**
 * A tradebook, not a tax report.
 *
 * Read by the import screen to decide which half of the pipeline a file goes
 * through — open positions here, matched lots everywhere else.
 */
export const kind = "tradebook";

/**
 * Detection reads the worksheet's cells directly rather than converting it to
 * rows, because it runs before anything has decided this file is ours and the
 * converter is not in scope here. A worksheet is a map of cell addresses to
 * values, so the header labels can simply be looked for among them.
 */
function labelsIn(ws) {
  const out = new Set();
  if (!ws) return out;
  for (const addr of Object.keys(ws)) {
    if (addr[0] === "!") continue;               // !ref, !margins and friends
    const v = ws[addr]?.v;
    if (typeof v === "string") out.add(key(v));
  }
  return out;
}

export function findSheet(workbook) {
  // Named "Equity" in every tradebook seen so far, but the labels are the real
  // evidence, so a renamed sheet still works.
  for (const n of workbook?.SheetNames || []) {
    const labels = labelsIn(workbook.Sheets?.[n]);
    if (labels.has("symbol") && labels.has("tradedate") && labels.has("tradetype")) return n;
  }
  return null;
}

export function detect(workbook) {
  return !!findSheet(workbook);
}

/**
 * Rows in, normalised trades out.
 *
 * The output is the input `matchFifo` wants, not the lot shape the closed-trade
 * pipeline consumes — a tradebook has no lots until the matching has been done.
 */
export function parseRows(rows) {
  const warnings = [];
  const skippedSeries = {};
  const found = findHeader(rows);

  if (!found) {
    return { trades: [], warnings: ["No tradebook header row found in this sheet."], skippedSeries };
  }

  const { row: h, map } = found;
  const missing = ["symbol", "date", "side", "quantity", "price"].filter((k) => map[k] === undefined);
  if (missing.length) {
    return { trades: [], warnings: [`Missing columns: ${missing.join(", ")}`], skippedSeries };
  }

  const trades = [];

  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const symbol = norm(row[map.symbol]).toUpperCase();
    if (!symbol) continue;

    const series = map.series !== undefined ? norm(row[map.series]).toUpperCase() : "EQ";
    if (series && !KEPT_SERIES.includes(series)) {
      skippedSeries[series] = (skippedSeries[series] || 0) + 1;
      continue;
    }

    const date = toDate(row[map.date]);
    const sideRaw = norm(row[map.side]).toUpperCase();
    const side = sideRaw.startsWith("B") ? "BUY" : sideRaw.startsWith("S") ? "SELL" : null;
    const quantity = num(row[map.quantity]);
    const price = num(row[map.price]);

    if (!date) { warnings.push(`${symbol}: row ${r + 1} has no usable date — skipped`); continue; }
    if (!side) { warnings.push(`${symbol}: row ${r + 1} has an unreadable trade type — skipped`); continue; }
    if (!(quantity > 0)) { warnings.push(`${symbol}: row ${r + 1} has no quantity — skipped`); continue; }
    if (!(price >= 0)) { warnings.push(`${symbol}: row ${r + 1} has no price — skipped`); continue; }

    trades.push({
      date, symbol, side, quantity, price,
      isin: map.isin !== undefined ? norm(row[map.isin]) : "",
      exchange: map.exchange !== undefined ? norm(row[map.exchange]).toUpperCase() : "NSE",
      // The tradebook carries no cost column at all. Left at zero here and
      // computed by the app on import — see toOpenTradeRows.
      charges: 0,
    });
  }

  return { trades, warnings, skippedSeries };
}
