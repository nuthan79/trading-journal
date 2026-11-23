/**
 * When BSE refuses, last time's BSE rows stand in for this time's.
 *
 * BSE answers 403 to GitHub's machines (measured 23 Nov 2026, the weekly job's
 * first run) while NSE answers them fine. Without this, every Saturday ended
 * with the shrink guard refusing a file that had lost 5,228 BSE rows, so India
 * never refreshed and the job emailed a failure each week.
 *
 * Carrying the rows over lets NSE — where new listings and almost every trade
 * are — refresh weekly, while BSE stays as it was until somebody runs the
 * build from a machine BSE answers. The rows are the previous file's own, so
 * nothing about BSE is invented, and no BSE rename can be seen while they are
 * carried — the same rows on both sides.
 *
 * BSE only, on purpose. NSE failing still trips the guard: it is the half the
 * job exists to refresh, and quietly shipping last week's NSE as this week's
 * would be the failure the guard is there to catch.
 *
 * Pure, no imports — scripts/build-symbols.mjs reads it.
 */
export function keepRefusedBse(fresh = [], previous = []) {
  if (fresh.some((r) => r.e === "BSE")) return { rows: fresh, kept: 0 };
  const old = previous.filter((r) => r.e === "BSE");
  return { rows: [...fresh, ...old], kept: old.length };
}
