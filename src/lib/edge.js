/**
 * "Where the edge is" — the setup breakdown.
 *
 * Same closed trades, sliced a different way each time. Expectancy is the
 * column that decides anything; total R tells you how much that expectancy has
 * actually been worth given how often the slice came up.
 *
 * CONTINUOUS DIMENSIONS USE ADAPTIVE BANDS.
 *
 * Fixed bands fail in both directions. Set them wide and every trade lands in
 * one row -- the old "0.5-1%" risk band swallowed a whole journal and said
 * nothing. Set them narrow and each row holds too few trades to read.
 *
 * So the bands are cut from your own distribution instead: split the recorded
 * values into groups of roughly equal size and label them with the real
 * ranges. Rows stay populated whatever your habits are, and when your
 * discipline tightens the bands follow you down.
 *
 * Categorical dimensions -- pattern, exit reason, stage -- are left alone.
 */

import { stats } from "./calc";

const n = (v) => (v === "" || v == null ? NaN : Number(v));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

export const NOT_RECORDED = "Not recorded";

/* ==================================================================== */
/*  Adaptive banding                                                    */
/* ==================================================================== */

/**
 * How many bands the sample can support.
 *
 * Roughly fifteen trades per band. Below that a single outlier moves the row,
 * and a table that moves on one trade isn't telling you about your system.
 */
export function bandCountFor(sampleSize, max = 5) {
  return Math.max(2, Math.min(max, Math.floor(sampleSize / 15) || 2));
}

/**
 * Cut points at equal-count intervals. Duplicates are dropped, so a heavily
 * tied distribution simply yields fewer bands rather than empty ones.
 */
function quantileCuts(sortedAsc, k) {
  const cuts = [];
  for (let i = 1; i < k; i++) {
    const idx = Math.min(sortedAsc.length - 1, Math.floor((sortedAsc.length * i) / k));
    const v = sortedAsc[idx];
    if (!cuts.length || v > cuts[cuts.length - 1]) cuts.push(v);
  }
  return cuts;
}

const fmtNum = (v, dp) => {
  const s = v.toFixed(dp);
  return dp > 0 ? s.replace(/\.?0+$/, "") : s;
};

/**
 * Build a labeller for one continuous dimension from the values present.
 *
 * Returns { label(v), order(label), bands }. `order` keeps the table in
 * ascending band sequence rather than sorted by outcome, so a stop-width
 * table reads as a progression instead of a leaderboard.
 */
export function adaptiveBander(values, { k, unit = "", dp = 1 } = {}) {
  const scale = Math.pow(10, dp);
  const step = 1 / scale;
  /**
   * Band on the values as they are shown, not as they are stored.
   *
   * A stop filled at 18% of entry is stored as a price rounded to the paisa,
   * so 1070 trades meant to share one stop width actually spread from 17.9758
   * to 18.0236. Quantile cuts then landed at 17.999, 18.000, 18.001 and 18.002
   * — four boundaries inside a twentieth of a percent, indistinguishable once
   * printed at one decimal. They collapsed to the same label and the groups
   * merged behind it, which is how a band reading "2.2-17.9%" came to hold 216
   * trades: twelve real stops and two hundred assumed ones that rounded a hair
   * low. The table looked like a finding and was an artefact of float noise.
   *
   * Rounding first makes the bands mean what the labels say. Differences
   * below display precision are not differences a reader can act on.
   */
  const shown = (v) => Math.round(v * scale) / scale;

  const clean = values.filter((v) => isFinite(v)).map(shown).sort((a, b) => a - b);
  if (clean.length < 2) {
    return { label: () => NOT_RECORDED, order: () => 0, bands: [] };
  }

  const count = k || bandCountFor(clean.length);
  const cuts = quantileCuts(clean, count);
  const edges = [clean[0], ...cuts, clean[clean.length - 1]];

  /**
   * Labels that match how the bands actually work.
   *
   * A band holds [lo, hi) — a 42-day trade goes in the band starting at 42,
   * not the one ending there. Printing both ends verbatim gave "0-42 d" and
   * "42-106 d", which claim the same day twice and leave no way to tell which
   * one owns it. Showing the top as one step below the next band's floor is
   * the same bucketing, described honestly: 0-41, 42-105, 106-274.
   *
   * The last band is closed, so it keeps the real maximum.
   *
   * A band whose ends meet is a single value, not a range — that happens when
   * one number dominates the column, as an assumed stop does. "18-18%" reads
   * like a bug; "18%" is what it is.
   */
  const bands = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = shown(edges[i]);
    const hi = edges[i + 1];
    const last = i === edges.length - 2;
    const top = last ? shown(hi) : shown(hi) - step;
    const point = top <= lo;   // the ends meet: one value, not a range
    // An en dash reads as a range where a hyphen fights the minus sign, and
    // where either end is negative even that isn't enough: "-4--1%" is not a
    // thing anyone should have to parse.
    const sep = lo < 0 || top < 0 ? " to " : "–";
    bands.push({
      i, lo: edges[i], hi,
      label: point
        ? `${fmtNum(lo, dp)}${unit}`
        : `${fmtNum(lo, dp)}${sep}${fmtNum(top, dp)}${unit}`,
    });
  }

  const orderOf = new Map(bands.map((b) => [b.label, b.i]));

  return {
    bands,
    label(v) {
      if (!isFinite(v)) return NOT_RECORDED;
      // Rounded the same way the edges were, or a value a hair under a cut
      // lands in the band below the one its printed form belongs to.
      const r = shown(v);
      let i = 0;
      while (i < cuts.length && r >= cuts[i]) i++;
      return bands[Math.min(i, bands.length - 1)].label;
    },
    order(label) {
      return orderOf.has(label) ? orderOf.get(label) : 999;
    },
  };
}

/* ==================================================================== */
/*  Dimensions                                                          */
/* ==================================================================== */

/**
 * `continuous` dimensions supply a numeric `value()` and get adaptive bands.
 * Categorical ones supply `get()` and are grouped as-is.
 */
export const DIMENSIONS = [
  { id: "pattern", label: "Base pattern",
    get: (t) => t.pattern || NOT_RECORDED },

  { id: "dist", label: "Extension at entry", continuous: true, unit: "%", dp: 1,
    value: (t) => t.distPivot },

  { id: "vol", label: "Breakout volume", continuous: true, unit: "%", dp: 0,
    value: (t) => n(t.vol_pct_avg) },

  { id: "sl", label: "Stop width", continuous: true, unit: "%", dp: 1,
    value: (t) => t.slPct },

  { id: "risk", label: "Risk taken", continuous: true, unit: "%", dp: 2,
    value: (t) => t.riskPct },

  { id: "rs", label: "RS rank", continuous: true, unit: "", dp: 0,
    value: (t) => n(t.rs_rank) },

  { id: "hold", label: "Holding period", continuous: true, unit: " d", dp: 0,
    value: (t) => t.heldDays },

  { id: "stage", label: "Weinstein stage",
    get: (t) => (t.weinstein_stage ? `Stage ${t.weinstein_stage}` : NOT_RECORDED) },

  { id: "exit", label: "Exit reason",
    get: (t) => t.exit_reason || NOT_RECORDED },

  { id: "month", label: "Month",
    get: (t) => (t.exit_date || t.entry_date || "").slice(0, 7) || "-" },
];

/* ==================================================================== */
/*  Rows                                                                */
/* ==================================================================== */

/**
 * Rows for the edge table.
 *
 * Continuous dimensions come back in band order -- low to high -- because the
 * question is usually "does this get better or worse as the value rises", and
 * sorting by outcome destroys exactly that reading. Categorical dimensions
 * sort by contribution, where there is no natural sequence.
 */
export function dimensionRows(closed, dimensionId, { accountSize = 0, bands } = {}) {
  const dim = DIMENSIONS.find((d) => d.id === dimensionId) || DIMENSIONS[0];

  let labelOf, orderOf = null, bandInfo = [];

  if (dim.continuous) {
    const bander = adaptiveBander(closed.map(dim.value), {
      k: bands, unit: dim.unit, dp: dim.dp,
    });
    labelOf = (t) => bander.label(dim.value(t));
    orderOf = bander.order;
    bandInfo = bander.bands;
  } else {
    labelOf = dim.get;
  }

  const groups = new Map();
  for (const t of closed) {
    const k = labelOf(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }

  const rows = [...groups.entries()].map(([key, trades]) => {
    const s = stats(trades);
    const values = trades.map((t) => t.exposure).filter(isFinite);
    const risks = trades.map((t) => t.riskAmt).filter(isFinite);
    const pnls = trades.map((t) => t.pnl).filter(isFinite);
    const avgRisk = mean(risks);
    const netPnl = pnls.reduce((a, b) => a + b, 0);

    return {
      ...s,
      key,
      trades: trades.length,
      netPnl,
      avgValue: mean(values),
      totalValue: values.reduce((a, b) => a + b, 0),
      avgRisk,
      avgRiskPct: accountSize > 0 && isFinite(avgRisk) ? (avgRisk / accountSize) * 100 : NaN,
      avgSlPct: mean(trades.map((t) => t.slPct).filter(isFinite)),
      returnOnRisk: avgRisk > 0 && trades.length ? netPnl / (avgRisk * trades.length) : NaN,
    };
  });

  if (orderOf) {
    rows.sort((a, b) => orderOf(a.key) - orderOf(b.key));
  } else {
    rows.sort((a, b) => {
      if (a.key === NOT_RECORDED) return 1;
      if (b.key === NOT_RECORDED) return -1;
      return b.totalR - a.totalR;
    });
  }

  return Object.assign(rows, { continuous: !!dim.continuous, bands: bandInfo });
}

export const maxAbsTotalR = (rows) =>
  Math.max(...rows.map((r) => Math.abs(r.totalR || 0)), 1);

/**
 * Slices too small to mean anything. Fifteen is not a statistical threshold so
 * much as the point below which one trade stops moving the row.
 */
export const THIN_SLICE = 15;
export const isThin = (row) => row.trades < THIN_SLICE;
