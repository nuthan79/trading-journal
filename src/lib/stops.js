/**
 * What the journal knows about a trade's stop, in one place.
 *
 * WHY IT EXISTS. Nine files each wrote `stop_source !== "assumed"` to mean
 * "this trade's 1R can be trusted". Nine copies of a rule is nine places to
 * miss when the rule gains a case — and it just did. Two definitions of "risk
 * free" already cost a broken build on this codebase; nine definitions of
 * "measurable" would have gone out silently, with a third of the app quietly
 * counting trades the rest of it had excluded.
 *
 * THREE STATES, AND THE THIRD IS NOT A KIND OF THE SECOND.
 *
 *   recorded  a stop the trader set. R means what it says.
 *   assumed   the importer invented one, because the broker file carried no
 *             stop column. A TO-DO: it can still be corrected.
 *   none      there is no stop on record and there never will be. SETTLED.
 *
 * The difference between the last two is the whole point. Before `none`
 * existed the stops queue could not empty: the only ways out were typing a
 * number that was not true, which corrupts every R downstream, or leaving it
 * assumed, which nags for ever. A trader whose broker files never carried
 * stops had no honest move.
 *
 * NAMED FOR WHAT IS KNOWABLE, NOT FOR WHAT THEY DID. "No stop on record" is
 * always true of these trades. "I traded without a stop" often is not — a
 * Zerodha tax P&L has no stop column, so the importer assumed one because the
 * FILE lacked it, not because the trader did. On a trade from 2019 nobody can
 * say which, and the app should not put words in their mouth to clear a
 * counter.
 *
 * WHAT IT CHANGES AND WHAT IT DOES NOT. A trade with no stop on record sits
 * out of every R statistic, because there is no 1R to measure against. It
 * stays in every money statistic — net P&L, win rate by count, XIRR, holding
 * period — all of which are perfectly knowable without one.
 */

export const STOP_RECORDED = "recorded";
export const STOP_ASSUMED = "assumed";
export const STOP_NONE = "none";

/**
 * Is this trade's 1R real?
 *
 * The single test behind every R figure in the app. An assumed stop is a
 * number the importer chose, and R against it is R against a percentage
 * nobody agreed to; a trade with no stop on record has no denominator at all.
 * Both are excluded, for different reasons, by one rule.
 */
export const hasRealStop = (t) =>
  !!t &&
  /**
   * A stop has to EXIST before it can be trusted, and the first version of
   * this forgot to say so.
   *
   * `stop_loss` is nullable — migration 006 dropped the NOT NULL that
   * schema.sql still shows — and an import with no stop writes null to both
   * columns. A source of null is neither "assumed" nor "none", so those rows
   * were passing a test named "has a real stop" while having no stop at all.
   *
   * Nothing broke, because every caller also demanded a finite R and a trade
   * with no stop has none. That is luck rather than design: the predicate was
   * relying on its callers to catch what its own name promised.
   */
  t.stop_loss != null &&
  t.stop_source !== STOP_ASSUMED && t.stop_source !== STOP_NONE;

/** Nothing on record, and the trader has said so. Not a gap — an answer. */
export const noStopOnRecord = (t) => !!t && t.stop_source === STOP_NONE;

/**
 * Still owed an answer, and therefore still in the queue.
 *
 * `none` is deliberately absent: it is resolved. Counting it as outstanding
 * is what made the queue impossible to empty in the first place.
 */
export const needsStop = (t) =>
  !!t && (t.stop_loss == null || t.stop_source === STOP_ASSUMED);
