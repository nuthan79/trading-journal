/**
 * The setup names a trade can carry: the built-in eleven, plus up to three of
 * the trader's own.
 *
 * `trades.pattern` is free text and always was, so a custom name needs no
 * schema for the TRADE — only somewhere to keep the name so the dropdown
 * offers it again (migration 051, `profiles.custom_patterns`). Everything that
 * groups by pattern — the Analysis breakdowns, the filters — groups by the
 * string on the trade, so a custom name flows through those untouched.
 *
 * FOUR RULES, and each exists because of the way this goes wrong:
 *
 *   A TRADE NEVER LOSES ITS SETUP. `patternOptions` always includes the value
 *   the trade already carries, listed or not. Without that, opening an old
 *   trade to fix a typo silently blanks a setup that was removed from the list
 *   — or retired from the built-ins, as Power Play was in 023.
 *
 *   RENAMING REWRITES THE TRADES. Handled in db.js, because leaving the old
 *   string on the history splits one idea across two categories and both halves
 *   then read as thin.
 *
 *   A NAME IN USE CANNOT BE DELETED. The count is right there in the book, so
 *   the app says how many trades use it and refuses.
 *
 *   NEAR-DUPLICATES ARE REFUSED. Trimmed, length-capped, and compared without
 *   case or spacing, against the built-ins as well — "support entry" beside
 *   "Support Entry" is two categories of the same trade.
 */
import { PATTERNS } from "./constants";

/** Three. See the note in migration 051 for why this is the feature. */
export const MAX_CUSTOM_PATTERNS = 3;

export const PATTERN_MAX_LEN = 24;

const norm = (s) => String(s || "").trim().toLowerCase().replace(/[\s_-]+/g, " ");

/**
 * The trader's own names, from the profile.
 *
 * Tolerates the column not existing yet (before 051 is run) and anything that
 * is not a list of strings, because a screen that throws on a settings value
 * takes the whole journal with it.
 */
export function customPatterns(profile) {
  const raw = profile?.custom_patterns;
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const v of list) {
    const name = String(v ?? "").trim();
    if (name && !out.some((o) => norm(o) === norm(name))) out.push(name);
    if (out.length >= MAX_CUSTOM_PATTERNS) break;
  }
  return out;
}

/**
 * What the dropdown offers: the built-ins, then this trader's own, then
 * whatever this trade already says if that is neither.
 *
 * "Other" stays last, because it is the fallback and reads wrongly in the
 * middle of a list of real answers.
 */
export function patternOptions(profile, current = null) {
  const mine = customPatterns(profile);
  const builtIn = PATTERNS.filter((p) => p !== "Other");
  const out = [...builtIn, ...mine.filter((m) => !builtIn.some((b) => norm(b) === norm(m)))];
  const cur = String(current || "").trim();
  if (cur && !out.some((o) => norm(o) === norm(cur))) out.push(cur);
  out.push("Other");
  return out;
}

/**
 * Can this name be added? Returns null, or the sentence to show.
 *
 * `existing` is the trader's current list; the built-ins are always compared
 * against as well.
 */
export function checkPatternName(name, existing = []) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "Give the setup a name.";
  if (trimmed.length > PATTERN_MAX_LEN) return `Keep it under ${PATTERN_MAX_LEN} characters.`;
  if (PATTERNS.some((p) => norm(p) === norm(trimmed))) return `“${trimmed}” is already in the list.`;
  if (existing.some((p) => norm(p) === norm(trimmed))) return `You already have “${trimmed}”.`;
  if (existing.length >= MAX_CUSTOM_PATTERNS) {
    return `Three is the limit — rename or remove one first. More than that and the ` +
           `breakdowns split into slices too small to read.`;
  }
  return null;
}

/** How many trades carry this exact setup. The check before a delete. */
export function patternUsage(trades, name) {
  const n = norm(name);
  return (trades || []).filter((t) => norm(t.pattern) === n).length;
}
