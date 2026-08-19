/**
 * The dropdown vocabularies, in one place.
 *
 * These lists are journal schema in everything but name — once you've tagged
 * fifty trades with a label, renaming it orphans the history. So add freely,
 * but rename only deliberately.
 */

/**
 * "Power Play" was removed. Anything already tagged with it was moved to
 * "Other" by 023_retire_power_play.sql rather than left pointing at a label
 * the dropdown no longer offers — an orphaned value shows up in the edge table
 * as its own row and cannot be edited back out through the form.
 */
export const PATTERNS = [
  "VCP",
  "Cup & Handle",
  "Flat Base",
  "Double Bottom",
  "High Tight Flag",
  "Ascending Base",
  "All Time High",
  "Breakout Entry",
  "Pullback Entry",
  "Other",
];

export const EXIT_REASONS = [
  "Stop hit",
  "Trailing stop",
  "Breached 20 SMA",
  "Sold into strength",
  "Target reached",
  "Time stop",
  "Broke support",
  "Market conditions",
  "Discretionary",
];

/**
 * Post-trade tags.
 *
 * Two kinds live here and the distinction matters:
 *
 *   EXECUTION errors — you did something you know you shouldn't have. These are
 *   fixable by changing behaviour, and they're what the review page should be
 *   costing out.
 *
 *   OUTCOME facts — the trade simply didn't work. Nothing was done wrong. In a
 *   breakout system these are the majority of losses and always will be.
 *
 * Both are worth recording, but averaging them together would bury the fixable
 * behaviour under the unavoidable cost of doing business — so the outcome tags
 * are listed in NEUTRAL_TAGS and excluded from the mistake-cost analysis.
 */
export const MISTAKES = [
  // outcome, not error
  "Setup failed",
  // execution errors
  "Chased extended",
  "No volume confirmation",
  "Ignored the stop",
  "Oversized",
  "Undersized",
  "Averaged down",
  "Sold too early",
  "Sold a little late",
  "Traded against market trend",
  "Not a real base",
  "Revenge trade",
  "Wrong trade",
  "Early entry",
];

/** Tags that describe what the market did, not what you did wrong. */
export const NEUTRAL_TAGS = new Set(["Setup failed"]);

export const isExecutionError = (tag) => !NEUTRAL_TAGS.has(tag);

/**
 * Diary emotions — how a DAY felt.
 *
 * Multi-select, tagged on `diary_entries`, and deliberately left alone by the
 * per-trade work below. A day holds several trades and one mood; asking it to
 * also serve two specific moments on one position is what would have made both
 * jobs worse.
 */
export const EMOTIONS = [
  "Calm", "Confident", "Patient", "Detached",
  "FOMO", "Hesitant", "Impatient", "Anxious", "Frustrated", "Euphoric",
];

/**
 * Per-trade emotions — how one POSITION felt, at each end of it.
 *
 * TWO LISTS, NOT ONE. FOMO is not available when closing and regret is not
 * available when opening. A single shared list would leave half of each column
 * permanently unused and make the two ends of the flow look like the same
 * picture twice, when the entire point is the journey between them.
 *
 * ORDERED CONSTRUCTIVE FIRST, REACTIVE LAST, which is also the order they are
 * drawn in. `CONSTRUCTIVE_ENTRY` marks where the line falls — the states a
 * trader would choose to be in when committing money. That set is what
 * "entered in a good state" counts, so moving a word across the line changes a
 * published number; do it deliberately.
 *
 * Renaming any of these orphans history exactly as it would for PATTERNS —
 * see the note at the top of this file, and 023_retire_power_play.sql for how
 * a word gets retired properly.
 */
export const ENTRY_EMOTIONS = [
  "Calm", "Confident", "Patient", "Focused",
  "Hesitant", "Impatient", "Anxious", "FOMO", "Euphoric",
];

export const EXIT_EMOTIONS = [
  "Satisfied", "Content", "Relieved",
  "Disappointed", "Frustrated", "Regret", "Angry",
];

/**
 * The entry states worth being in.
 *
 * Not "positive" — detachment is not a good mood and euphoria is a lovely one.
 * These are the states in which a decision to risk money tends to be the
 * decision you planned, which is a different axis from feeling well.
 */
export const CONSTRUCTIVE_ENTRY = new Set(["Calm", "Confident", "Patient", "Focused"]);

/**
 * Exit states that indicate the exit went to plan.
 *
 * "Relieved" is deliberately NOT here. Relief on closing usually means the
 * position had grown larger than intended or run past where it should have
 * been cut — it is a signal about the trade, not a sign of a clean exit.
 */
export const SETTLED_EXIT = new Set(["Satisfied", "Content"]);

export const isConstructiveEntry = (e) => CONSTRUCTIVE_ENTRY.has(e);
export const isSettledExit = (e) => SETTLED_EXIT.has(e);

export const STAGES = [
  { v: 1, label: "1 — Basing" },
  { v: 2, label: "2 — Advancing" },
  { v: 3, label: "3 — Topping" },
  { v: 4, label: "4 — Declining" },
];

/**
 * Stop width guidance, in percent from entry.
 *
 * Not rules — just the bands where a stop stops behaving like a stop. Past
 * roughly 10% the loss needs a much bigger winner to pay for it, and a stop
 * that wide usually means the base is loose or the entry is extended rather
 * than that the trade needs more room.
 */
export const SL_BANDS = {
  tight: 4,      // under this: little room for normal noise
  normal: 8,     // the usual range for a pivot entry out of a proper base
  wide: 12,      // beyond this, question the entry rather than the stop
};

export function slBand(slPct) {
  if (!isFinite(slPct)) return null;
  if (slPct < SL_BANDS.tight) return "tight";
  if (slPct <= SL_BANDS.normal) return "normal";
  if (slPct <= SL_BANDS.wide) return "wide";
  return "very wide";
}
