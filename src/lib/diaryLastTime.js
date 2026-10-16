/**
 * "Last time" — when the book is where it has been before, what you wrote
 * then. The feature the diary exists for: everything else on the page is in
 * service of bringing an old entry back at the moment it could change a
 * decision.
 *
 * ONE RULE, ON PURPOSE: the losing run. When you are on one, find the last
 * run that was about as long and show what you wrote while it lasted — and
 * how it ended. A run is counted exactly as the losing-run card counts it
 * (bottleneck.losingRuns), so the two screens never disagree about whether
 * you are on one or how long it is.
 *
 * WHAT "ABOUT AS LONG" MEANS. At least the current run less two, and at least
 * three. A longer run counts as well as a shorter one — "you have been here,
 * and deeper" is the point — and the most recent match wins, since how you
 * traded and wrote two years ago is a weaker witness than last quarter.
 *
 * WHEN NOTHING WAS THAT LONG, THE LONGEST BEFORE IT. On a record run the
 * strict rule finds nothing — on the first real book tried, a run of 12 with
 * nothing earlier past 9 — so the block went quiet during the one run it
 * exists for. It falls back to the longest earlier run (at least three; the
 * most recent of a tie) and says that is what it is, rather than passing a
 * shorter run off as a like one.
 *
 * Pure. Dates are stored YYYY-MM-DD strings, compared as strings.
 */

import { losingRuns } from "./bottleneck";

/** A losing run of this many entries is worth looking back for. */
export const LAST_TIME_MIN = 3;

/**
 * The block's content, or null when there is nothing to say.
 *
 *   now      the run you are on: { n, from, to }
 *   then     the last run like it: { n, from, to, endedBy }, or null if none
 *   match    "similar" — about as long; "longest" — the fallback, the longest
 *            earlier run when none was about as long
 *   entries  diary entries written while `then` lasted — from its first
 *            losing entry up to (not including) the day a win ended it
 */
export function lastTime(closed = [], diary = []) {
  const runs = losingRuns(closed);
  const now = runs.length ? runs[runs.length - 1] : null;
  if (!now || now.endedBy || now.n < LAST_TIME_MIN) return null;

  const floor = Math.max(LAST_TIME_MIN, now.n - 2);
  const past = runs.slice(0, -1).reverse();                // newest first
  let then = past.find((r) => r.n >= floor) || null;
  let match = "similar";
  if (!then) {
    /* The longest earlier run; reduce keeps the first of a tie, which on a
       newest-first list is the most recent. */
    const longest = past.reduce((a, r) => (!a || r.n > a.n ? r : a), null);
    then = longest && longest.n >= LAST_TIME_MIN ? longest : null;
    match = "longest";
  }
  if (!then) return { now, then: null, match: null, entries: [] };

  const until = then.endedBy?.date || then.to;
  const entries = (diary || []).filter((e) => {
    const d = String(e.entry_date || "").slice(0, 10);
    return d >= then.from && (then.endedBy ? d < until : d <= until);
  });
  return { now, then, match, entries };
}
