/**
 * The arithmetic of an edge: expectancy, break-even win rate, and what a
 * system compounds to.
 *
 * WHY THIS IS ITS OWN PURE MODULE. Two callers want it and they have nothing
 * else in common: a public page where a stranger types five numbers, and (next)
 * an in-app tab that fills those same five numbers from the trades already in
 * somebody's journal. Neither should own the maths. Nothing here touches
 * Supabase, the DOM, or a trade row — it takes numbers and returns numbers, so
 * it is safe to ship to a logged-out visitor and testable without a database.
 *
 * EVERYTHING IS IN R, NOT RUPEES. Win rate alone tells you nothing — 70%
 * winners at 0.4R each loses money — and a rupee average tells you nothing
 * either, because it hides how much was risked to earn it. R is the only unit
 * where a single number decides whether a system makes money, which is the
 * entire reason this app measures in it.
 *
 * THE PROJECTION COMPOUNDS GEOMETRICALLY, ON PURPOSE. The obvious way to
 * project growth is expectancy × trades × risk, compounded. It is also wrong,
 * and wrong in the flattering direction: a +1R and a −1R at 2% risk do not
 * cancel, they leave you at 99.96% of where you started. That gap — volatility
 * drag — is small per trade and enormous over ten years, and every calculator
 * that ignores it promises numbers nobody has ever achieved. `projection()`
 * uses the expected log return instead, so the curve is the one an actual
 * account follows. `arithmeticFinal()` exists only so the page can show the
 * difference and explain it.
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback = 0) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * The inputs, normalised.
 *
 * Every field is clamped rather than validated-and-rejected because this drives
 * live sliders: a half-typed "1." in a text box must not blank the whole
 * results panel. Losses are stored as a positive magnitude — a user thinking
 * about "my average loss is 1.1R" does not want to type a minus sign, and
 * letting the sign in twice is how a losing system reads as profitable.
 */
export function normalise(input = {}) {
  return {
    winRate:      clamp(num(input.winRate, 50), 0, 100),
    avgWin:       clamp(num(input.avgWin, 2), 0, 20),
    avgLoss:      clamp(Math.abs(num(input.avgLoss, 1)), 0.01, 20),
    tradesPerMonth: clamp(num(input.tradesPerMonth, 8), 0.1, 200),
    riskPct:      clamp(num(input.riskPct, 1), 0.01, 100),
    capital:      Math.max(0, num(input.capital, 500000)),
  };
}

/**
 * Expectancy and everything that follows directly from it.
 *
 * `expectancyR` is the number that matters: the average R a trade returns over
 * many trades. Positive is an edge, negative is a hobby, and no amount of
 * position sizing or discipline converts one into the other.
 */
export function edge(input) {
  const { winRate, avgWin, avgLoss, tradesPerMonth, riskPct } = normalise(input);
  const w = winRate / 100;
  const l = 1 - w;

  const expectancyR = w * avgWin - l * avgLoss;

  /**
   * The win rate at which this reward/risk exactly breaks even.
   *
   * The most useful line on the page, because it reframes the question. People
   * argue about whether 45% is a good win rate; the answer is that at 2:1 you
   * need 33%, so 45% is a real edge — and at 0.5:1 you need 67%, so 45% is a
   * slow death. Same win rate, opposite verdicts.
   */
  const breakevenWinRate = (avgLoss / (avgWin + avgLoss)) * 100;

  /** Gross wins ÷ gross losses. Infinite when nothing ever loses, which is a
   *  display problem rather than a maths one — the UI shows a dash. */
  const grossWin = w * avgWin;
  const grossLoss = l * avgLoss;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : null;

  return {
    winRate, avgWin, avgLoss, tradesPerMonth, riskPct,
    expectancyR,
    /** What one trade is worth as a percentage of the account, at this risk. */
    expectancyPct: expectancyR * riskPct,
    breakevenWinRate,
    /** Signed: positive means the win rate has room to spare. */
    edgeOverBreakeven: winRate - breakevenWinRate,
    profitFactor,
    monthlyR: expectancyR * tradesPerMonth,
    annualR: expectancyR * tradesPerMonth * 12,
    positive: expectancyR > 0,
  };
}

/**
 * Expected log growth per trade — the honest compounding rate.
 *
 * A win multiplies the account by (1 + avgWin × risk); a loss multiplies it by
 * (1 − avgLoss × risk). Growth is multiplicative, so the average that predicts
 * a long run is the average of the logarithms, not of the returns.
 *
 * RUIN IS REPRESENTED, NOT HIDDEN. If avgLoss × risk reaches 1 a single losing
 * trade takes the whole account and the log is −∞. Rather than let that render
 * as NaN somewhere downstream, it returns null and callers show the account as
 * wiped. It is not a hypothetical: 20% risk with an average 5R loser gets
 * there, and someone will type exactly that to see what happens.
 */
export function logGrowthPerTrade({ winRate, avgWin, avgLoss, riskPct }) {
  const w = winRate / 100;
  const r = riskPct / 100;
  const lossLeg = 1 - avgLoss * r;
  if (lossLeg <= 0) return null;
  return w * Math.log(1 + avgWin * r) + (1 - w) * Math.log(lossLeg);
}

/**
 * The growth curve, year by year.
 *
 * Yearly points rather than per-trade ones because the chart is read as a
 * shape, and ten years of monthly detail is noise at this size. Trades are
 * fractional across a year deliberately — 4 trades a month is 48 a year, and
 * rounding each year to whole trades introduces a stair-step that looks like
 * a modelling decision when it is a rounding artefact.
 */
/**
 * The rate above which the projection stops being a number and becomes noise.
 *
 * SET HIGH ON PURPOSE. The first attempt used 100%, which is the right line for
 * "has anyone actually done this" — Medallion, the best documented run in
 * existence, is about 66% gross — but the wrong line for refusing to answer.
 * It fired on 45% winners at 3R, which is an ambitious, arguable set of inputs
 * a real person might genuinely believe about themselves, and telling them
 * their system "does not describe reality" is both rude and wrong.
 *
 * 300% is where the OUTPUT becomes meaningless rather than merely optimistic:
 * ₹5 lakh compounding to something north of ₹2,000 crore. Past here the figure
 * carries no information, and at the top of the range it broke the formatter
 * outright — an 80% win rate with a 9.5R average winner printed the literal
 * string "₹2.1512646478529814e+28 Cr" on a public page. A tool that reports
 * that with a straight face discredits every correct number beside it.
 *
 * Inputs that are optimistic but not absurd get `OPTIMISTIC_EXPECTANCY`
 * instead, which cautions without hiding anything.
 */
export const IMPLAUSIBLE_CAGR = 300;

/**
 * Expectancy above which a note is warranted but nothing is withheld.
 *
 * Real systems that work well land between roughly 0.2R and 0.5R a trade.
 * Above 0.6R is genuinely rare, and it is far more often a sign of a
 * remembered win rate than of an exceptional edge — but it is not impossible,
 * so the page says so and still shows every figure.
 */
export const OPTIMISTIC_EXPECTANCY = 0.6;

export function projection(input, years = 10) {
  const n = normalise(input);
  const g = logGrowthPerTrade(n);
  const tradesPerYear = n.tradesPerMonth * 12;

  const points = [];
  for (let y = 0; y <= years; y++) {
    const value = g == null ? (y === 0 ? n.capital : 0)
                            : n.capital * Math.exp(g * tradesPerYear * y);
    points.push({ year: y, value, trades: Math.round(tradesPerYear * y) });
  }

  const final = points[points.length - 1].value;
  const cagr = n.capital > 0 && final > 0 && years > 0
    ? (Math.pow(final / n.capital, 1 / years) - 1) * 100
    : (g == null ? -100 : 0);

  return {
    points,
    final,
    cagr,
    totalReturnPct: n.capital > 0 ? ((final - n.capital) / n.capital) * 100 : 0,
    tradesPerYear,
    totalTrades: Math.round(tradesPerYear * years),
    /** True when a single loss would end the account — the UI says so plainly
     *  instead of drawing a flat line at zero and leaving it a mystery. */
    ruin: g == null,
    /** True when the inputs compound past anything on record. See
     *  IMPLAUSIBLE_CAGR — the UI replaces the figures with an explanation. */
    implausible: g != null && cagr > IMPLAUSIBLE_CAGR,
  };
}

/**
 * What the same inputs would show without volatility drag.
 *
 * Only ever displayed next to the real figure, as the gap. Shown alone it is
 * the lie every other projector tells.
 */
export function arithmeticFinal(input, years = 10) {
  const n = normalise(input);
  const perTrade = (edge(n).expectancyPct) / 100;
  const trades = n.tradesPerMonth * 12 * years;
  return n.capital * Math.pow(1 + perTrade, trades);
}

/**
 * Three futures from one set of inputs.
 *
 * WHY WIN RATE IS THE VARIABLE. It is the input people are least able to
 * estimate about themselves and the one that moves the answer most, so
 * ±5 points is where the honest uncertainty lives. The point of showing three
 * is not precision — it is that a projection presented as a single number gets
 * read as a forecast, and three make it obvious it is arithmetic on an
 * assumption.
 */
export function scenarios(input, years = 10) {
  const n = normalise(input);
  const shift = (delta) => projection({ ...n, winRate: clamp(n.winRate + delta, 0, 100) }, years);
  return [
    { key: "low",  label: "Conservative", note: "5 points lower win rate", ...shift(-5) },
    { key: "base", label: "Your numbers", note: "As entered",              ...shift(0) },
    { key: "high", label: "Optimistic",   note: "5 points higher win rate", ...shift(+5) },
  ];
}

/**
 * The profitability grid: which win-rate / reward-risk pairs actually make
 * money.
 *
 * This is the part worth linking to. Expectancy for one set of inputs answers
 * a question; the grid answers the question behind it — traders who cannot say
 * whether their own system is viable can nearly always find themselves on a
 * grid, and the diagonal break-even boundary is a thing you only really learn
 * by seeing it.
 *
 * Loss is fixed at 1R because that is what reward:risk means, and because a
 * grid with three free variables is a spreadsheet, not a picture.
 */
export const MATRIX_WIN_RATES = [20, 30, 35, 40, 45, 50, 55, 60, 70, 80];
export const MATRIX_RR = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];

export function matrix(current) {
  const here = current ? normalise(current) : null;
  /** Which cell to outline as "you are here" — nearest on both axes, so it
   *  lands somewhere for any input rather than only on exact matches. */
  const nearest = (arr, v) =>
    arr.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), arr[0]);
  const hereWin = here ? nearest(MATRIX_WIN_RATES, here.winRate) : null;
  const hereRR = here ? nearest(MATRIX_RR, here.avgWin / here.avgLoss) : null;

  return MATRIX_RR.map((rr) => ({
    rr,
    cells: MATRIX_WIN_RATES.map((wr) => {
      const w = wr / 100;
      const e = w * rr - (1 - w) * 1;
      return {
        winRate: wr, rr, expectancy: e,
        positive: e > 0,
        /** How strongly to tint. Capped so one extreme cell does not wash the
         *  rest of the grid out to a flat colour. */
        intensity: clamp(Math.abs(e) / 1.5, 0, 1),
        isHere: wr === hereWin && rr === hereRR,
      };
    }),
  }));
}

/**
 * The five inputs, derived from trades already journalled.
 *
 * Not called by the public page — it exists so the in-app version is a prop
 * away rather than a rewrite, and so the definitions of "average win" used in
 * both places cannot drift apart.
 *
 * ASSUMED STOPS ARE EXCLUDED. A trade whose stop the importer invented has no
 * real R, and averaging invented risk into an expectancy figure produces a
 * number that looks measured and is not — the same rule `analysis.js` follows.
 */
export function fromTrades(trades = [], { capital } = {}) {
  const usable = trades.filter(
    (t) => t && t.stop_source !== "assumed" && Number.isFinite(t.r) && t.status === "closed"
  );
  if (usable.length < 5) return null;

  const wins = usable.filter((t) => t.r > 0);
  const losses = usable.filter((t) => t.r <= 0);
  const mean = (xs, f) => (xs.length ? xs.reduce((s, x) => s + f(x), 0) / xs.length : 0);

  /** Months spanned, so "trades per month" reflects real pace rather than
   *  dividing by however many months the calendar happens to contain. */
  const dates = usable.map((t) => new Date(t.exit_date || t.entry_date)).filter((d) => !isNaN(d));
  const span = dates.length > 1
    ? Math.max(1, (Math.max(...dates) - Math.min(...dates)) / (1000 * 60 * 60 * 24 * 30.44))
    : 1;

  return {
    winRate: (wins.length / usable.length) * 100,
    avgWin: wins.length ? mean(wins, (t) => t.r) : 0,
    avgLoss: losses.length ? Math.abs(mean(losses, (t) => t.r)) : 1,
    tradesPerMonth: usable.length / span,
    capital,
    sampleSize: usable.length,
  };
}
