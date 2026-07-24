/**
 * Display formatting. Pure functions, no I/O — INR only, everything else in
 * this journal is measured in R so there is never a second currency to format.
 */

export const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));

export function money(v) {
  if (!isFinite(v)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 0,
  }).format(v);
}

export function rfmt(v, dp = 2) {
  if (!isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(dp)}R`;
}

export function pct(v, dp = 1) {
  if (!isFinite(v)) return "—";
  return `${v.toFixed(dp)}%`;
}

export function band(v, edges, labels) {
  if (!isFinite(v)) return "Not recorded";
  for (let i = 0; i < edges.length; i++) if (v < edges[i]) return labels[i];
  return labels[labels.length - 1];
}
