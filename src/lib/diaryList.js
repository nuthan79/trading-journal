/**
 * The diary as a list someone can find things in.
 *
 * Pure, so the probes can walk it: what a search matches, which months and
 * feelings the filters offer, and how a month is named. The screen
 * (components/journal/Diary.jsx) only renders what these return.
 *
 * WHY FILTERS AT ALL. A diary is written most days and read rarely, and at a
 * hundred entries a reverse-chronological scroll is a place things go to be
 * lost. Finding "the week I wrote about revenge trading" has to be a search
 * and two menus, not a scroll.
 */

import { MONTHS } from "./format";

/** "2026-10" from a stored YYYY-MM-DD — by hand, never through new Date(). */
export const monthOf = (iso) => String(iso || "").slice(0, 7);

/** "Oct 2026" for a "2026-10". */
export function monthLabel(ym) {
  const [y, m] = String(ym || "").split("-").map(Number);
  return y && m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : "";
}

/** Months that have at least one entry, newest first — what the month menu offers. */
export function monthsOf(entries = []) {
  return [...new Set(entries.map((e) => monthOf(e.entry_date)).filter(Boolean))].sort().reverse();
}

/**
 * Feelings that appear on at least one entry, in the app's own order — so the
 * menu never offers one that would filter to nothing.
 */
export function emotionsOf(entries = [], order = []) {
  const seen = new Set(entries.flatMap((e) => e.emotions || []));
  const known = order.filter((x) => seen.has(x));
  const extra = [...seen].filter((x) => !order.includes(x)).sort();
  return [...known, ...extra];
}

/**
 * The entries a reader is asking for.
 *
 * `q` matches the body, case-insensitively, every word somewhere in it — so
 * "revenge sizing" finds an entry that says both, in either order, rather than
 * only the exact phrase. Emotion and month narrow further. Order is kept: the
 * list is already newest-first and the filters must not reshuffle it.
 */
export function filterDiary(entries = [], { q = "", emotion = "", month = "" } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (emotion && !(e.emotions || []).includes(emotion)) return false;
    if (month && monthOf(e.entry_date) !== month) return false;
    if (words.length) {
      const body = String(e.body || "").toLowerCase();
      if (!words.every((w) => body.includes(w))) return false;
    }
    return true;
  });
}

/** "9 Sep 2026" — a date in a sentence, where "9 Sep 26" reads as a range. */
export function fullDate(iso) {
  const [y, m, d] = String(iso || "").slice(0, 10).split("-").map(Number);
  return y && m >= 1 && m <= 12 && d ? `${d} ${MONTHS[m - 1]} ${y}` : "";
}
