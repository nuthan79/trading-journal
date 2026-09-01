/**
 * The geometry behind a trade chart. No React, no DOM — just numbers in,
 * path strings out, so the awkward parts can be probed without a browser.
 *
 * WHY PATHS AND NOT ELEMENTS. A candle drawn as its own <rect> plus its own
 * <line> is two DOM nodes; a wall of twenty-four charts at two hundred
 * sessions each is twelve thousand of them, and the page stops being
 * scrollable. Every candle of one colour goes into ONE path instead — four
 * paths for the price pane, two for volume — so the same wall is about a
 * hundred nodes and the browser stops caring.
 *
 * WHAT IS MEASURED AND WHAT IS DRAWN ARE THE SAME THING. The extremes marked
 * on a chart come from `mfe_r` and `mae_r` on the trade row, computed by
 * path.js from these same bars. Recomputing them here from the bars in hand
 * would eventually disagree with the number printed beside the chart — the
 * chart would say a trade reached 3.1R while the card said 2.8R, and there
 * would be no way to tell which was lying.
 */

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
 * How much of the price history one trade's chart should cover.
 *
 * A closed trade gets context on both sides: enough before entry to see the
 * base that was being bought, and enough after the exit to see whether
 * leaving was right. An OPEN position ends at today instead — it has no
 * "after", and a chart that stopped at some fixed point would be showing a
 * position you still hold as though it were finished.
 *
 * The trailing edge is clamped to today either way, because there are no bars
 * from the future and asking for them makes the cache think it has a hole it
 * can never fill — which would send every chart upstream on every open.
 */
export function chartWindow(t, today = iso(Date.now())) {
  const entry = t?.entry_date ? iso(t.entry_date) : null;
  if (!entry) return null;
  const open = t.status !== "closed" || !t.exit_date;
  const end = open ? today : shift(iso(t.exit_date), TRAIL_DAYS);
  return {
    from: shift(entry, -LEAD_DAYS),
    to: end > today ? today : end,
  };
}

/* ------------------------------------------------------------------ *
 *  Scales
 * ------------------------------------------------------------------ */

const lg = (v) => Math.log(Math.max(v, 1e-9));

/**
 * Price to pixels, logarithmic.
 *
 * Log rather than linear, and not as a preference: on a chart spanning months
 * of a stock that ran from 600 to 920, a linear axis makes the same 10% move
 * look half as tall at the bottom as at the top. Two moves that cost the same
 * in R would then be drawn at different sizes, which is exactly the comparison
 * this wall of charts exists to make.
 *
 * `extra` carries the levels drawn ON the chart — stop, entry, exits. They
 * have to widen the range or a stop below everything the window contains gets
 * clipped to the edge and reads as though price came down to touch it.
 */
export function priceScale(bars, extra, { top = 0, height = 100, pad = 0.06 } = {}) {
  const vals = [];
  for (const b of bars || []) {
    const h = num(b.h), l = num(b.l), c = num(b.c);
    if (h != null) vals.push(h);
    if (l != null) vals.push(l);
    if (h == null && l == null && c != null) vals.push(c);
  }
  for (const v of extra || []) { const n = num(v); if (n != null && n > 0) vals.push(n); }
  if (!vals.length) return null;

  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (!(lo > 0)) lo = Math.min(...vals.filter((v) => v > 0)) || 1;
  if (hi <= lo) hi = lo * 1.01;

  const a = lg(lo), b = lg(hi), room = (b - a) * pad;
  const min = a - room, max = b + room;
  const y = (p) => {
    const n = num(p);
    if (n == null || n <= 0) return null;
    return top + ((max - lg(n)) / (max - min)) * height;
  };
  y.lo = Math.exp(min);
  y.hi = Math.exp(max);
  y.invert = (py) => Math.exp(max - ((py - top) / height) * (max - min));
  return y;
}

/** Sessions to pixels. Bars are a band, not a point — `w` is the candle width. */
export function timeScale(count, { left = 0, width = 100, gap = 0.28 } = {}) {
  const n = Math.max(count, 1);
  const band = width / n;
  const x = (i) => left + band * (i + 0.5);
  x.band = band;
  x.w = Math.max(band * (1 - gap), 1);
  /* Below two pixels a body is a smear, so the candle degrades to its wick
     alone rather than drawing a rectangle nobody can read. */
  x.hairline = x.w < 2;
  x.at = (px) => Math.min(n - 1, Math.max(0, Math.floor((px - left) / band)));
  return x;
}

/**
 * Axis labels at round numbers, spaced evenly in LOG terms.
 *
 * Stepping linearly and rounding would bunch every label at one end of the
 * axis, which is what the log scale was avoiding in the first place.
 */
export function priceTicks(y, count = 5) {
  if (!y) return [];
  const a = lg(y.lo), b = lg(y.hi);
  const out = [];
  for (let i = 0; i <= count; i++) {
    const v = Math.exp(a + ((b - a) * i) / count);
    const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1);
    const r = Math.round(v / mag) * mag;
    if (!out.some((o) => Math.abs(o - r) < mag / 2)) out.push(r);
  }
  return out.filter((v) => v > y.lo && v < y.hi);
}

/* ------------------------------------------------------------------ *
 *  Paths
 * ------------------------------------------------------------------ */

const r1 = (n) => Math.round(n * 10) / 10;

/**
 * Candles, as four path strings: bodies and wicks, up and down.
 *
 * Direction is close against the PREVIOUS close, not against the same bar's
 * open. A day that gapped down and then recovered to finish above its open is
 * still a down day for anybody holding it, and colouring it green because of
 * where the auction happened to start would tell the wrong story on exactly
 * the days that matter. The first bar has no previous close and falls back to
 * its own open.
 */
export function candlePaths(bars, x, y) {
  const up = { body: [], wick: [] }, down = { body: [], wick: [] };
  let prevC = null;

  (bars || []).forEach((b, i) => {
    const o = num(b.o), h = num(b.h), l = num(b.l), c = num(b.c);
    if (c == null) return;
    const ref = prevC == null ? (o == null ? c : o) : prevC;
    const side = c >= ref ? up : down;
    prevC = c;

    const cx = r1(x(i));
    const yh = y(h == null ? c : h), yl = y(l == null ? c : l);
    if (yh != null && yl != null) side.wick.push(`M${cx} ${r1(yh)}V${r1(yl)}`);

    if (x.hairline || o == null) return;
    const yo = y(o), yc = y(c);
    if (yo == null || yc == null) return;
    const x0 = r1(cx - x.w / 2), x1 = r1(cx + x.w / 2);
    /* A doji has zero height and would vanish; it is given the thinnest
       body that still renders as a line. */
    const t = Math.min(yo, yc), bm = Math.max(yo, yc);
    const b2 = bm - t < 0.6 ? t + 0.6 : bm;
    side.body.push(`M${x0} ${r1(t)}H${x1}V${r1(b2)}H${x0}Z`);
  });

  return {
    upBody: up.body.join(""), upWick: up.wick.join(""),
    downBody: down.body.join(""), downWick: down.wick.join(""),
  };
}

/** Volume, coloured by the same rule, scaled to its own pane. */
export function volumePaths(bars, x, { top, height }) {
  const vols = (bars || []).map((b) => num(b.v)).filter((v) => v != null && v > 0);
  if (!vols.length) return null;
  const max = Math.max(...vols);
  const up = [], down = [];
  let prevC = null;

  (bars || []).forEach((b, i) => {
    const v = num(b.v), c = num(b.c), o = num(b.o);
    if (c == null) return;
    const ref = prevC == null ? (o == null ? c : o) : prevC;
    const side = c >= ref ? up : down;
    prevC = c;
    if (v == null || v <= 0) return;
    const h = Math.max((v / max) * height, 0.6);
    const cx = r1(x(i));
    const x0 = r1(cx - x.w / 2), x1 = r1(cx + x.w / 2);
    side.push(`M${x0} ${r1(top + height)}V${r1(top + height - h)}H${x1}V${r1(top + height)}Z`);
  });

  return { up: up.join(""), down: down.join("") };
}

/* ------------------------------------------------------------------ *
 *  What to draw on top
 * ------------------------------------------------------------------ */

/**
 * The levels and moments this trade wants marked.
 *
 * EVERY EXIT, NOT ONE. A position closed in three tranches is three moments on
 * this chart, and drawing a single dot at the average would put a marker on a
 * day nothing happened while hiding the two days something did. On a journal
 * built to ask whether scaling out helped, that is the one thing the chart is
 * for.
 */
export function overlays(t, bars) {
  const days = (bars || []).map((b) => b.d);
  const at = (d) => (d ? days.indexOf(iso(d)) : -1);
  /* A weekend or a holiday has no bar. The marker lands on the next session
     that does, rather than disappearing. */
  const near = (d) => {
    if (!d) return -1;
    const want = iso(d);
    const exact = days.indexOf(want);
    if (exact >= 0) return exact;
    const after = days.findIndex((x) => x >= want);
    return after >= 0 ? after : -1;
  };

  const entry = num(t.entry_price);
  const stop = num(t.stop_loss);
  const exits = (t.exits || [])
    .filter((e) => num(e.price) != null && e.exit_date)
    .map((e) => ({ i: near(e.exit_date), price: num(e.price), qty: num(e.quantity) }))
    .filter((e) => e.i >= 0);

  return {
    entry: entry == null ? null : { i: near(t.entry_date), price: entry },
    stop: stop == null ? null : stop,
    exits,
    levels: [entry, stop, ...exits.map((e) => e.price)].filter((v) => v != null),
    lastIndex: days.length - 1,
    at,
  };
}

export const hasBars = (bars) => Array.isArray(bars) && bars.length > 1;
