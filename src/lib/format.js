/**
 * Display formatting. Indian conventions, because "17.70 L" reads faster to an
 * Indian trader than "₹1,770,000" does.
 */

export function inr(v, { compact = true, decimals = 2 } = {}) {
  if (v == null || !isFinite(v)) return "—";
  const neg = v < 0;
  const a = Math.abs(v);
  let out;

  if (!compact || a < 1e3) {
    out = new Intl.NumberFormat("en-IN", { maximumFractionDigits: a < 100 ? 2 : 0 }).format(a);
  } else if (a < 1e5) {
    // thousands get a k so a row of trade P&Ls stays scannable at a glance
    out = `${(a / 1e3).toFixed(1)}k`;
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A date to read rather than to sort by. Tables keep ISO because a column of
 * them lines up and sorts as text; a date sitting alone in a sentence or under
 * a chart does neither, and "2025-05-21" is slower to take in than "21 May 25".
 *
 * Parsed by hand rather than through Date, which reads a bare YYYY-MM-DD as
 * UTC and can show the day before once the browser is west of Greenwich.
 */
export function dmy(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "—";
  return `${d} ${MONTHS[m - 1]} ${String(y).slice(2)}`;
}
