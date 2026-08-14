/**
 * Display formatting. Indian conventions, because "17.70 L" reads faster to an
 * Indian trader than "₹1,770,000" does.
 */

export function inr(v, { compact = true, decimals = 2 } = {}) {
  if (v == null || !isFinite(v)) return "—";
  const neg = v < 0;
  const a = Math.abs(v);
  let out;

  if (!compact || a < 1e5) {
    out = new Intl.NumberFormat("en-IN", { maximumFractionDigits: a < 100 ? 2 : 0 }).format(a);
  } else if (a < 1e7) {
    out = `${(a / 1e5).toFixed(decimals)} L`;
  } else {
    out = `${(a / 1e7).toFixed(decimals)} Cr`;
  }
  return (neg ? "−" : "") + out;
}

/** With the rupee sign — for money amounts standing on their own. */
export const rupee = (v, opts) => (v == null || !isFinite(v) ? "—" : `₹${inr(v, opts)}`);

export function rfmt(v, dp = 2) {
  if (!isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(dp)}R`;
}

export function pct(v, dp = 1) {
  if (!isFinite(v)) return "—";
  return `${v.toFixed(dp)}%`;
}

export function signedPct(v, dp = 1) {
  if (!isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`;
}

export const days = (v) => (isFinite(v) ? `${Math.round(v)} d` : "—");
