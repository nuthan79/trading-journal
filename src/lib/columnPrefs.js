/**
 * Which columns a table hides, as stored — kept pure so a probe can walk it.
 *
 * STORED AS WHAT IS HIDDEN, NOT WHAT IS SHOWN. A column added to the app next
 * month then appears for everybody by default, instead of being silently
 * missing for every user who ever touched the picker because their saved list
 * predates it.
 *
 * Anything unreadable falls back to the table's default rather than to "hide
 * nothing" or "hide everything": a corrupted value in storage is not a choice
 * the user made.
 */
export function loadHidden(raw, { defaults = [], legacy = null } = {}) {
  if (raw != null) {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v) && v.every((x) => typeof x === "string")) return new Set(v);
    } catch {}
  }
  /* Holdings had an Essentials/Everything switch for a day before this. Somebody
     who already chose Everything has said they want every column, and the new
     picker must not quietly take that back. */
  if (legacy === "all") return new Set();
  return new Set(defaults);
}

export const serializeHidden = (set) => JSON.stringify([...set].sort());
