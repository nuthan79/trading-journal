/**
 * What a trade reached, measured from daily bars.
 *
 * WHY THIS EXISTS. Until now the journal knew three prices per trade — entry,
 * the last one fetched, and exit — and nothing about the road between them.
 * That is enough to say what a trade returned and nothing at all about what it
 * offered, so the most useful question a swing journal can ask ("how much of
 * what your trades gave you did you actually take?") had no data behind it.
 *
 * The 1.5R flag on Holdings shows the shape of the gap: it reads `mark`, the
 * last price fetched, so a stock that ran to 2R on a Tuesday nobody opened the
 * app is a thing that never happened. Nothing was recorded, so nothing can be
 * reviewed.
 *
 * MEASURED ON THE DAILY CLOSE, NOT THE INTRADAY HIGH. A stock that touched 3R
 * at 11am and closed at 1.2R did not hand the trader a 3R decision — nobody
 * watching end-of-day ever saw that price, and a screen that says "you gave up
 * 3R" over it is describing an opportunity that was not on offer. The close is
 * what a swing trader acts on that evening, so the close is what every trigger
 * here uses.
 *
 * The intraday high and low are kept anyway, reported separately, because
 * "how far did this go against me before it worked" is a question about the
 * whole day rather than about a decision.
 *
 * NOTHING HERE ACCUSES ANYBODY. Every output is a fact about a price series:
 * what it reached, when, and where the trade finished relative to that. The
 * one judgement in the file — `brokeAcked` — fires only where the trader
 * themselves recorded that they had moved a stop, and even then it checks for
 * a gap first, because a position that opens below its stop was never given
 * the chance to honour it.
 */

import { hasRealStop } from "./stops";

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const iso = (d) => String(d || "").slice(0, 10);

/** Up past this in R and the stop can go to breakeven — the same line
 *  Holdings draws its flag on. Kept in step deliberately: two definitions of
 *  "risk free" is how a badge and a finding come to disagree on screen. */
export const FREE_AT_R = 1.5;

/** A move this big, this fast, is a different animal from a grind — the
 *  breakout that works immediately. Minervini's shape, and the reason the
 *  window is in TRADING days rather than calendar ones: five sessions is a
 *  week of market, whatever the holidays did. */
export const POWER_R = 3;
export const POWER_DAYS = 5;

/**
 * @param t      a trade with entry_price, stop_loss (or stop), side, dates
 * @param bars   [{ d, o, h, l, c }] ascending, any range; filtered here
 * @returns null when the trade cannot be measured, else the path summary
 */
export function tradePath(t, bars) {
  const entry = num(t?.entry_price);
  const stop = num(t?.stop_loss ?? t?.stop);
  if (!entry || !stop || !Array.isArray(bars) || !bars.length) return null;

  const dir = t.side === "short" ? -1 : 1;
  const perShare = Math.abs(entry - stop);
  if (!(perShare > 0)) return null;

  /**
   * No usable 1R, no path worth measuring — see stops.js for the one rule
   * every R figure in the app shares. An assumed stop is a number the
   * importer invented, and a trade with no stop on record has no denominator
   * at all; measuring either would put a figure on the page that the rest of
   * the app has already excluded.
   */
  if (!hasRealStop(t)) return null;

  const from = iso(t.entry_date);
  /* An open position runs to the last bar there is. */
  const to = iso(t.exit_date) || "9999-12-31";
  if (!from) return null;

  /* Entry day excluded: the bar for the day you bought contains the move
     before you were in it, and a gap-up open on the entry date would score as
     favourable excursion on a position that did not exist yet. */
  const window = bars
    .filter((b) => b && b.d > from && b.d <= to && num(b.c) != null)
    .sort((a, b) => (a.d < b.d ? -1 : 1));
  if (!window.length) return null;

  const rOf = (price) => ((num(price) - entry) * dir) / perShare;

  let mfeR = -Infinity, mfeDate = null, mfeIdx = -1;
  let maeR = Infinity, maeDate = null;
  window.forEach((b, i) => {
    const r = rOf(b.c);
    if (r > mfeR) { mfeR = r; mfeDate = b.d; mfeIdx = i; }
    if (r < maeR) { maeR = r; maeDate = b.d; }
  });
  if (!Number.isFinite(mfeR)) return null;

  /* The whole day, for the "how far against me before it worked" question the
     close cannot answer. Absent on a source that returns closes only. */
  const highs = window.map((b) => num(b.h)).filter((v) => v != null);
  const lows = window.map((b) => num(b.l)).filter((v) => v != null);
  const mfeIntradayR = highs.length ? Math.max(...highs.map(rOf)) : null;
  const maeIntradayR = lows.length ? Math.min(...lows.map(rOf)) : null;

  /**
   * Trading days, counted as BARS, not as dates apart.
   *
   * The bar series is the exchange's own record of which days it was open, so
   * counting entries in it skips weekends and every holiday without this file
   * needing to know one. `mfeIdx + 1` because the window starts the session
   * after entry: the first bar is day one.
   */
  const daysToMfe = mfeIdx >= 0 ? mfeIdx + 1 : null;

  /* The first close at or past 1.5R — when the trade became risk-free, not
     whether it ever was. A date is what makes the rest of this answerable. */
  const freeBar = window.find((b) => rOf(b.c) >= FREE_AT_R);
  /* Power is about the first N sessions only. A trade that reaches 3R in its
     fourth month is a good trade and a different phenomenon. */
  const powerBar = window
    .slice(0, POWER_DAYS)
    .find((b) => rOf(b.c) >= POWER_R);

  const finalR = num(t.r) != null ? num(t.r)
    : num(t.exit_price) != null ? rOf(t.exit_price)
    : null;

  /**
   * A GAP IS NOT INDISCIPLINE, AND TELLING THEM APART IS THE WHOLE POINT OF
   * HAVING BARS.
   *
   * A position that opens below breakeven was never offered the chance to exit
   * there — the price simply was not available. One that drifted down through
   * it during the session was. Without this distinction any check on "you
   * closed below breakeven" accuses a trader of hesitating over a gap-down
   * they could do nothing about, which is exactly the caveat the stop
   * discipline card already carries in prose.
   *
   * A GAP IS A DISCONTINUITY FROM THE PREVIOUS CLOSE, not a price below entry.
   * The first version of this compared the session's open against entry, which
   * calls every downtrend a gap: once a trade is under water its opens are
   * under water too, and the check would have cleared every trader of
   * everything, silently.
   *
   * The real question is whether the market ever printed breakeven. It did if
   * the previous session closed at or above it and this one opened below —
   * price jumped the level rather than trading through it. If the session
   * OPENED above breakeven and closed below, breakeven traded during the day
   * and was there to be taken.
   */
  let gappedThroughBreakeven = null;
  if (freeBar) {
    const startAt = window.findIndex((b) => b.d > freeBar.d);
    if (startAt > 0) {
      const i = window.findIndex((b, k) => k >= startAt && rOf(b.c) < 0);
      if (i > 0) {
        const o = num(window[i].o);
        const prevC = num(window[i - 1].c);
        /* No open, or no prior bar, means no answer — and no answer must not
           read as "did not gap", since that is the direction that accuses
           somebody of something the data cannot show. */
        gappedThroughBreakeven = o == null || prevC == null
          ? null
          : rOf(prevC) >= 0 && rOf(o) < 0;
      }
    }
  }

  return {
    bars: window.length,
    from: window[0].d,
    to: window[window.length - 1].d,

    mfeR: +mfeR.toFixed(2),
    mfeDate,
    daysToMfe,
    maeR: +maeR.toFixed(2),
    maeDate,
    mfeIntradayR: mfeIntradayR == null ? null : +mfeIntradayR.toFixed(2),
    maeIntradayR: maeIntradayR == null ? null : +maeIntradayR.toFixed(2),

    becameFreeOn: freeBar ? freeBar.d : null,
    everFree: !!freeBar,
    isPower: !!powerBar,
    powerOn: powerBar ? powerBar.d : null,

    finalR: finalR == null ? null : +finalR.toFixed(2),
    gappedThroughBreakeven,
  };
}

/**
 * The two named outcomes, and the one self-declared inconsistency.
 *
 * Kept apart from `tradePath` because that function reports a price series and
 * these interpret it against what the trader did. Both are deliberately
 * neutral — `roundTripped` says a trade gave back what it had, which is a fact
 * about the trade; only `brokeAcked` is about the person, and it requires them
 * to have said, in their own click, that the stop was moved.
 */
export function pathOutcomes(t, path) {
  if (!path || path.finalR == null) return null;

  /* Reached the point where the stop could go to breakeven, and finished at or
     below entry anyway. No claim about why. */
  const roundTripped = path.everFree && path.finalR <= 0;

  /* Same shape on the fastest movers, where it costs the most: in a breakout
     book the trades that run 3R in a week are the ones paying for the losers. */
  const powerGivenBack = path.isPower && path.finalR <= 1;

  /**
   * The only judgement in this file.
   *
   * `breakeven_ack_at` is the trader clicking "I have moved this stop to
   * breakeven at my broker" — migration 017, and it touches nothing else. So a
   * position that was acked and then closed below entry ANYWAY, on a session
   * that did not gap through it, is the journal reporting a difference between
   * what they said they had done and where the trade ended. That is worth
   * naming, and it is theirs, not ours: the app never asserts the stop should
   * have been moved, only that they said it was.
   */
  const brokeAcked = !!t?.breakeven_ack_at &&
    path.finalR < 0 &&
    path.gappedThroughBreakeven === false;

  return {
    roundTripped,
    powerGivenBack,
    brokeAcked,
    /* What was taken of what was offered. Null unless the trade actually went
       somewhere: capture out of a non-positive MFE is a ratio of two numbers
       that do not mean what the phrase implies. */
    capture: path.mfeR > 0.1 ? +(path.finalR / path.mfeR).toFixed(2) : null,
  };
}
