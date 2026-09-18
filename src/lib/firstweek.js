/**
 * The first-week path: three things that make a journal worth having, and
 * whether each is done.
 *
 * WHY THREE AND WHY THESE. A journal with no trades has nothing to show; a
 * trade with no real stop has no R, and R is what every figure in this app is
 * measured in; and the diary is the half that explains the other half. In
 * that order, because each makes the next one mean something.
 *
 * IT MUST NEVER NAG, which is most of what this function is for. It shows
 * only while the journal is new — within two weeks of setup, or while there
 * is still nothing in it — and not once everything is done. Dismissing it is
 * the component's business, and final.
 *
 * READS REAL DATA ONLY. The sample book fills an empty journal with trades and
 * diary entries; counting those would tick a new user's steps for them before
 * they had done anything. Callers pass the user's own counts.
 */

export const FIRST_WEEK_DAYS = 14;

export function firstWeek({ trades = 0, needStops = 0, assumedStops = 0,
                            diary = 0, onboardedAt = null, now = new Date() } = {}) {
  const steps = [
    { key: "trades", done: trades > 0 },
    /* Only done once there is something to have a stop. Zero trades missing a
       stop out of zero trades is not a finished step. */
    { key: "stops", done: trades > 0 && needStops === 0 && assumedStops === 0,
      pending: needStops + assumedStops },
    { key: "diary", done: diary > 0 },
  ];
  const allDone = steps.every((s) => s.done);

  const since = onboardedAt ? (now - new Date(onboardedAt)) / 86400000 : NaN;
  const isNew = trades === 0 || (Number.isFinite(since) && since <= FIRST_WEEK_DAYS);

  return { show: !allDone && isNew, steps, doneCount: steps.filter((s) => s.done).length };
}
