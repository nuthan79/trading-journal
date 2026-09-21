/**
 * What the split check already knows, remembered per browser.
 *
 * THE COST IT EXISTS TO AVOID. A book of 297 distinct listings is 297
 * upstream lookups, about 370ms each and six at a time: roughly eighteen
 * seconds of work. It never blocked the page — the table draws first and the
 * card appears when the answer arrives — but repeating it on every visit to
 * Holdings is eighteen seconds of somebody's quota and electricity for an
 * answer that changes a few times a year.
 *
 * SO IT IS ASKED PER SYMBOL, AND RARELY:
 *
 *   a stock you still hold      once a day
 *   a stock you only used to    once a week
 *
 * because a split matters urgently on a position whose figures are on screen,
 * and a closed trade's numbers are already wrong or already right — another
 * day changes nothing. A corporate action is announced weeks ahead, so even
 * the daily one is far quicker than the news.
 *
 * WHAT IS STORED: the answer, not the question — `{ at, splits }` per symbol,
 * including the empty answer, which is most of them and the whole point. A
 * stock that has never split is the common case and must cost nothing to
 * know twice.
 *
 * Every access is guarded: a private window and blocked site data both throw,
 * and the check must degrade to "ask again" rather than take the page down.
 */

const KEY = "ledgerr:splits";
const DAY = 24 * 60 * 60 * 1000;

/** How long an answer stays good, by whether the stock is still held. */
export const TTL_HELD = DAY;
export const TTL_CLOSED = 7 * DAY;

export function loadSplitCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function saveSplitCache(cache) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* Full, private, or blocked. The check simply asks again next time. */
  }
}

/**
 * Which symbols are worth asking about right now.
 *
 * `heldKeys` are the ones on screen; everything else in `allKeys` is history
 * and waits a week. An entry with no timestamp is treated as unknown rather
 * than as fresh — the conservative way round.
 */
export function staleKeys(allKeys = [], heldKeys = [], cache = {}, now = Date.now()) {
  const held = new Set(heldKeys);
  return allKeys.filter((k) => {
    const at = Number(cache[k]?.at);
    if (!Number.isFinite(at)) return true;
    return now - at > (held.has(k) ? TTL_HELD : TTL_CLOSED);
  });
}

/** The cached answers, in the shape `splitPlan` consumes. */
export function splitsFromCache(keys = [], cache = {}) {
  const out = {};
  for (const k of keys) {
    const got = cache[k]?.splits;
    if (got?.length) out[k] = got;
  }
  return out;
}

/** Fold a fresh answer in, remembering the empty ones too. */
export function mergeIntoCache(cache, asked = [], got = {}, now = Date.now()) {
  const next = { ...cache };
  for (const k of asked) next[k] = { at: now, splits: got[k] || [] };
  return next;
}
