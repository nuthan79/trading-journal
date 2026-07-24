export const EXCHANGES = ["NSE", "BSE"];

export const PATTERNS = [
  "VCP", "Cup & Handle", "Flat Base", "Double Bottom",
  "High Tight Flag", "Ascending Base", "Power Play",
  "Pullback Entry", "Other",
];

export const EXIT_REASONS = [
  "Stop hit", "Trailing stop", "Sold into strength", "Target reached",
  "Time stop", "Broke support", "Market conditions", "Discretionary",
];

export const MISTAKES = [
  "Chased extended", "No volume confirmation", "Ignored the stop",
  "Oversized", "Undersized", "Averaged down", "Sold too early",
  "Traded against market trend", "Not a real base", "Revenge trade",
];

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
