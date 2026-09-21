/**
 * Stockal — a US brokerage account sold to Indian investors.
 *
 * ITS TAX REPORT IS A WHOLE BOOK, which is why this is the journal kind and
 * not a tax P&L: one sheet holds every position closed in the year, another
 * holds what is still held on 31 March. The two halves that Zerodha splits
 * across a tax P&L and a holdings file arrive together here.
 *
 *   "Profit and Loss Summary"
 *     Symbol | Name | Quantity Sold | Date Acquired | Buying Price ($) |
 *     Date Sold | Selling Price ($) | Holding Period (Days) | Proceeds ($) |
 *     Brokerage ($) | Gains/Losses ($)
 *
 *   "Holding Statement"
 *     Symbol | Name | Country | Address | ZIP Code | Nature |
 *     Date of Acquiring | Inital Value ($) | Peak value … | Total Closing
 *     Value … | Quantity | Average Buy Price ($)
 *
 * US ONLY. Every row is a US listing bought in dollars, so the adapter says
 * so and the import screen refuses to write it into an Indian book — see
 * `region` below. Mixing the two would put dollar prices into a rupee ledger,
 * where every figure derived from them is wrong and none of them looks it.
 *
 * FRACTIONAL SHARES ARE NORMAL HERE. 0.26955967 of META is a real row in a
 * real file; nothing may round a quantity. Rupee brokers never produce these,
 * so anything that assumed whole shares meets them for the first time here.
 *
 * DATES ARE dd/mm/yyyy — 14/10/2025 is October. Read as US m/d/y it would be
 * a date that does not exist, or worse, one that does.
 *
 * WHAT IS NOT IMPORTED: the dividend and interest sheets. They are income,
 * not trades, and this journal measures trades. The address and ZIP of each
 * company are in the file for the tax form and have no business in a journal.
 */

const num = (v) => {
  if (v === null || v === undefined || v === "") return NaN;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

const round2 = (v) => Math.round(v * 100) / 100;

/** dd/mm/yyyy, and nothing else — see the note above. */
function toDay(v) {
  if (v instanceof Date && Number.isFinite(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const m = String(v ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    const iso = String(v ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  }
  const [, d, mo, y] = m;
  if (Number(mo) > 12) return null;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export const id = "stockal";
export const label = "Stockal";
export const kind = "journal";
/** The only book this file may be written into. */
export const region = "US";

const PNL = "Profit and Loss Summary";
const HOLD = "Holding Statement";

const norm = (v) => String(v ?? "").trim().toLowerCase();

/**
 * WHERE THE TABLE ENDS, AND WHY IT HAS TO BE ASKED.
 *
 * Both sheets continue past their last trade into notes and disclaimers —
 * "NOTE:", "DISCLAIMER & DISCLOSURES:", several paragraphs of it — all
 * sitting in the first column, where a symbol goes. Read as rows they became
 * a dozen warnings saying trades had been skipped, which is the Groww
 * mistake this codebase already learned once: claiming a loss that did not
 * happen sends somebody hunting for a trade that was never there.
 *
 * A ticker is short and has no spaces. The first cell that is not one is the
 * end of the table, and everything after it is prose.
 */
const isTicker = (v) => /^[A-Z][A-Z0-9.\-]{0,6}$/.test(String(v ?? "").trim().toUpperCase());

/** The header row of a sheet whose first rows are a title and a period. */
function headerRow(rows, mark) {
  for (let i = 0; i < Math.min(rows?.length || 0, 12); i++) {
    const cells = (rows[i] || []).map(norm);
    if (cells.includes("symbol") && cells.includes(mark)) return i;
  }
  return -1;
}

const indexer = (rows, at) => {
  const head = (rows[at] || []).map(norm);
  /* Matched on the START of the header, because every money column carries
     its unit — "Buying Price ($)" — and a unit is not part of the name. */
  return (name) => head.findIndex((h) => h.startsWith(norm(name)));
};

export function findSheet(workbook) {
  return (workbook?.SheetNames || []).find((n) => n.trim() === PNL)
      || (workbook?.SheetNames || []).find((n) => n.trim() === HOLD)
      || null;
}

export function detect(workbook) {
  const names = (workbook?.SheetNames || []).map((n) => n.trim());
  /* Both sheets together, which no other report here has. */
  return names.includes(PNL) && names.includes(HOLD);
}

/**
 * Positions, in the shape `journalImport.toJournalRows` consumes.
 *
 * `sheets` is { [name]: rows } — this reader needs two sheets at once, and
 * the import screen hands them over rather than the one `findSheet` names.
 */
export function parseSheets(sheets = {}) {
  const warnings = [];
  const notes = [];
  const positions = [];

  const closed = sheets[PNL] || [];
  const at = headerRow(closed, "quantity sold");
  if (at >= 0) {
    const col = indexer(closed, at);
    const c = {
      symbol: col("symbol"), qty: col("quantity sold"), bought: col("date acquired"),
      buy: col("buying price"), sold: col("date sold"), sell: col("selling price"),
      brokerage: col("brokerage"), gains: col("gains"), name: col("name"),
    };
    for (let i = at + 1; i < closed.length; i++) {
      const r = closed[i] || [];
      const symbol = String(r[c.symbol] ?? "").trim().toUpperCase();
      if (!symbol) continue;
      if (!isTicker(symbol)) break;              // the notes below the table
      const quantity = num(r[c.qty]);
      const entryDate = toDay(r[c.bought]);
      const entryPrice = num(r[c.buy]);
      const exitDate = toDay(r[c.sold]);
      const exitPrice = num(r[c.sell]);
      if (!(quantity > 0) || !entryDate || !(entryPrice > 0) || !exitDate || !(exitPrice > 0)) {
        warnings.push(`${symbol || `row ${i + 1}`}: skipped — a closed row needs both dates, both prices and a quantity.`);
        continue;
      }
      positions.push({
        symbol, side: "long", entryDate, entryPrice, quantity,
        stop: 0,
        /* The buy side carried its own brokerage when it happened, and this
           report states only the SELL's. Putting the sell's figure on the
           position would deduct it from the entry instead — so it rides on
           the exit, where the per-sell split expects it. */
        charges: 0,
        netProfit: Number.isFinite(num(r[c.gains])) ? num(r[c.gains]) : round2((exitPrice - entryPrice) * quantity),
        exits: [{ exit_date: exitDate, price: exitPrice, quantity,
                  charges: Number.isFinite(num(r[c.brokerage])) ? num(r[c.brokerage]) : 0 }],
      });
    }
  }

  const held = sheets[HOLD] || [];
  const ha = headerRow(held, "quantity");
  if (ha >= 0) {
    const col = indexer(held, ha);
    const c = {
      symbol: col("symbol"), acquired: col("date of acquiring"),
      qty: col("quantity"), avg: col("average buy price"), nature: col("nature"),
    };
    for (let i = ha + 1; i < held.length; i++) {
      const r = held[i] || [];
      const symbol = String(r[c.symbol] ?? "").trim().toUpperCase();
      if (!symbol) continue;
      if (!isTicker(symbol)) break;              // the notes below the table
      /* "Nature" is STOCK or ETF here. Anything else is not a holding this
         journal knows how to measure, and is reported rather than guessed. */
      const nature = String(r[c.nature] ?? "").trim().toUpperCase();
      if (nature && !["STOCK", "ETF", "EQUITY"].includes(nature)) {
        warnings.push(`${symbol}: skipped — "${nature}" is not a stock holding.`);
        continue;
      }
      const quantity = num(r[c.qty]);
      const entryDate = toDay(r[c.acquired]);
      const entryPrice = num(r[c.avg]);
      if (!(quantity > 0) || !entryDate || !(entryPrice > 0)) {
        warnings.push(`${symbol}: skipped — a holding needs a date, a quantity and an average price.`);
        continue;
      }
      positions.push({
        symbol, side: "long", entryDate, entryPrice, quantity,
        stop: 0, charges: 0, netProfit: 0, exits: [],
      });
    }
  }

  if (!positions.length) {
    warnings.push("Neither sheet had a row this reader could use.");
  } else {
    notes.push("Stockal states the brokerage on a sale and nothing else, so these " +
               "trades carry the sell-side cost only. No stop is in the file — they " +
               "arrive without one and appear in the stops queue.");
  }
  return { positions, warnings, notes };
}

/** The single-sheet signature, for anything that hands over one sheet. */
export function parseRows(rows) {
  const looksClosed = headerRow(rows, "quantity sold") >= 0;
  return parseSheets({ [looksClosed ? PNL : HOLD]: rows });
}
