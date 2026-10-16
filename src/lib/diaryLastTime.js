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

/** Entries shown under the headline before the rest fold away. */
export const LAST_TIME_SHOWN = 3;

/** Has the writer said anything — a line of text or a mood? */
export const hasWords = (e) =>
  !!String(e?.body || "").trim() || (Array.isArray(e?.emotions) && e.emotions.length > 0);

/**
 * The card's list, worked out once so the screen only renders it.
 *
 * LEAD WITH THE WORDS. On the first real book the run held ten entries and
 * eight read "a chart, no words" — most of the card's height carrying
 * nothing, with the two rows that did buried among them. So:
 *
 *   shown     at most LAST_TIME_SHOWN entries that have text or a mood,
 *             newest first, grouped by day — four on one date read as one date
 *   more      the rest of the worded ones, the same way, behind the fold
 *   unworded  how many had neither. Never a row of their own, open or
 *             closed; only ever a count.
 *   charts    how many of those carry a chart, for the sentence that replaces
 *             the list when nothing at all was written
 *
 * Dates are stored YYYY-MM-DD strings, compared as strings.
 */
export function recallList(entries = [], max = LAST_TIME_SHOWN) {
  const day = (e) => String(e?.entry_date || "").slice(0, 10);
  /* Newest first; a sort is stable, so entries on one day keep their order. */
  const worded = (entries || []).filter(hasWords).sort((a, b) => (day(a) < day(b) ? 1 : day(a) > day(b) ? -1 : 0));
  const unworded = (entries || []).filter((e) => !hasWords(e));
  const byDay = (list) => {
    const out = [];
    for (const e of list) {
      const last = out[out.length - 1];
      if (last && last.date === day(e)) last.entries.push(e);
      else out.push({ date: day(e), entries: [e] });
    }
    return out;
  };
  return {
    shown: byDay(worded.slice(0, max)),
    more: byDay(worded.slice(max)),
    moreWorded: Math.max(0, worded.length - max),
    unworded: unworded.length,
    charts: unworded.filter((e) => !!e.image_path).length,
  };
}

/**
 * The fold line: "7 more — charts, no words", "2 more", or "5 more — 2
 * written, 3 with no words". Null when there is nothing beyond what shows.
 */
export function moreLabel({ moreWorded, unworded, charts }) {
  const n = moreWorded + unworded;
  if (!n) return null;
  if (!unworded) return `${n} more`;
  /* "charts" only when every silent entry is one — an entry can be bare. */
  if (!moreWorded) return `${n} more — ${charts === unworded ? "charts, " : ""}no words`;
  return `${n} more — ${moreWorded} written, ${unworded} with no words`;
}
