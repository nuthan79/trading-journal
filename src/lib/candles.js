/**
 * What a trade chart needs to know, independent of who draws it.
 *
 * Lightweight Charts does the scales, the candles and the axes. What it cannot
 * know is anything about the TRADE: which window to show, where the stop sat,
 * which sessions the exits landed on. That is all here, as plain data, so it
 * can be probed without a canvas.
 *
 * WHAT IS MEASURED AND WHAT IS DRAWN ARE THE SAME THING. The extremes marked
 * on a chart come from `mfe_r` and `mae_r` on the trade row, computed by
 * path.js from these same bars. Recomputing them here from the bars in hand
 * would eventually disagree with the number printed beside the chart — the
 * chart would say a trade reached 3.1R while the card said 2.8R, and there
 * would be no way to tell which was lying.
 */

import { hasRealStop, STOP_ASSUMED } from "./stops";
import { barsKeyFor } from "./bars";

const DAY = 86_400_000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const shift = (d, days) => iso(new Date(d).getTime() + days * DAY);
const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/* ------------------------------------------------------------------ *
 *  The window
 * ------------------------------------------------------------------ */

export const LEAD_DAYS = 92;    // roughly three months of base before entry
export const TRAIL_DAYS = 45;   // and six weeks of what happened after

/**
 * How much price history one trade's chart should cover.
 *
 * A closed trade gets context on both sides: enough before entry to see the
 * base that was being bought, and enough after the exit to see whether leaving
 * was right. An OPEN position ends at today instead — it has no "after", and a
 * chart stopping at a fixed point would show a position you still hold as
 * though it were finished. That was the user's first requirement.
 *
 * The trailing edge is clamped to today either way, because there are no bars
 * from the future and asking for them makes the read-through cache think it
 * has a hole it can never fill — which would send every chart upstream on
 * every single open.
 */
export function chartWindow(t, today = iso(Date.now())) {
  const entry = t?.entry_date ? iso(t.entry_date) : null;
  if (!entry) return null;
  const open = t.status !== "closed" || !t.exit_date;
  const end = open ? today : shift(iso(t.exit_date), TRAIL_DAYS);
  return { from: shift(entry, -LEAD_DAYS), to: end > today ? today : end };
}

/**
 * One window per LISTING, not per trade.
 *
 * Two trades in the same symbol six months apart are two charts and one
 * fetch — the API caches by symbol and day, so asking for the union costs the
 * same as asking for either and saves a round trip. Anything the union covers
 * beyond what a chart draws is stored, not shipped: the route trims to the
 * window it was asked for.
 */
export function windowsFor(trades, today = iso(Date.now())) {
  const by = new Map();
  for (const t of trades || []) {
    const w = chartWindow(t, today);
    if (!w || !t.symbol) continue;
    const key = barsKeyFor(t.symbol, t.exchange);
    const cur = by.get(key);
    if (!cur) by.set(key, { symbol: t.symbol, exchange: t.exchange || "NSE", ...w });
    else {
      if (w.from < cur.from) cur.from = w.from;
      if (w.to > cur.to) cur.to = w.to;
    }
  }
  return [...by.values()];
}

/* Delegates rather than rebuilds: this is the string /api/bars keys its
   response by, and a second spelling of it is silence that looks like no data.
   See the note on barsKeyFor. */
export const barsKey = (t) => barsKeyFor(t?.symbol, t?.exchange);

/** Only the sessions this trade's own chart shows, out of the listing's set. */
export function barsFor(t, byKey, today = iso(Date.now())) {
  const w = chartWindow(t, today);
  const all = byKey?.[barsKey(t)];
  if (!w || !Array.isArray(all)) return [];
  return all.filter((b) => b.d >= w.from && b.d <= w.to);
}

/* ------------------------------------------------------------------ *
 *  What goes on top
 * ------------------------------------------------------------------ */

/**
 * A marker has to land on a session that EXISTS.
 *
 * Lightweight Charts drops a marker whose time is not one of the series' own
 * points, silently — so an exit on a Saturday, or on a holiday, or on a day
 * the stock was halted, simply would not be drawn. The next session that does
 * exist is the honest place for it: the trade did happen, and the bar it is
 * pinned to is the first one that could show it.
 */
const landOn = (days, d) => {
  if (!d) return null;
  const want = iso(d);
  if (days.includes(want)) return want;
  return days.find((x) => x >= want) || null;
};

/**
 * The levels and moments this trade wants marked.
 *
 * EVERY EXIT, NOT ONE. A position closed in three tranches is three moments on
 * this chart, and drawing a single dot at the average would put a marker on a
 * day nothing happened while hiding the two days something did. On a journal
 * built to ask whether scaling out helped, that is the one thing the chart is
 * for — and it is exactly what the reference implementation gets wrong, giving
 * a 55%-closed position a single exit dot.
 */
export function overlays(t, bars) {
  const days = (bars || []).map((b) => b.d);
  const entryPrice = num(t.entry_price);
  const stop = num(t.stop_loss);

  const exits = (t.exits || [])
    .filter((e) => num(e.price) != null && e.exit_date)
    .map((e) => ({
      time: landOn(days, e.exit_date),
      price: num(e.price),
      qty: num(e.quantity),
    }))
    .filter((e) => e.time)
    .sort((a, b) => (a.time < b.time ? -1 : 1));

  const soldQty = exits.reduce((s, e) => s + (e.qty || 0), 0);
  const total = num(t.quantity) || 0;

  return {
    entry: entryPrice == null ? null
      : { time: landOn(days, t.entry_date), price: entryPrice },
    /* A stop the importer invented is not a level the trader chose, and a
       trade with no stop on record has none at all — neither gets a line
       pretending otherwise. hasRealStop is that exact question and already
       has one answer; writing the comparison out again here is how a tenth
       copy of it would have got in. */
    stop: hasRealStop(t) ? stop : null,
    assumedStop: stop != null && t.stop_source === STOP_ASSUMED ? stop : null,
    exits,
    /* Share of the position each tranche took, so the marker can say "40%"
       rather than making three exits look alike. */
    exitShare: exits.map((e) => (total > 0 && e.qty ? (e.qty / total) * 100 : NaN)),
    fullyOut: total > 0 && soldQty >= total - 1e-6,
  };
}

export const hasBars = (bars) => Array.isArray(bars) && bars.length > 1;
