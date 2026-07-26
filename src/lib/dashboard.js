/**
 * The dashboard's derived blocks.
 *
 * All deterministic. The summary sentence in particular is a template, not a
 * model call — it says the same thing every time for the same data, which is
 * what you want from a figure you're going to quote to someone.
 */

import { stats, chronological, equityCurve, greenCount } from "./calc";

const isNum = (v) => typeof v === "number" && isFinite(v);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const MONTH_LABELS = MONTHS;

/** Trades land in the month they were closed, not the month they were opened. */
const closedOn = (t) => t.exit_date || t.entry_date;

/* ==================================================================== */
/*  Monthly returns grid                                                */
/* ==================================================================== */

/**
 * Year × month matrix of R, with per-year totals.
 *
 * Every month between the first and last trade gets a cell, including the
 * empty ones — a blank January is information too, and hiding it would make
 * an inactive stretch look like it never happened.
 */
export function monthlyGrid(closed) {
  const rows = closed.filter((t) => isNum(t.r) && closedOn(t));
  if (!rows.length) return null;

  const cells = new Map();          // "2026-4" -> { r, trades, wins }
  for (const t of rows) {
    const d = new Date(closedOn(t));
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const c = cells.get(key) || { r: 0, trades: 0, wins: 0 };
    c.r += t.r;
    c.trades += 1;
    if (t.r > 0) c.wins += 1;
    cells.set(key, c);
  }

  const allDates = rows.map((t) => new Date(closedOn(t)));
  const minYear = Math.min(...allDates.map((d) => d.getFullYear()));
  const maxYear = Math.max(...allDates.map((d) => d.getFullYear()));

  const years = [];
  for (let y = minYear; y <= maxYear; y++) {
    const months = MONTHS.map((_, m) => {
      const c = cells.get(`${y}-${m}`);
      return c
        ? {
            month: m, year: y,
            r: c.r, trades: c.trades,
            winRate: (c.wins / c.trades) * 100,
            hasData: true,
          }
        : { month: m, year: y, r: null, trades: 0, winRate: null, hasData: false };
    });
    const filled = months.filter((x) => x.hasData);
    years.push({
      year: y,
      months,
      total: filled.reduce((a, x) => a + x.r, 0),
      trades: filled.reduce((a, x) => a + x.trades, 0),
    });
  }

  const filledCells = years.flatMap((y) => y.months).filter((c) => c.hasData);
  const best = filledCells.reduce((a, b) => (b.r > a.r ? b : a), filledCells[0]);
  const worst = filledCells.reduce((a, b) => (b.r < a.r ? b : a), filledCells[0]);
  const maxAbs = Math.max(...filledCells.map((c) => Math.abs(c.r)), 1);

  return { years, best, worst, maxAbs, monthLabels: MONTHS };
}

/** Cell colour, scaled by how big the month was relative to the biggest one. */
export function cellStyle(cell, maxAbs) {
  if (!cell?.hasData) return { background: "#E4E9EC", color: "#9AA8A4" };

  const t = Math.min(1, Math.abs(cell.r) / maxAbs);
  // Ease the ramp so ordinary months stay distinguishable instead of all
  // washing out at the pale end of the scale
  const k = Math.pow(t, 0.6);

  const from = cell.r >= 0 ? [232, 240, 236] : [247, 228, 224];
  const to   = cell.r >= 0 ? [ 47, 122,  92] : [181,  74,  50];
  const mix = from.map((f, i) => Math.round(f + (to[i] - f) * k));

  return {
    background: `rgb(${mix.join(",")})`,
    color: k > 0.55 ? "#FFFFFF" : cell.r >= 0 ? "#33564A" : "#7A3527",
  };
}

/* ==================================================================== */
/*  Profit concentration                                                */
/* ==================================================================== */

/**
 * How much of the profit came from how few trades.
 *
 * The question underneath: is this a system, or was it three lucky trades?
 * Stripping the top 5% and re-running expectancy is the cleanest test — if
 * what remains is still positive, the edge is broad.
 */
export function profitConcentration(closed) {
  const rs = closed.map((t) => t.r).filter(isNum);
  if (rs.length < 10) return null;

  const desc = [...rs].sort((a, b) => b - a);
  const grossProfit = desc.filter((r) => r > 0).reduce((a, b) => a + b, 0);

  const top10n = Math.max(1, Math.ceil(rs.length * 0.10));
  const top10Sum = desc.slice(0, top10n).filter((r) => r > 0).reduce((a, b) => a + b, 0);

  const top5n = Math.max(1, Math.ceil(rs.length * 0.05));
  const withoutTop5 = desc.slice(top5n);

  return {
    trades: rs.length,
    topDecileShare: grossProfit > 0 ? (top10Sum / grossProfit) * 100 : NaN,
    topDecileCount: top10n,
    expectancy: mean(rs),
    expectancyLessTop5: mean(withoutTop5),
    excludedCount: top5n,
    best: desc[0],
    median: median(rs),
    /** Does it still pay once the outliers are removed? */
    broadEdge: mean(withoutTop5) > 0,
  };
}

/* ==================================================================== */
/*  Best and worst                                                      */
/* ==================================================================== */

export function bestWorst(closed, limit = 8) {
  const rows = closed.filter((t) => isNum(t.r));
  const byR = [...rows].sort((a, b) => b.r - a.r);

  const pick = (t) => ({
    id: t.id,
    symbol: t.symbol,
    exchange: t.exchange,
    exitDate: t.exit_date || t.entry_date,
    heldDays: t.heldDays,
    r: t.r,
    pnl: t.pnl,
    pattern: t.pattern,
    // Written at entry, before the outcome was known. Reading it back on your
    // largest winner and largest loser is the most useful minute of any review.
    thesis: t.thesis || null,
    thesisWrittenAt: t.thesis_written_at || null,
  });

  return {
    best: byR.slice(0, limit).filter((t) => t.r > 0).map(pick),
    // Worst by rupees lost rather than by R — a −1R loss on a large position
    // hurt the account more than a −2R loss on a small one
    worst: [...rows]
      .filter((t) => isNum(t.pnl) && t.pnl < 0)
      .sort((a, b) => a.pnl - b.pnl)
      .slice(0, limit)
      .map(pick),
  };
}

/* ==================================================================== */
/*  Summary sentence                                                    */
/* ==================================================================== */

/**
 * The one-paragraph read, as structured parts rather than a finished string,
 * so the component can highlight individual figures without parsing prose
 * back apart.
 */
export function summaryParts(closed, { openingCapital = 0, flows = [] } = {}) {
  const s = stats(closed);
  if (!s.n) return null;

  const rows = chronological(closed);
  const from = rows[0].entry_date;
  const to = rows[rows.length - 1].exit_date || rows[rows.length - 1].entry_date;

  const monthsSpan = Math.max(
    1,
    Math.round((new Date(to) - new Date(from)) / (30.44 * 86400000))
  );

  const eq = equityCurve(closed, { openingCapital, flows });
  const months = greenCount(closed, "month", { openingCapital, flows });
  const quarters = greenCount(closed, "quarter", { openingCapital, flows });

  return {
    from, to,
    trades: s.n,
    monthsSpan,
    expectancy: s.expectancy,
    winRate: s.winRate,
    totalR: s.totalR,
    maxDD: s.maxDD,
    maxDDPct: eq.maxDDPct,
    worstStreak: s.worstL,
    greenMonths: months.green,
    totalMonths: months.total,
    greenQuarters: quarters.green,
    totalQuarters: quarters.total,
  };
}
