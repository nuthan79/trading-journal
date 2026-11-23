/**
 * Listings that changed their name — the same company under a new symbol.
 *
 * WHY THIS EXISTS. Prices are asked for by symbol, so the day NSE lists
 * NOVARTIND as EVONILE, a position stored under the old name quietly stops
 * pricing. Nothing errors: the mark is simply missing, which reads the same as
 * a slow quote. Every rebuild of public/symbols.json can see a rename happen —
 * an ISIN that was under one symbol is now under another — and nothing else
 * ever can, because the old name is gone from the new file.
 *
 * So scripts/build-symbols.mjs compares the file it is about to write with the
 * one it replaces, and keeps what it finds in public/renames.json:
 *
 *   { "NSE:NOVARTIND": { to: "EVONILE", since: "2026-11-23" }, … }
 *
 * keyed by exchange, because NSE and BSE spell a company differently and
 * rename it on different days. `since` is the day a rebuild first SAW it, not
 * the day the exchange did it — the builds run weekly, so it can lag.
 *
 * ONLY A POSITIVE MATCH. A held symbol missing from today's list is not
 * evidence of anything: SME listings are not in the file at all, and a
 * suspension drops a name without renaming it. Marking those would put a
 * warning on positions that are fine. A rename is only claimed where an ISIN
 * moved from one symbol to another on the same exchange.
 *
 * India only: the US file carries no ISIN to follow.
 *
 * Pure, no imports — the build script reads this file too.
 */

/** Renames between two builds of symbols.json, as { "E:OLD": { to, since } }. */
export function findRenames(previous = [], next = [], since = "") {
  const listed = new Set(next.map((r) => `${r.e}:${r.s}`));
  const nowAt = new Map();               // "E:ISIN" → symbol in the new file
  for (const r of next) {
    if (r.i && !nowAt.has(`${r.e}:${r.i}`)) nowAt.set(`${r.e}:${r.i}`, r.s);
  }
  const out = {};
  for (const r of previous) {
    if (!r.i || listed.has(`${r.e}:${r.s}`)) continue;    // still listed as it was
    const to = nowAt.get(`${r.e}:${r.i}`);
    if (to && to !== r.s) out[`${r.e}:${r.s}`] = { to, since };
  }
  return out;
}

/**
 * The record so far, with this build's finds added.
 *
 * A chain collapses — A became B, then B became C, so A now points at C.
 * An old name that is listed again drops out: it prices once more, and may be
 * a different company that took the name.
 */
export function mergeRenames(existing = {}, found = {}, next = []) {
  const listed = new Set(next.map((r) => `${r.e}:${r.s}`));
  const all = { ...existing, ...found };
  const out = {};
  for (const [key, rec] of Object.entries(all)) {
    if (listed.has(key)) continue;
    const ex = key.slice(0, key.indexOf(":"));
    let to = rec.to;
    const seen = new Set([key]);
    while (all[`${ex}:${to}`] && !seen.has(`${ex}:${to}`)) {
      seen.add(`${ex}:${to}`);
      to = all[`${ex}:${to}`].to;
    }
    out[key] = { to, since: rec.since };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** The new name for a held symbol, or null. A missing exchange means NSE. */
export function renamedTo(renames, symbol, exchange) {
  if (!renames || !symbol) return null;
  const ex = String(exchange || "NSE").toUpperCase();
  return renames[`${ex}:${String(symbol).toUpperCase()}`] || null;
}
