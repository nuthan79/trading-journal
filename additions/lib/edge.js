/**
 * "Where the edge is" — the setup breakdown.
 *
 * Same closed trades, sliced a different way each time. Expectancy is the
 * column that decides anything; total R tells you how much that expectancy
 * has actually been worth given how often the slice came up.
 *
 * The two rupee columns exist because R alone hides a real question: two
 * patterns can show identical expectancy while one of them consistently ties
 * up twice the capital to get it.
 */

import { stats } from "./calc";
import { slBand } from "./constants";

const n = (v) => (v === "" || v == null ? NaN : Number(v));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

/** Bucket a continuous value into labelled bands. */
function band(v, edges, labels) {
  if (!isFinite(v)) return "Not recorded";
  for (let i = 0; i < edges.length; i++) if (v < edges[i]) return labels[i];
  return labels[labels.length - 1];
}

export const DIMENSIONS = [
  { id: "pattern", label: "Base pattern", get: (t) => t.pattern || "Not recorded" },

  { id: "dist", label: "Extension at entry",
    get: (t) => band(t.distPivot, [0, 2, 5],
      ["Below pivot", "0–2% above", "2–5% above", "Over 5% above"]) },

  { id: "vol", label: "Breakout volume",
    get: (t) => band(n(t.vol_pct_avg), [100, 150, 250, 400],
      ["Below average", "100–150%", "150–250%", "250–400%", "Over 400%"]) },

  // Stop width as its own dimension. Answers whether your wide-stop trades
  // are earning the extra room they're given.
  { id: "sl", label: "Stop width",
    get: (t) => {
      const b = slBand(t.slPct);
      if (!b) return "Not recorded";
      return { tight: "Under 4%", normal: "4–8%", wide: "8–12%", "very wide": "Over 12%" }[b];
    } },

  { id: "stage", label: "Weinstein stage",
    get: (t) => (t.weinstein_stage ? `Stage ${t.weinstein_stage}` : "Not recorded") },

  { id: "rs", label: "RS rank",
    get: (t) => band(n(t.rs_rank), [70, 80, 90],
      ["Under 70", "70–79", "80–89", "90+"]) },

  { id: "exit", label: "Exit reason", get: (t) => t.exit_reason || "Not recorded" },

  { id: "hold", label: "Holding period",
    get: (t) => band(t.heldDays, [5, 15, 40],
      ["Under 5 days", "5–15 days", "15–40 days", "Over 40 days"]) },

  { id: "risk", label: "Risk taken",
    get: (t) => band(t.riskPct, [0.5, 1, 1.5, 2],
      ["Under 0.5%", "0.5–1%", "1–1.5%", "1.5–2%", "Over 2%"]) },

  { id: "month", label: "Month",
    get: (t) => (t.exit_date || t.entry_date || "").slice(0, 7) || "—" },
];

/**
 * Rows for the edge table, sorted by what each slice has actually contributed.
 *
 * `accountSize` lets avg risk be reported as a percentage as well as a rupee
 * figure — the percentage is the one that stays comparable as the account grows.
 */
export function dimensionRows(closed, dimensionId, { accountSize = 0 } = {}) {
  const dim = DIMENSIONS.find((d) => d.id === dimensionId) || DIMENSIONS[0];

  const groups = new Map();
  for (const t of closed) {
    const k = dim.get(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }

  const rows = [...groups.entries()].map(([key, trades]) => {
    const s = stats(trades);

    const values = trades.map((t) => t.exposure).filter(isFinite);
    const risks = trades.map((t) => t.riskAmt).filter(isFinite);
    const slPcts = trades.map((t) => t.slPct).filter(isFinite);
    const pnls = trades.map((t) => t.pnl).filter(isFinite);

    const avgRisk = mean(risks);

    return {
      ...s,
      key,
      trades: trades.length,
      // rupee view
      netPnl: pnls.reduce((a, b) => a + b, 0),
      avgValue: mean(values),
      totalValue: values.reduce((a, b) => a + b, 0),
      avgRisk,
      avgRiskPct: accountSize > 0 && isFinite(avgRisk) ? (avgRisk / accountSize) * 100 : NaN,
      // structure
      avgSlPct: mean(slPcts),
      // rupees earned per rupee risked — the capital-efficiency read
      returnOnRisk: avgRisk > 0 ? pnls.reduce((a, b) => a + b, 0) / (avgRisk * trades.length) : NaN,
    };
  });

  return rows.sort((a, b) => b.totalR - a.totalR);
}

/** For the bar column — the widest slice sets the scale. */
export const maxAbsTotalR = (rows) =>
  Math.max(...rows.map((r) => Math.abs(r.totalR || 0)), 1);

/**
 * Slices too small to mean anything. Ten is not a statistical threshold so
 * much as the point below which one lucky trade moves the whole row.
 */
export const THIN_SLICE = 10;
export const isThin = (row) => row.trades < THIN_SLICE;
