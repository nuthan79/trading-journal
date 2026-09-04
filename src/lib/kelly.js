/**
 * How much the record says you could risk — and why it is not the answer.
 *
 * The classic Kelly formula takes a win rate and a payoff ratio and returns
 * the bet size that maximises long-run growth. It is the wrong tool here, for
 * a reason this journal can see and a spreadsheet cannot: it collapses the
 * whole distribution into two numbers, a mean win and a mean loss.
 *
 * A swing book is not two outcomes. One +140R trade drags the mean win far
 * above anything typical, and Kelly built on it prescribes a bet size the
 * ordinary trade never justified. Meanwhile the number that actually binds —
 * the WORST loss, the one that decides how much can be risked before a single
 * trade is unsurvivable — does not appear in the formula at all.
 *
 * So this maximises expected log growth over the ACTUAL R multiples:
 *
 *     g(f) = mean over trades of ln(1 + r · f)
 *
 * Every trade votes with its own size. The fat tail is in there at its real
 * frequency rather than as a mean, and the worst loss binds the search
 * directly: `1 + r·f` must stay positive for every trade, so f can never be
 * large enough for the worst trade in the record to have wiped the account.
 *
 * WHAT IT IS STILL NOT. Kelly assumes you know your edge. You do not — you
 * have an estimate off a finite sample, and the estimate moves. Full Kelly on
 * an overstated edge is not merely aggressive, it is negative-growth, and the
 * penalty is asymmetric: betting half the optimum costs a quarter of the
 * growth, betting double it loses money. Everything here reports the quarter
 * fraction for that reason, and the full figure only as the ceiling it is.
 */

/** Below this the mean is an anecdote and any fraction built on it is noise. */
export const KELLY_MIN_TRADES = 30;

/**
 * A quarter, not a half.
 *
 * Half-Kelly is the usual textbook hedge against estimation error. A quarter
 * is the right hedge HERE because two of this app's own realities compound:
 * an R multiple depends on a stop that was sometimes assumed rather than
 * recorded, and a swing book's tail means the sample mean is still moving
 * after a hundred trades. Both push the estimate up more often than down.
 */
export const KELLY_FRACTION = 0.25;

export function kellyFromR(rs, { fraction = KELLY_FRACTION } = {}) {
  const xs = (rs || []).filter((x) => Number.isFinite(x));
  const n = xs.length;
  if (n < KELLY_MIN_TRADES) return { method: "thin", n };

  const meanR = xs.reduce((a, b) => a + b, 0) / n;
  const worst = Math.min(...xs);

  /* No edge, no fraction. Any positive bet on a negative expectancy loses
     money faster the larger it is, and there is no size that fixes it. */
  if (meanR <= 0) return { method: "no-edge", n, meanR, worst };
  /* A record with no losing trade gives the search no upper bound — it would
     run to infinity and report it. Not a real book; refuse rather than
     print a number that means "bet everything". */
  if (worst >= 0) return { method: "no-loss", n, meanR, worst };

  /* The hard ceiling: at 1/|worst| the worst trade in the record takes the
     account to exactly zero. Everything below is the search space. */
  const fMax = 1 / Math.abs(worst);
  const g = (f) => {
    let s = 0;
    for (const r of xs) {
      const v = 1 + r * f;
      if (v <= 0) return -Infinity;
      s += Math.log(v);
    }
    return s / n;
  };

  /* Golden-section on a concave objective. Bisection on the derivative would
     also work; this needs no derivative and cannot step outside the bracket. */
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = 1e-9, b = fMax * (1 - 1e-9);
  let c = b - phi * (b - a), d = a + phi * (b - a);
  let gc = g(c), gd = g(d);
  for (let i = 0; i < 160 && b - a > 1e-12; i++) {
    if (gc > gd) { b = d; d = c; gd = gc; c = b - phi * (b - a); gc = g(c); }
    else { a = c; c = d; gc = gd; d = a + phi * (b - a); gd = g(d); }
  }
  const full = (a + b) / 2;

  return {
    method: "ok",
    n, meanR, worst,
    full,                       // fraction of capital, e.g. 0.09 = 9% a trade
    suggested: full * fraction,
    fraction,
    ceiling: fMax,
    /* Pinned against the ceiling means the search never found an interior
       peak — the edge as recorded is large enough that the only thing
       stopping it is the worst trade. Always worth saying out loud. */
    atCeiling: full > fMax * 0.98,
    growth: g(full),
    growthSuggested: g(full * fraction),
  };
}

/** Expected log growth per trade at an arbitrary risk fraction, for comparison. */
export function growthAt(rs, f) {
  const xs = (rs || []).filter((x) => Number.isFinite(x));
  if (!xs.length || !(f > 0)) return NaN;
  let s = 0;
  for (const r of xs) {
    const v = 1 + r * f;
    if (v <= 0) return -Infinity;
    s += Math.log(v);
  }
  return s / xs.length;
}
