import { stats } from "./calc";

/**
 * The six calculator inputs, measured from a real journal instead of guessed.
 *
 * WHY THIS IS NOT IN `expectancy.js`. That file is served to logged-out
 * visitors on the public calculator, and it is deliberately dependency-free so
 * the page ships almost nothing. This one imports `calc.js` — the whole
 * journal's aggregate maths — and belongs on the authenticated side only.
 *
 * WHY IT REUSES `stats()` RATHER THAN COUNTING AGAIN. Win rate, average win
 * and average loss already have one definition in this codebase, including the
 * detail that a scratch trade at exactly 0R counts as a loss rather than a win.
 * Recomputing them here would produce a screen whose "average win" quietly
 * disagreed with the Performance sheet's, and the disagreement would be
 * invisible until somebody put the two side by side. One definition.
 *
 * ASSUMED STOPS ARE EXCLUDED, which is the rule everywhere else that touches R
 * (`analysis.js` does the same). A stop the importer invented is not risk the
 * trader chose, so an R computed against it is arithmetic on a number nobody
 * decided. The count is returned rather than dropped silently — those trades
 * are fixable in the /stops queue, and knowing how many are missing is what
 * makes fixing them feel worth doing.
 */

/** Below this the numbers are noise, and prefilling them would dress a guess
 *  up as a measurement — worse than showing nothing. The R-multiple article
 *  puts it at "roughly twenty trades in"; ten is the floor where the shape of
 *  a distribution starts to exist at all. */
export const MIN_SAMPLE = 10;

/** Below this it is a real measurement with a real error bar, and the screen
 *  says so rather than implying the third decimal means anything. */
export const THIN_SAMPLE = 30;

/** One decimal, which is the finest step any of the calculator's sliders take. */
const round1 = (x) => Math.round(x * 10) / 10;

const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * @param closed  Derived closed positions — rows that have been through
 *                `derivePosition`, so `r` and `riskPct` exist.
 * @param opts    accountSize for the projection's starting capital, and
 *                defaultRiskPct as the fallback when no trade carries a
 *                computable risk.
 * @returns null when there is not enough to measure; otherwise the six inputs
 *          plus the context the UI needs to caveat them honestly.
 */
export function edgePrefill(closed = [], { accountSize, defaultRiskPct } = {}) {
  /* Assumed stops out first, then non-computable R. Order matters only for the
     counts: `assumedCount` should report trades excluded for having an invented
     stop, not trades that were also missing an exit price. */
  const withRealStop = closed.filter((t) => t.stop_source !== "assumed");
  const assumedCount = closed.length - withRealStop.length;

  const usable = withRealStop.filter((t) => Number.isFinite(t.r));
  const noRCount = withRealStop.length - usable.length;

  if (usable.length < MIN_SAMPLE) {
    return { ready: false, sampleSize: usable.length, assumedCount, noRCount };
  }

  const S = stats(usable);

  /**
   * Risk per trade taken from what was actually risked, not from the setting.
   *
   * The profile's default is an intention; the median of what the positions
   * really carried is the behaviour. They differ more often than people
   * expect — usually because a few positions were sized up on conviction —
   * and the projection is about behaviour. Median rather than mean so one
   * oversized position does not drag it.
   */
  const risks = usable.map((t) => t.riskPct).filter((x) => Number.isFinite(x) && x > 0);
  const medianRisk = median(risks);

  /**
   * Pace from the real calendar span, not from dividing by however many months
   * the year happens to contain. Someone who took forty trades in one busy
   * quarter does not trade thirteen a month forever, but that quarter is the
   * only evidence there is — so the span is measured end to end and the caller
   * is told how long it covers.
   */
  const times = usable
    .map((t) => new Date(t.exit_date || t.entry_date).getTime())
    .filter((x) => Number.isFinite(x));
  const months = times.length > 1
    ? Math.max(0.5, (Math.max(...times) - Math.min(...times)) / (1000 * 60 * 60 * 24 * 30.44))
    : 1;

  /**
   * A journal with no losing trades yet.
   *
   * `stats()` reports avgLoss 0, which would make the break-even win rate ~0%
   * and the profit factor infinite — a screen announcing a flawless system to
   * somebody who has simply not lost yet. Substituting 1R keeps every figure
   * meaningful and `noLosses` tells the UI to say plainly that one number is
   * a placeholder rather than a measurement.
   */
  const noLosses = !(S.avgLoss > 0);
  const noWins = !(S.avgWin > 0);

  return {
    ready: true,
    sampleSize: usable.length,
    assumedCount,
    noRCount,
    months,
    noLosses,
    noWins,
    thin: usable.length < THIN_SAMPLE,
    /**
     * Exactly the shape `ExpectancyCalculator` takes as `prefill` — and rounded
     * to the precision its sliders can actually represent.
     *
     * Measured values are full-precision floats: a 42.857142857142854% win rate
     * is the honest quotient of 18 winners over 42 trades. It is also not a
     * position a slider with a step of 1 can hold, and it rendered as those
     * seventeen digits in the readout. Rounding here rather than at display
     * time keeps the number you see, the slider position, and the value the
     * maths uses as one thing — formatting it late would have left the three
     * quietly disagreeing.
     *
     * The cost is real and tiny: expectancy recomputed from rounded inputs
     * moves by well under 0.01R, far below the error bar on any sample a
     * private trader will ever have.
     */
    values: {
      winRate: Math.round(S.winRate),
      avgWin: round1(S.avgWin > 0 ? S.avgWin : 1),
      avgLoss: round1(noLosses ? 1 : S.avgLoss),
      /* At least 1: someone with 12 trades across two years genuinely averages
         0.5 a month, and a slider pinned to zero would project nothing at all. */
      tradesPerMonth: Math.max(1, Math.round(usable.length / months)),
      riskPct: round1(
        Number.isFinite(medianRisk) && medianRisk > 0 ? medianRisk : (defaultRiskPct || 1)
      ),
      capital: Math.round(accountSize || 500000),
    },
  };
}
