/**
 * What a day actually was, from data the app already has — for the strip
 * above each diary entry.
 *
 * WHY. A diary entry is not a note, it is a day, and the app knows what
 * happened on every date: where the index closed and in which regime, what
 * was held, what was bought, what was sold and at what R, what was banked.
 * Putting that beside the day's words is what makes the diary the one place
 * the "why" and the "what" sit together.
 *
 * ABSENT, NEVER ZERO. Every part is optional and is left out when it does not
 * apply — no candle for a Saturday, nothing open, nothing banked. A "0 open"
 * or a dash reads as a statement that nothing happened, and on a day the data
 * simply does not cover that statement is false.
 *
 * Pure: the trades are the journal's derived rows (with `exits`, `r`, and
 * what bankedEvents reads), the regimes are lib/market.js's regimeIndex().
 */

import { bankedEvents } from "./positions";

const day = (v) => String(v || "").slice(0, 10);
const n = (v) => (typeof v === "number" ? v : parseFloat(v));

/**
 * Index the book by date once, then answer any day from it. A year of entries
 * against a few hundred trades would otherwise walk every trade per entry.
 */
export function dayIndex(trades = []) {
  const entered = new Map();       // date → [symbol]
  const closed = new Map();        // date → [{ symbol, r }]
  const banked = new Map();        // date → net P&L realised that day
  const realisedR = new Map();     // date → R realised that day (the year map's colour)
  const traded = new Set();        // dates with any buy or sell
  const book = [];                 // what openOn() walks

  for (const t of trades || []) {
    const entry = day(t.entry_date);
    if (!entry) continue;
    const exits = (t.exits || []).filter((e) => e.exit_date && n(e.quantity) > 0)
      .map((e) => ({ d: day(e.exit_date), q: n(e.quantity) }));
    book.push({ entry, qty: n(t.quantity), exits });

    if (!entered.has(entry)) entered.set(entry, []);
    entered.get(entry).push(t.symbol);
    traded.add(entry);
    for (const e of exits) traded.add(e.d);

    /* Closed that day: finished, and its last sell fell on it. A part-sale
       is money banked, not a position closed — it shows in `banked`. */
    if (t.status === "closed" && exits.length) {
      const last = exits.reduce((a, e) => (e.d > a ? e.d : a), "");
      if (!closed.has(last)) closed.set(last, []);
      closed.get(last).push({ symbol: t.symbol, r: Number.isFinite(t.r) ? t.r : null });
    }

    /* Each sell's own money, on its own day — the same events the period
       table and the equity curve add up. An event placed by the entry date
       is a stand-in for a position with no dated sell, and is not a sale. */
    for (const e of bankedEvents(t)) {
      if (e.placedByEntry || !e.date || !Number.isFinite(e.pnl)) continue;
      banked.set(e.date, (banked.get(e.date) || 0) + e.pnl);
      /* Each sell's R is in its position's own risk, so a day's sells add —
         the same way the monthly table adds them. */
      if (Number.isFinite(e.r)) realisedR.set(e.date, (realisedR.get(e.date) || 0) + e.r);
    }
  }

  /** Positions still held at the close of `d`: bought on or before it, not
   *  fully sold by it. */
  const openOn = (d) => book.reduce((a, p) => {
    if (p.entry > d) return a;
    const sold = p.exits.reduce((s, e) => (e.d <= d ? s + e.q : s), 0);
    return sold < p.qty - 1e-6 ? a + 1 : a;
  }, 0);

  return { entered, closed, banked, realisedR, traded, openOn };
}

/**
 * The facts for one day. Every key is present only when it says something.
 *
 *   index    { close, movePct, regime } — only for a day the index traded
 *   open     positions held at the day's close, when there were any
 *   entered  symbols bought that day
 *   closed   [{ symbol, r }] positions finished that day
 *   banked   net P&L realised that day, loss or gain, when anything sold
 */
export function dayFacts(date, idx, regimes = null) {
  const d = day(date);
  const out = {};
  if (!d) return out;

  const row = regimes?.map?.get(d);
  if (row && Number.isFinite(row.close)) {
    const i = regimes.dates.indexOf(d);
    const prev = i > 0 ? regimes.map.get(regimes.dates[i - 1])?.close : NaN;
    out.index = {
      close: row.close,
      movePct: Number.isFinite(prev) && prev > 0 ? ((row.close - prev) / prev) * 100 : null,
      regime: row.regime && row.regime !== "unknown" ? row.regime : null,
    };
  }

  if (idx) {
    const open = idx.openOn(d);
    if (open > 0) out.open = open;
    if (idx.entered.get(d)?.length) out.entered = idx.entered.get(d);
    if (idx.closed.get(d)?.length) out.closed = idx.closed.get(d);
    if (idx.banked.has(d)) out.banked = idx.banked.get(d);
  }
  return out;
}
