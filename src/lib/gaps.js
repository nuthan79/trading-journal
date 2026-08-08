/**
 * Setup fields that were never filled in, and what each one costs.
 *
 * WHY THIS EXISTS.
 *
 * Pattern, pivot, volume and stage came off the default trade form, folded
 * behind a link, because they can all be read off the chart months later —
 * nothing about them decays, so nothing is lost by filling them in during a
 * review instead of at 9:20 in the morning.
 *
 * That is only true if the review actually happens. A field nobody sees is a
 * field nobody fills, and the failure is silent: the "Base pattern" cut on the
 * performance sheet goes on working, it just quietly becomes one enormous
 * "Not recorded" row with the real patterns as slivers beside it. Nobody
 * decides to lose that analysis. It rots.
 *
 * So the deal is: the form may hide a field only if something else asks for
 * it. This is that something.
 *
 * CLOSED TRADES ONLY. dimensionRows reads closed trades, so those are the ones
 * whose gaps degrade an analysis. An open position has time to be filled in
 * and nagging about it is noise.
 */

/**
 * One per cut on the performance sheet that a missing field would hollow out.
 * `dim` is the DIMENSIONS id it feeds, so the message can name what breaks.
 */
export const SETUP_FIELDS = [
  { key: "pattern", label: "base pattern", dim: "pattern", cut: "Base pattern",
    has: (t) => !!(t.pattern || "").trim() },
  { key: "vol_pct_avg", label: "breakout volume", dim: "vol", cut: "Breakout volume",
    has: (t) => Number.isFinite(Number(t.vol_pct_avg)) && t.vol_pct_avg !== "" && t.vol_pct_avg != null },
  { key: "rs_rank", label: "RS rank", dim: "rs", cut: "RS rank",
    has: (t) => Number.isFinite(Number(t.rs_rank)) && t.rs_rank !== "" && t.rs_rank != null },
  { key: "pivot_price", label: "pivot price", dim: "dist", cut: "Extension at entry",
    has: (t) => Number(t.pivot_price) > 0 },
  { key: "weinstein_stage", label: "Weinstein stage", dim: "stage", cut: "Weinstein stage",
    has: (t) => Number(t.weinstein_stage) >= 1 },
];

/**
 * How many closed trades are missing each field.
 *
 * Returns only fields with a real gap, worst first, and each row carries the
 * share so the UI can say something proportionate — "12 of 407" is a footnote,
 * "380 of 407" is the analysis being gone.
 */
export function setupGaps(closed) {
  const n = (closed || []).length;
  if (!n) return [];

  return SETUP_FIELDS
    .map((f) => {
      const missing = closed.filter((t) => !f.has(t)).length;
      return { ...f, missing, total: n, share: (missing / n) * 100 };
    })
    .filter((f) => f.missing > 0)
    .sort((a, b) => b.missing - a.missing);
}
