/**
 * INDmoney — US stocks, held through Alpaca, sold to Indian investors.
 *
 * ITS REPORT IS AN ORDER BOOK, not a tax statement: every buy and every sell
 * since the account opened, one row each.
 *
 *   Stock Name | Stock Symbol | Order Placed Time | Order Execution Time |
 *   Broker Reference Id | Transaction Type | Order Type | Quantity |
 *   Price ($) | Order Amount ($) | Brokerage ($)
 *
 * SO IT WRITES TRADES, UNLIKE ZERODHA'S TRADEBOOK, and the difference is the
 * whole reason to say it out loud. That one imports nothing because the tax
 * P&L already holds the same trades with real charges; INDmoney publishes no
 * such statement, so this file is the only record there is. Matched FIFO —
 * the same matcher the Indian tradebook uses — it yields every closed
 * position with its sells, and everything still held.
 *
 * THE EXECUTION TIME IS THE TRADE DATE. An order placed on the 14th and
 * filled on the 15th happened on the 15th: the placed time is an intention,
 * and a journal measures what happened. "14 Oct 2025, 11:58" is the format,
 * and "18 Oct 2025, 01:23 AM" appears too — one with a 24-hour clock and one
 * with a meridiem, in the same column of the same file.
 *
 * US ONLY, like Stockal — see `region`. An Indian book must refuse it.
 *
 * FRACTIONAL SHARES ARE THE NORM: 0.813434004 of AMZN, bought and sold in
 * full. Nothing may round a quantity, and FIFO must not leave a dust
 * remainder behind — `matchFifo` already works in floats for that reason.
 */
import { matchFifo } from "../tradebook";

const num = (v) => {
  if (v === null || v === undefined || v === "") return NaN;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

const round2 = (v) => Math.round(v * 100) / 100;

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
                 jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "14 Oct 2025, 11:58" or "18 Oct 2025, 01:23 AM" — the day is all we keep. */
export function toDay(v) {
  if (v instanceof Date && Number.isFinite(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (!mo) return null;
    return `${m[3]}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

export const id = "indmoney";
export const label = "INDmoney";
export const kind = "journal";
export const region = "US";

const norm = (v) => String(v ?? "").trim().toLowerCase();

function headerRow(rows) {
  for (let i = 0; i < Math.min(rows?.length || 0, 30); i++) {
    const cells = (rows[i] || []).map(norm);
    if (cells.includes("stock symbol") && cells.includes("transaction type")) return i;
  }
  return -1;
}

export function detectRows(rows) { return headerRow(rows) >= 0; }

export function findSheet(workbook) {
  const names = workbook?.SheetNames || [];
  return names.find((n) => n.trim().toUpperCase() === "ORDER_BOOK") || names[0] || null;
}

export function detect(workbook) {
  return (workbook?.SheetNames || []).some((n) => n.trim().toUpperCase() === "ORDER_BOOK");
}

export function parseRows(rows) {
  const warnings = [];
  const notes = [];
  const at = headerRow(rows);
  if (at < 0) return { positions: [], warnings: ["This is not an INDmoney order report."], notes };

  const head = (rows[at] || []).map(norm);
  const col = (name) => head.findIndex((h) => h.startsWith(norm(name)));
  const c = {
    symbol: col("stock symbol"), when: col("order execution time"),
    side: col("transaction type"), qty: col("quantity"),
    price: col("price"), brokerage: col("brokerage"),
  };

  const orders = [];
  for (let i = at + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const symbol = String(r[c.symbol] ?? "").trim().toUpperCase();
    if (!symbol) continue;
    const date = toDay(r[c.when]);
    const side = /sell/i.test(String(r[c.side] ?? "")) ? "SELL"
      : /buy/i.test(String(r[c.side] ?? "")) ? "BUY" : null;
    const quantity = num(r[c.qty]);
    const price = num(r[c.price]);
    if (!date || !side || !(quantity > 0) || !(price >= 0)) {
      warnings.push(`${symbol}: row ${i + 1} skipped — needs an execution date, a side, a quantity and a price.`);
      continue;
    }
    orders.push({ date, symbol, side, quantity, price,
                  charges: Number.isFinite(num(r[c.brokerage])) ? num(r[c.brokerage]) : 0 });
  }

  if (!orders.length) return { positions: [], warnings, notes };

  /* The same FIFO the Indian tradebook uses: oldest lot first, which is what
     the user's own tax working assumes. */
  const { lots, open, warnings: fifoWarnings, shortfalls } = matchFifo(orders);
  warnings.push(...(fifoWarnings || []));
  for (const s of shortfalls || []) {
    warnings.push(`${s.symbol}: sold ${s.short} more than this file shows bought — imported as far as it matched.`);
  }

  /**
   * A POSITION IS A BUY LOT, and `matchFifo` returns one row per matched
   * PAIR — so a lot sold in three goes comes back as three rows. Grouped by
   * symbol and entry date, they become one position with three sells, which
   * is what the journal means by a trade.
   */
  const byLot = new Map();
  for (const l of lots) {
    const key = `${l.symbol}|${l.entryDate}`;
    const p = byLot.get(key) || {
      symbol: l.symbol, side: "long", entryDate: l.entryDate,
      entryPrice: 0, quantity: 0, stop: 0, charges: 0, netProfit: 0, exits: [],
    };
    const price = l.quantity > 0 ? l.buyValue / l.quantity : 0;
    /* Weighted, so two fills of the same lot average honestly. */
    p.entryPrice = (p.entryPrice * p.quantity + price * l.quantity) / (p.quantity + l.quantity);
    p.quantity += l.quantity;
    p.netProfit += l.profit;
    p.exits.push({ exit_date: l.exitDate, quantity: l.quantity,
                   price: l.quantity > 0 ? l.sellValue / l.quantity : 0,
                   charges: l.charges });
    byLot.set(key, p);
  }

  const positions = [...byLot.values()].map((p) => ({
    ...p,
    entryPrice: round2(p.entryPrice),
    netProfit: round2(p.netProfit),
    exits: p.exits.sort((a, b) => (a.exit_date < b.exit_date ? -1 : 1)),
  }));

  for (const o of open) {
    positions.push({
      symbol: o.symbol, side: "long", entryDate: o.entryDate,
      entryPrice: o.quantity > 0 ? round2(o.buyValue / o.quantity) : 0,
      quantity: o.quantity,
      stop: 0,
      /* The buy-side brokerage of the shares still held. */
      charges: o.charges || 0,
      netProfit: 0, exits: [],
    });
  }

  positions.sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1
    : a.symbol.localeCompare(b.symbol)));

  notes.push("Matched oldest-lot-first from the order book, the same way your tax " +
             "working does. No stop is in the file — these arrive without one and " +
             "appear in the stops queue.");
  return { positions, warnings, notes };
}
