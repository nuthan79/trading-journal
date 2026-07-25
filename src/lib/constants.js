/**
 * The dropdown vocabularies, in one place.
 *
 * These lists are journal schema in everything but name — once you've tagged
 * fifty trades with a label, renaming it orphans the history. So add freely,
 * but rename only deliberately.
 */

export const PATTERNS = [
  "VCP",
  "Cup & Handle",
  "Flat Base",
  "Double Bottom",
  "High Tight Flag",
  "Ascending Base",
  "Power Play",
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
];

/** Tags that describe what the market did, not what you did wrong. */
export const NEUTRAL_TAGS = new Set(["Setup failed"]);

export const isExecutionError = (tag) => !NEUTRAL_TAGS.has(tag);

export const EMOTIONS = [
  "Calm", "Confident", "Patient", "Detached",
  "FOMO", "Hesitant", "Impatient", "Anxious", "Frustrated", "Euphoric",
];

export const STAGES = [
  { v: 1, label: "1 — Basing" },
  { v: 2, label: "2 — Advancing" },
  { v: 3, label: "3 — Topping" },
  { v: 4, label: "4 — Declining" },
];

export const EXCHANGES = ["NSE", "BSE"];

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
