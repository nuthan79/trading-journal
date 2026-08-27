import { scaleOutFinding } from "./positions";
/* The thresholds the path is measured against, imported rather than repeated:
   two definitions of "risk free" is how a badge on Holdings and a finding here
   come to disagree on screen about the same trade. */
import { FREE_AT_R, POWER_R, POWER_DAYS } from "./path";
/* The one finding that has to say a rupee figure mid-sentence. Everything
   else here returns numbers and lets the component format them, which is not
   available inside a prose string — see the house rule in CLAUDE.md. */
import { rupee } from "./format";

/**
 * Behavioural review.
 *
 * Every finding here is arithmetic on your own trades — no model, no guessing.
 * Each one carries the numbers that produced it so you can check the claim,
 * and each declares the minimum sample it needs. A finding that can't clear its
 * sample bar returns null rather than a confident-sounding guess.
 *
 * Severity:
 *   critical  costing real money now, fix before the next trade
 *   warning   a pattern that compounds if left alone
 *   watch     suggestive but not yet conclusive
 *   good      working — worth knowing so you don't break it
 */

const n = (v) => (v === "" || v == null ? NaN : Number(v));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sd = (a) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

/** Least-squares slope of y against its own index. */
function slope(y) {
  const k = y.length;
  if (k < 3) return NaN;
  const mx = (k - 1) / 2, my = mean(y);
  let num = 0, den = 0;
  for (let i = 0; i < k; i++) { num += (i - mx) * (y[i] - my); den += (i - mx) ** 2; }
  return den ? num / den : NaN;
}

function pearson(x, y) {
  const k = Math.min(x.length, y.length);
  if (k < 8) return NaN;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < k; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

const chron = (rows) =>
  [...rows].sort((a, b) =>
    new Date(a.exit_date || a.entry_date) - new Date(b.exit_date || b.entry_date));

/**
 * A finding.
 *
 * `title` is the claim, `detail` the reasoning, `evidence` the numbers behind
 * it. The optional sixth argument carries what the screen needs to read as a
 * page rather than a paragraph:
 *
 *   lede     one plain line saying what was measured, in words that do not
 *            assume the reader already knows what −1.15R means
 *   figures  the two or three numbers the claim rests on, lifted OUT of the
 *            prose so they can be seen without reading it. Every one of these
 *            was already in `detail`; a finding that says "18 of 54 losing
 *            trades (33%), averaging −1.42R" makes somebody parse a sentence
 *            to learn something a number could have told them.
 *   verdict  the one sentence that says what it means. The old detail
 *            paragraph did the measuring, the explaining and the "so what" at
 *            once, and the "so what" is the part people came for.
 *
 * All three are optional and older findings pass none — the card falls back to
 * the plain layout, so this can be adopted a finding at a time rather than in
 * one rewrite of eleven.
 */
const F = (severity, id, title, detail, evidence, extra = {}) =>
  ({ id, severity, title, detail, evidence, ...extra });

/** Ledes, kept beside each other so they can be read as a set and stay in one
 *  voice — plain sentences, no R-notation, no term the screen has not already
 *  explained by the time you reach it. */
const LEDE_STOPS =
  "Of every trade you closed at a loss, how many lost more than the stop you " +
  "set said they should. A stop at 1R means a loss should cost roughly what " +
  "you put at risk; this counts the ones that cost meaningfully more.";
const LEDE_EXITS =
  "Every closed trade, grouped by the reason you recorded for getting out. " +
  "Winners and losers together, so each way out shows what it kept as well as " +
  "what it gave up.";
const LEDE_RISK =
  "How much of the account you put at risk on each trade, in the order you " +
  "took them. Every trade drawn as one point, oldest on the left.";
const LEDE_AFTER_LOSS =
  "What you bet on the very next trade after a loss, against what you bet " +
  "after a win. The market has no memory of your last trade; this asks whether " +
  "you do.";
const LEDE_REGIME =
  "Your trades sorted by what the index was doing when you took them, and what " +
  "each group returned.";
const LEDE_CADENCE =
  "How long you waited before the next trade — after a loss, and after a win.";
const LEDE_CONC =
  "How much of the total came from how few trades.";
const LEDE_GAPS =
  "How often each field is actually filled in. A blank does not count against " +
  "a setup; it makes that setup invisible to every cut on the performance sheet.";
const LEDE_CHARGES =
  "What it actually cost you to place these trades, and how many of them have " +
  "no cost recorded at all. Every net figure on the app is measured after " +
  "charges, so a trade with none looks more profitable than it was.";
const LEDE_CAPTURE =
  "Every trade against its own best closing price while you held it. Not one " +
  "group of trades against another — the same trade, at its high point and at " +
  "the end.";
const LEDE_ROUNDTRIP =
  "The trades that got far enough in front for the stop to go to breakeven, " +
  "and how far in front each of them was before it came back.";
const LEDE_POWER =
  "The trades that were already well in front within a week of buying them, " +
  "and what each one finished at.";
const LEDE_ACK =
  "Trades where you marked the breakeven reminder as dealt with, against " +
  "where they actually closed — and whether the price ever traded at " +
  "breakeven for you to get out at.";
const LEDE_ADVERSE =
  "Your winning trades, and how far each one closed against you before it " +
  "turned. Measured against the stop you set, so \u22121R is the line the " +
  "trade was never meant to cross.";
const LEDE_FEELING =
  "Your trades grouped by how the day felt when you took them, and what each " +
  "group returned.";
const LEDE_EXTENSION =
  "Trades taken close to the pivot against trades taken well past it, and what " +
  "each group returned.";
const LEDE_SIZE =
  "Whether the trades you bet more on actually turned out better. Measured as " +
  "the relationship between how much you risked and what came back.";

/* ==================================================================== */
/*  1. Stop-loss discipline                                             */
/* ==================================================================== */

/**
 * How many recent losses decide whether a stop problem is a present-tense
 * one. Twenty is the smallest number that supports a rate you would act on —
 * one overrun in twenty is 5%, which is noise, and three is 15%, which is not.
 */
const RECENT_LOSSES = 20;

function stopDiscipline(closed) {
  /**
   * Only trades whose stop was actually set.
   *
   * This check calls a loss worse than −1.15R a stop that wasn't honoured. Run
   * against an assumed stop it accuses the trader of indiscipline over a line
   * they never drew — and with one flat percentage across every trade, the
   * "overruns" are just the trades that happened to fall further than that
   * percentage, which says nothing about discipline at all.
   */
  const measured = closed.filter((t) => t.stop_source !== "assumed");
  const losers = measured.filter((t) => isFinite(t.r) && t.r <= 0);
  if (losers.length < 8) {
    const assumed = closed.length - measured.length;
    if (assumed > 0) {
      return F("watch", "stop-discipline-unknown",
        "Stop discipline can't be judged yet",
        `${assumed} of these trades carry an assumed stop rather than one you set, and ` +
        `there are too few with a real stop to read anything from. This check asks whether ` +
        `losses ran past where you said you'd get out — a question an assumed stop can't ` +
        `answer, since it was placed after the fact and every trade got the same one. ` +
        `Replace the assumed stops with what you actually used and this starts working.`,
        { assumed, withRealStop: measured.length });
    }
    return null;
  }

  const rs = losers.map((t) => t.r);
  const med = median(rs);
  const overruns = losers.filter((t) => t.r < -1.15);
  const bad = losers.filter((t) => t.r < -1.5);
  const overrunRate = (overruns.length / losers.length) * 100;
  const badRate = (bad.length / losers.length) * 100;

  /**
   * SEVERITY IS ABOUT NOW. THE TOTAL IS ABOUT THE RECORD.
   *
   * This card could not clear. It escalated on `bad.length >= 3` — an absolute
   * count of losses worse than −1.5R across the whole history, which only ever
   * goes up — so three bad trades in one bad month held a permanent CRITICAL.
   * Measured: three such losses followed by nine hundred flawless trades still
   * read critical, at a lifetime overrun rate of one percent.
   *
   * Two things were wrong with it. A bare count has no denominator: three bad
   * losses is 5.5% of a fifty-loss book and 0.6% of a five-hundred one, and it
   * meant something completely different in each. And even the rate is a
   * lifetime figure that a trader cannot move — forty consecutive clean losses
   * to shift 26% to 15%, by which time the behaviour being described is years
   * old.
   *
   * So severity now reads the last {RECENT_LOSSES} losses and the lifetime
   * figures stay in the prose, where they belong: a CRITICAL badge is a call
   * to act, and there is no action available for a trade closed in 2019. The
   * history is not deleted — it is demoted from a verdict to a fact.
   */
  const recent = chron(losers).slice(-RECENT_LOSSES);
  const recentOverruns = recent.filter((t) => t.r < -1.15);
  const recentBad = recent.filter((t) => t.r < -1.5);
  /* Under ten there is no rate to read and the lifetime figure governs, which
     is the honest fallback: not enough recent evidence to overrule the book. */
  const enoughRecent = recent.length >= 10;
  const recentRate = enoughRecent ? (recentOverruns.length / recent.length) * 100 : null;
  const recentBadRate = enoughRecent ? (recentBad.length / recent.length) * 100 : null;

  const judgedRate = recentRate ?? overrunRate;
  const judgedBadRate = recentBadRate ?? badRate;
  const judgedBadCount = enoughRecent ? recentBad.length : bad.length;

  const ev = {
    losers: losers.length,
    medianLossR: +med.toFixed(2),
    beyondStopCount: overruns.length,
    beyondStopPct: +overrunRate.toFixed(0),
    worstLossR: +Math.min(...rs).toFixed(2),
    avgOverrunR: overruns.length ? +mean(overruns.map((t) => t.r)).toFixed(2) : null,
    taggedIgnoredStop: losers.filter((t) => (t.mistakes || []).includes("Ignored the stop")).length,
    recentLosses: recent.length,
    recentBeyondStopCount: recentOverruns.length,
    recentBeyondStopPct: recentRate != null ? +recentRate.toFixed(0) : null,
  };

  /**
   * The sentence that makes the card able to say "you fixed this".
   *
   * A journal that only ever reports the lifetime figure cannot tell a trader
   * they have stopped doing something, which is the single most useful thing
   * it could say to somebody who has. Ten points either way is the threshold —
   * below that, on twenty losses, the two rates are the same number.
   */
  const drift = recentRate != null ? +(overrunRate - recentRate).toFixed(0) : null;
  const trendNote =
    drift == null || Math.abs(drift) < 10 ? ""
    : drift > 0
    ? ` It is also getting better, and that is worth saying plainly: across all ${losers.length} ` +
      `losses ${ev.beyondStopPct}% ran past the stop, but over your last ${recent.length} it is ` +
      `${ev.recentBeyondStopPct}%. This is something you used to do more than you do now.`
    : ` And it is getting worse, not better: ${ev.beyondStopPct}% across all ${losers.length} ` +
      `losses, but ${ev.recentBeyondStopPct}% over your last ${recent.length}.`;

  const lede = LEDE_STOPS;
  /** U+2212, as `rfmt` and every other figure in the app uses — a hyphen next
   *  to a 21px numeral reads as a dash, not a sign. */
  const minus = (v) => String(v).replace("-", "\u2212");
  const figs = [
    { value: `${ev.beyondStopPct}%`, label: "of losses ran past it" },
    { value: `${overruns.length} of ${losers.length}`, label: "losing trades" },
    { value: `${minus(ev.medianLossR)}R`, label: "typical loss" },
  ];

  /**
   * Every loss placed on one axis, with the stop drawn as a line.
   *
   * The whole claim is "some of these fell past the line", and that is a
   * picture — a count in a sentence makes you take it on trust, where a strip
   * of dots with a line through it lets you see how many and by how much. The
   * ones beyond it are the finding.
   */
  const chart = {
    type: "strip",
    unit: "R",
    threshold: -1,
    thresholdLabel: "your stop",
    worseIsLower: true,
    points: losers
      .map((t) => ({ v: +t.r.toFixed(2), label: t.symbol, past: t.r < -1.15 }))
      .sort((a, b) => a.v - b.v),
  };

  /* A count AND a rate. Either alone misleads: the rate lets a handful of
     catastrophic losses hide inside a large book, and the bare count made
     three of them permanent. */
  if (judgedRate >= 30 || (judgedBadCount >= 3 && judgedBadRate >= 10)) {
    return F("critical", "stop-discipline",
      "Losses are running past the stop",
      `Those ${overruns.length} averaged ${ev.avgOverrunR}R, against a design that says a loss should cost 1R. ` +
      // Only when there are any. "the 0 you tagged ... are the ones that were"
      // is not a sentence, and it appeared on the first real account this ran on.
      (ev.taggedIgnoredStop > 0
        ? `Some of this will be gap-downs rather than hesitation — the ${ev.taggedIgnoredStop} you tagged ` +
          `"Ignored the stop" are the ones that were.`
        : `Some of this will be gap-downs rather than hesitation. Tagging the ones that were ` +
          `"Ignored the stop" is what tells the two apart.`) + trendNote,
      ev,
      { lede,
        figures: figs,
        chart,
        verdict: "Your 1R is not the number you think it is. Expectancy and position " +
                 "size are both worked out from it, so both are currently overstating " +
                 "how well this is going." });
  }
  if (judgedRate >= 15) {
    return F("warning", "stop-discipline",
      "Some losses drifting past the stop",
      `Not yet structural — but this is the failure mode that widens the average loss without ` +
      `ever announcing itself, because no single trade looks bad enough to notice.` + trendNote,
      ev,
      { lede,
        figures: figs,
        chart,
        verdict: "Worth watching rather than fixing. If this share climbs past a third, " +
                 "every R figure in the journal starts to drift." });
  }
  /**
   * "NOW" IS LOAD-BEARING IN THIS TITLE.
   *
   * A trader whose lifetime rate is a quarter and whose last twenty losses
   * were clean has earned this card — but "Stops are being honoured" flat,
   * over a chart where a third of the dots sit past the line, reads as the
   * screen not having looked. The word that reconciles the headline with the
   * picture underneath it is the whole point of measuring recency.
   */
  const cleanedUp = drift != null && drift >= 10;
  return F("good", "stop-discipline",
    cleanedUp ? "Stops are being honoured now" : "Stops are being honoured",
    (cleanedUp
      ? `Over your last ${recent.length} losses, ${recentOverruns.length} went past the stop. The chart ` +
        `below is your whole record and it still carries the ones that did — ${overruns.length} of ` +
        `${losers.length}, at ${ev.beyondStopPct}%. Those are real and they are already paid for; what ` +
        `they are not is a description of how you trade now.`
      : `A typical loss costs about what it was meant to, and only ${overruns.length} went beyond it.`),
    ev,
    { lede,
      figures: figs,
      chart,
      verdict: cleanedUp
        ? "Nothing to fix. Worth knowing that the lifetime figures on this screen — " +
          "expectancy, average loss — still carry the old trades, and will read worse " +
          "than your current method for a while yet."
        : "Your 1R is real — which is what lets every other number on this screen " +
          "be taken at face value." });
}

/* ==================================================================== */
/*  2. Risk-per-trade consistency                                       */
/* ==================================================================== */

function riskConsistency(closed) {
  /**
   * Recorded stops only, for the same reason as stop discipline above.
   *
   * riskPct is 1R as a share of the account, and 1R comes from the stop. Give
   * every trade the same assumed percentage and riskPct becomes position size
   * wearing risk's name — so "risk per trade is climbing" would really be
   * saying "your positions got bigger", which is a different claim and one the
   * trader may already have decided on.
   */
  const rows = chron(closed)
    .filter((t) => t.stop_source !== "assumed")
    .filter((t) => isFinite(t.riskPct) && t.riskPct > 0);
  if (rows.length < 12) return null;

  const risks = rows.map((t) => t.riskPct);
  const m = mean(risks), s = sd(risks);
  const cv = s / m;
  const sl = slope(risks);
  const drift = (sl * rows.length) / m * 100;   // % change implied across the sample

  const cut = Math.max(4, Math.floor(rows.length / 4));
  const firstQ = risks.slice(0, cut);
  const lastQ = risks.slice(-cut);
  const change = ((mean(lastQ) - mean(firstQ)) / mean(firstQ)) * 100;

  /**
   * RISING RISK IS NOT A VERDICT ON ITS OWN.
   *
   * "Risk per trade is climbing" is a fact with two opposite meanings, and the
   * check used to report it as though it had one. Betting more while the
   * trades improve is scaling into something that works — the thing every
   * position-sizing rule is FOR. Betting more while they get worse is the
   * mechanism that empties accounts.
   *
   * The same two quarters, read for outcome instead of size, separate them.
   * Both figures already exist per trade; nothing here needs a model to
   * interpret it.
   */
  const rFirst = mean(rows.slice(0, cut).map((t) => t.r).filter(isFinite));
  const rLast = mean(rows.slice(-cut).map((t) => t.r).filter(isFinite));
  const edgeKnown = isFinite(rFirst) && isFinite(rLast);
  const edgeUp = edgeKnown && rLast > rFirst + 0.1;
  const edgeDown = edgeKnown && rLast < rFirst - 0.1;

  const ev = {
    trades: rows.length,
    avgRiskPct: +m.toFixed(2),
    sdRiskPct: +s.toFixed(2),
    coeffVariation: +cv.toFixed(2),
    minRiskPct: +Math.min(...risks).toFixed(2),
    maxRiskPct: +Math.max(...risks).toFixed(2),
    firstQuarterAvg: +mean(firstQ).toFixed(2),
    lastQuarterAvg: +mean(lastQ).toFixed(2),
    changePct: +change.toFixed(0),
    over2pct: risks.filter((r) => r > 2).length,
    firstQuarterR: edgeKnown ? +rFirst.toFixed(2) : null,
    lastQuarterR: edgeKnown ? +rLast.toFixed(2) : null,
  };

  /**
   * Risk per trade, in the order it was taken.
   *
   * "Climbing" and "erratic" are both shapes, and neither survives being
   * written down as a coefficient — 0.46 tells nobody whether the line
   * wanders or trends. Drawn, the two findings are visibly different things:
   * one has a slope, the other has spread.
   *
   * The two quarter averages are the claim itself, so they are drawn as lines
   * rather than left in the sentence for the reader to imagine.
   */
  /**
   * Calendar quarters, as a step across the dots.
   *
   * The two flat bands showed only the endpoints — where it started and where
   * it is — and left the reader to assume the line between them was straight.
   * It rarely is. A step per quarter shows the path, so a book that drifted up
   * and came back reads differently from one that climbed steadily, and the
   * quarter it turned in is visible rather than inferred.
   */
  const qOf = (t) => {
    const m = /^(\d{4})-(\d{2})/.exec(String(t.exit_date || t.entry_date || ""));
    return m ? `${m[1].slice(2)}Q${Math.floor((Number(m[2]) - 1) / 3) + 1}` : null;
  };
  const qs = [];
  rows.forEach((t, i) => {
    const q = qOf(t);
    if (!q) return;
    const last = qs[qs.length - 1];
    const amt = isFinite(t.riskAmt) ? t.riskAmt : null;
    if (last && last.label === q) {
      last.to = i; last.vals.push(t.riskPct); if (amt != null) last.amts.push(amt);
    } else {
      qs.push({ label: q, from: i, to: i, vals: [t.riskPct], amts: amt != null ? [amt] : [] });
    }
  });
  /* Under three quarters a step line is two segments pretending to be a
     trend; the bands say the same thing more honestly. */
  const stepLine = qs.length >= 3
    ? qs.map((x) => ({
        label: x.label, from: x.from, to: x.to,
        value: +mean(x.vals).toFixed(3),
        /**
         * The rupee figure beside the percentage, because the two together
         * are the finding and neither is it alone. A percentage that halves
         * while the account triples is rupee risk that went UP; a percentage
         * holding flat on a growing account is rupee risk climbing steadily.
         * Reading only the share, both look like nothing happened.
         */
        amount: x.amts.length ? Math.round(mean(x.amts)) : null,
      }))
    : null;

  /**
   * The rupee scale, and whether it is honest to draw one.
   *
   * riskAmt is riskPct of the account AT THE TIME, so the two are only
   * proportional while the account holds still. On a book that grew, one right
   * hand axis would be right at one end of the sample and wrong at the other —
   * a percentage falling by half on an account that tripled is rupee risk that
   * went UP, and an axis drawn from a single ratio would show it falling.
   *
   * So the ratio is measured at both ends. Within a quarter of each other it
   * is one scale and the axis is drawn; wider than that and it is not one
   * scale, the axis is omitted, and the caption says the rupee figure instead
   * — which is the honest way to give a number that has no fixed position.
   */
  const ratios = rows
    .filter((t) => isFinite(t.riskAmt) && t.riskPct > 0)
    .map((t) => t.riskAmt / t.riskPct);
  const rFirst2 = ratios.slice(0, Math.max(3, Math.floor(ratios.length / 4)));
  const rLast2 = ratios.slice(-Math.max(3, Math.floor(ratios.length / 4)));
  const perPct = ratios.length ? median(ratios) : null;
  /* `drift` is taken further up for the risk trend itself — this one is about
     the account, not the sizing. */
  const ratioDrift = rFirst2.length && rLast2.length
    ? Math.abs(median(rLast2) - median(rFirst2)) / median(rFirst2)
    : 1;
  const rupeeAxis = perPct != null && ratioDrift <= 0.25
    ? { perPct: Math.round(perPct) }
    : null;

  const riskChart = {
    type: "series",
    unit: "%",
    steps: stepLine,
    rupeeAxis,
    /**
     * Each point carries its own outcome, so the chart answers both halves of
     * the question at once: how big the bet was, and whether it worked. The
     * height already showed the sizing drifting up; the colour shows whether
     * the bets that drifted up are the ones that paid, which is the thing the
     * headline is actually claiming.
     */
    points: rows.map((t) => ({
      v: +t.riskPct.toFixed(3),
      win: isFinite(t.r) ? t.r > 0 : null,
    })),
    pointLegend: true,
    /* Says why there is no rupee scale, when there is not one. An axis that
       silently disappears reads as a bug; the reason is the more useful half
       of the finding anyway — an account that changed size is why a steady
       percentage was never steady money. */
    axisNote: `${rows.length} trades, oldest first` +
      (perPct != null && ratioDrift > 0.25
        ? " · account size moved too much for one rupee scale"
        : ""),
  };
  const lede = LEDE_RISK;

  if (change > 40 && ev.lastQuarterAvg > ev.firstQuarterAvg) {
    const figs = [
      { value: `+${ev.changePct}%`, label: "bigger bets" },
      /* Only when the edge actually moved. Inside the deadband this printed
         "−0.00R worse trades", which is a direction invented out of rounding
         and the opposite of what the figure is there to settle. */
      ...(edgeUp || edgeDown ? [{
        value: `${edgeUp ? "+" : "\u2212"}${Math.abs(rLast - rFirst).toFixed(2)}R`,
        label: edgeUp ? "better trades" : "worse trades",
      }] : edgeKnown ? [{ value: `${ev.lastQuarterR}R`, label: "trades unchanged" }] : []),
      { value: `${ev.lastQuarterAvg}%`, label: "risked per trade now" },
    ];
    const chart = {
      ...riskChart,
      bands: [
        { value: ev.firstQuarterAvg, label: "first quarter" },
        { value: ev.lastQuarterAvg, label: "most recent", strong: true },
      ],
    };
    const cost = `Position size scales your return and your drawdown by exactly the same factor, so ` +
      `if your worst historical run is ${"{maxDD}"}R, at ${ev.lastQuarterAvg}% that same run now takes a ` +
      `different amount out of the account.`;

    /* Betting more into trades that are getting worse. */
    if (edgeDown) {
      return F("critical", "risk-escalation",
        "You are betting more as the trades get worse",
        `Risk per trade is up ${ev.changePct}%, while what those trades return has fallen from ` +
        `${ev.firstQuarterR}R to ${ev.lastQuarterR}R. Those two moving in opposite directions is the ` +
        `combination that empties accounts — not either one alone. ${cost}`,
        ev, { lede, figures: figs, chart,
          verdict: "Size up when the trades improve, not while they deteriorate. On these " +
                   "numbers the sizing should be coming down, not going up." });
    }
    /* Betting more into trades that are improving — which is what sizing is for. */
    if (edgeUp) {
      return F("watch", "risk-escalation",
        "You are betting more, and the trades are getting better",
        `Risk per trade is up ${ev.changePct}%, and what those trades return has risen from ` +
        `${ev.firstQuarterR}R to ${ev.lastQuarterR}R. That is the right direction — scaling into a ` +
        `method that is working is what position sizing is for. It is here as a Watch rather than a ` +
        `problem because it appears to have happened by drift rather than by decision. ${cost}`,
        ev, { lede, figures: figs, chart,
          verdict: "Nothing to undo — but make it deliberate. Risk that grows on its own " +
                   "keeps growing through the quarter when the edge stops working." });
    }
    /* Bigger bets, same trades. */
    return F("warning", "risk-escalation",
      "Risk per trade is climbing",
      `Risk per trade is up ${ev.changePct}% while what the trades return has held roughly flat. ` +
      `So the account is exposed to more without getting more back for it. ${cost}`,
      ev, { lede, figures: figs, chart,
        verdict: `You are trading a ${ev.changePct}% larger account risk than when you started, ` +
                 `without having decided to. Pick the number you mean and size to it.` });
  }
  if (cv > 0.5) {
    return F("warning", "risk-inconsistent",
      "Position sizing is erratic",
      `Inconsistent sizing means your biggest positions dominate the result — so the P&L reflects which ` +
      `trades you felt strongest about, not whether the system works. That is what makes the expectancy ` +
      `figure less meaningful than it looks.`,
      ev,
      { lede,
        figures: [
          { value: `${ev.minRiskPct}–${ev.maxRiskPct}%`, label: "range risked" },
          { value: `${ev.avgRiskPct}%`, label: "average" },
        ],
        chart: {
          ...riskChart,
          bands: [{ value: ev.avgRiskPct, label: "your average", strong: true }],
        },
        verdict: "The spread, not the average, is the problem. Two trades at four times the " +
                 "size of the others decide the record between them." });
  }
  if (ev.over2pct >= 3) {
    return F("warning", "risk-outliers",
      "Occasional oversized positions",
      `${ev.over2pct} trades risked more than 2% of capital, against a ${ev.avgRiskPct}% average. ` +
      `Outsized bets are where accounts break — not because they're wrong more often, but because a loss streak that includes two of them is a different event.`,
      ev);
  }
  return F("good", "risk-consistent",
    "Position sizing is disciplined",
    `${ev.avgRiskPct}% average risk with a variation coefficient of ${ev.coeffVariation} across ${rows.length} trades. ` +
    `Consistent sizing is what makes your expectancy figure trustworthy.`,
    ev);
}

/* ==================================================================== */
/*  3. Sizing after a loss — revenge, and conviction inversion          */
/* ==================================================================== */

function sizingReflexes(closed) {
  const rows = chron(closed).filter((t) => isFinite(t.riskPct) && isFinite(t.r));
  if (rows.length < 15) return null;

  const afterLoss = [], afterWin = [];
  for (let i = 1; i < rows.length; i++) {
    (rows[i - 1].r <= 0 ? afterLoss : afterWin).push(rows[i].riskPct);
  }
  if (afterLoss.length < 5 || afterWin.length < 5) return null;

  const al = mean(afterLoss), aw = mean(afterWin);
  const bump = ((al - aw) / aw) * 100;

  // Does bigger size actually mark better trades?
  const corr = pearson(rows.map((t) => t.riskPct), rows.map((t) => t.r));

  const ev = {
    avgRiskAfterLoss: +al.toFixed(2),
    avgRiskAfterWin: +aw.toFixed(2),
    differencePct: +bump.toFixed(0),
    sizeOutcomeCorrelation: isFinite(corr) ? +corr.toFixed(2) : null,
    sampleAfterLoss: afterLoss.length,
  };


  const out = [];

  if (bump > 20) {
    out.push(F("critical", "revenge-sizing",
      "You size up after losing",
      `The market has no memory of your last trade, so there is no edge reason for this. It is the ` +
      `mechanism that turns an ordinary losing streak into a serious drawdown — the bets get bigger ` +
      `exactly as the run gets worse.`,
      ev,
      { lede: LEDE_AFTER_LOSS,
        figures: [{ value: `+${ev.differencePct}%`, label: "bigger after a loss" }],
        chart: { type: "bars", unit: "%", rows: [
          { label: "After a loss", value: ev.avgRiskAfterLoss, n: ev.sampleAfterLoss, worst: true },
          { label: "After a win", value: ev.avgRiskAfterWin },
        ], axisNote: "average risk per trade" },
        verdict: "Decide the size before the trade before it, not after. The gap here is " +
                 "not a strategy, it is a reaction." }));
  }

  /**
   * A correlation is a hard number to feel, which is why the title says it in
   * words — "Your biggest positions are your worst trades". A third figure
   * repeating that as "worse / BIGGER BETS DID" was tried and cut: it read as
   * neither a number nor a sentence, and said what the headline already had.
   */
  const sizeFigs = () => [
    { value: String(ev.sizeOutcomeCorrelation).replace("-", "\u2212"), label: "size vs outcome" },
    { value: `${rows.length}`, label: "trades measured" },
  ];

  /**
   * The correlation, drawn as the thing the correlation is about.
   *
   * A coefficient is the least readable way to say this. Sorting the trades by
   * how much was risked, cutting them into five equal groups and showing what
   * each group returned says the same thing in a shape anybody can read: the
   * bars step down, or they do not.
   *
   * Quintiles rather than a scatter because a scatter of 46 points with a
   * fitted line asks the reader to trust a line; five bars just show it. Fewer
   * than ten trades a bucket and the buckets are noise, so it falls back to
   * three.
   */
  const bySize = [...rows].sort((a, b) => a.riskPct - b.riskPct);
  const k = bySize.length >= 50 ? 5 : 3;

  /**
   * A BAND IS A RANGE OF VALUES, SO A TIE CANNOT BE SPLIT ACROSS TWO OF THEM.
   *
   * Cutting into five equal COUNTS puts trades of identical size into
   * different bands whenever one value is common — which it is, because most
   * people size the same way most of the time. On a real book that produced
   * "0.22–0.28%", then "0.28%", then "0.28–0.54%": one number ending one
   * band, being another band entirely, and starting a third. A reader asking
   * which band their 0.28% trade is in has no answer, and the honest one
   * would have been "some of them are in each".
   *
   * So a cut moves forward past a run of equal values rather than through it.
   * Bands come out uneven in size — a value held by a fifth of the book makes
   * a big band — and that is the shape of the trading rather than a defect in
   * the chart. Where that collapses the count below three the ranks below
   * take over the labelling.
   */
  const at = (i) => bySize[i].riskPct;
  const cuts = [];
  for (let i = 1; i < k; i++) {
    let idx = Math.floor((bySize.length * i) / k);
    while (idx < bySize.length && idx > 0 && at(idx) === at(idx - 1)) idx++;
    const last = cuts.length ? cuts[cuts.length - 1] : 0;
    if (idx > last && idx < bySize.length) cuts.push(idx);
  }
  const bounds = [0, ...cuts, bySize.length];

  const buckets = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const slice = bySize.slice(bounds[i], bounds[i + 1]);
    if (!slice.length) continue;
    const lo = slice[0].riskPct, hi = slice[slice.length - 1].riskPct;
    /* Money as well as R, because they are not the same claim: a band can
       return more per unit of risk and still be the smaller cheque. Averaged
       per trade rather than totalled, so an uneven band is not read as a
       better one for merely holding more trades. */
    const cash = slice.map((t) => n(t.pnl)).filter(isFinite);
    buckets.push({
      lo, hi,
      range: lo.toFixed(2) === hi.toFixed(2) ? `${lo.toFixed(2)}%` : `${lo.toFixed(2)}–${hi.toFixed(2)}%`,
      value: +mean(slice.map((t) => t.r)).toFixed(2),
      cash: cash.length === slice.length ? mean(cash) : null,
      n: slice.length,
    });
  }
  /**
   * Rank labels when the ranges collide.
   *
   * Somebody who sizes consistently puts most trades at the same risk, so the
   * buckets come back as "0.50%", "0.50%", "0.50%" — three rows that look
   * identical and make the chart read as broken. The rank is what actually
   * separates them, and the range only helps when the ranges differ.
   */
  /* Keyed on how many bands survived the tie rule, not on k — a book with one
     dominant size collapses to fewer, and RANKS[i] must still name them. */
  const RANKS = buckets.length === 5
    ? ["Smallest", "2nd", "Middle", "4th", "Largest"]
    : buckets.length === 4
    ? ["Smallest", "2nd", "3rd", "Largest"]
    : ["Smallest", "Middle", "Largest"];
  const distinct = new Set(buckets.map((b) => b.range)).size === buckets.length;
  const sizeChart = {
    type: "bars",
    unit: "R",
    rows: buckets.map((b, i) => ({
      label: distinct ? b.range : (RANKS[i] || b.range),
      value: b.value,
      /* The rupee average beside the R, because "+2.96R" and "+1.04R" say
         nothing about which band actually made more money — and on a card
         about position SIZE that is the question being asked. */
      sub: b.cash == null ? null : rupee(Math.round(b.cash)),
      n: b.n,
    })),
    axisNote: distinct
      ? "risk per trade, smallest to largest · average R and average rupees per trade"
      : `by size, smallest to largest · ${buckets[0].lo.toFixed(2)}–` +
        `${buckets[buckets.length - 1].hi.toFixed(2)}% risk`,
  };

  if (isFinite(corr) && corr < -0.2) {
    out.push(F("warning", "conviction-inverted",
      "Your biggest positions are your worst trades",
      `The trades you sized up on have come back worse than the ones you sized down on. Whatever is ` +
      `driving the conviction is not predicting the outcome — which means the sizing decision is ` +
      `currently subtracting from the result rather than adding to it.`,
      ev,
      { lede: LEDE_SIZE,
        figures: sizeFigs(),
        chart: sizeChart,
        verdict: "Betting the same amount on every trade would have made you more money " +
                 "than your own judgement about which ones deserved more." }));
  } else if (isFinite(corr) && corr > 0.25) {
    out.push(F("good", "conviction-works",
      "Your conviction is informative",
      `The trades you back harder do come back better. This is rarer than it sounds — for most ` +
      `traders the relationship is flat or backwards.`,
      ev,
      { lede: LEDE_SIZE,
        figures: sizeFigs(),
        chart: sizeChart,
        verdict: "Worth protecting rather than pushing. Keep the upper bound where it is — " +
                 "the edge is in picking which trades get more, not in how much more." }));
  }

  return out.length ? out : null;
}

/* ==================================================================== */
/*  4. Entry quality — chasing extension, thin volume                   */
/* ==================================================================== */

function entryQuality(closed) {
  const out = [];

  const withPivot = closed.filter((t) => isFinite(t.distPivot) && isFinite(t.r));
  if (withPivot.length >= 12) {
    const near = withPivot.filter((t) => t.distPivot <= 3);
    const far = withPivot.filter((t) => t.distPivot > 5);
    const avgExt = mean(withPivot.map((t) => t.distPivot));

    if (far.length >= 5 && near.length >= 5) {
      const eNear = mean(near.map((t) => t.r));
      const eFar = mean(far.map((t) => t.r));
      const ev = {
        avgExtensionPct: +avgExt.toFixed(1),
        nearPivotTrades: near.length, nearPivotExpectancy: +eNear.toFixed(2),
        extendedTrades: far.length, extendedExpectancy: +eFar.toFixed(2),
        gap: +(eNear - eFar).toFixed(2),
      };
      if (eFar < eNear - 0.25) {
        const extChart = { type: "bars", unit: "R", rows: [
          { label: "Near the pivot", value: ev.nearPivotExpectancy, n: ev.nearPivotTrades },
          { label: "Well extended", value: ev.extendedExpectancy, n: ev.extendedTrades, worst: true },
        ], axisNote: "average return per trade" };
        out.push(F(eFar < 0 ? "critical" : "warning", "chasing",
          "Extended entries are costing you",
          `Buying extended also forces a wider stop, so the same rupee risk buys fewer shares and a lower ` +
          `chance of surviving normal noise. This is the most fixable item on the list — it is a rule, ` +
          `not a skill.`,
          ev,
          { lede: LEDE_EXTENSION,
            figures: [{ value: `${ev.gap}R`, label: "given up per extended trade" }],
            chart: extChart,
            verdict: `Waiting for price within 3% of the pivot is worth about ${ev.gap}R a trade, ` +
                     `and costs nothing but patience.` }));
      }
    }
  }

  const withVol = closed.filter((t) => isFinite(n(t.vol_pct_avg)) && isFinite(t.r));
  if (withVol.length >= 12) {
    const thin = withVol.filter((t) => n(t.vol_pct_avg) < 120);
    const heavy = withVol.filter((t) => n(t.vol_pct_avg) >= 150);
    if (thin.length >= 5 && heavy.length >= 5) {
      const eThin = mean(thin.map((t) => t.r));
      const eHeavy = mean(heavy.map((t) => t.r));
      const ev = {
        thinTrades: thin.length, thinExpectancy: +eThin.toFixed(2),
        heavyTrades: heavy.length, heavyExpectancy: +eHeavy.toFixed(2),
      };
      if (eThin < eHeavy - 0.25) {
        const volChart = { type: "bars", unit: "R", rows: [
          { label: "Heavy volume", value: ev.heavyExpectancy, n: ev.heavyTrades },
          { label: "Thin volume", value: ev.thinExpectancy, n: ev.thinTrades, worst: true },
        ], axisNote: "average return per trade" };
        out.push(F("warning", "thin-volume",
          "Low-volume breakouts are underperforming",
          `Volume is the confirmation that institutions are behind the move. Without it you are buying a ` +
          `price level rather than a signal, and the record here says so.`,
          ev,
          { lede: "Breakouts on thin volume against breakouts on heavy volume, and what each returned.",
            figures: [{ value: `${(ev.heavyExpectancy - ev.thinExpectancy).toFixed(2)}R`, label: "gap per trade" }],
            chart: volChart,
            verdict: "Volume is a filter you can apply before entering, which makes it one of the " +
                     "cheaper rules to add." }));
      }
    }
  }

  return out.length ? out : null;
}

/* ==================================================================== */
/*  5. Exit behaviour — cutting winners short                           */
/* ==================================================================== */

/**
 * WHAT THIS CARD MAY AND MAY NOT SAY, BECAUSE IT USED TO SAY THE WRONG ONE.
 *
 * It ranked WINNING trades by exit reason and asserted: "The gap is the exit
 * method alone — it is not that one group held better trades, since both are
 * drawn from the same winners." That sentence is false, and it was the card's
 * entire argument.
 *
 * The exit reason is not an independent variable. It is assigned by what the
 * trade did. A position is labelled "Broke support" only if it ran far enough
 * to build support above entry and then broke it; it is labelled "Trailing
 * stop" precisely because it stalled and retraced before anything else could
 * fire. The label and the R are both downstream of the same thing — the price
 * path — so the gap between the bars mostly reports which trades ran, not
 * which way out is better. "Drawn from the same winners" was the sleight of
 * hand: all winners, yes, but DIFFERENT winners, sorted by how they behaved.
 *
 * The old card then recommended acting on it — "the single cheapest thing on
 * this page to change" — a causal claim built on a comparison that cannot
 * support one.
 *
 * WHAT WOULD ACTUALLY ANSWER IT is the same trade measured against itself:
 * what this exact position would have returned had it been left to the next
 * trigger past where it closed. `scaleOutFinding` does that, which is why that
 * one is allowed a verdict. Here it needs daily bars after the exit date,
 * which this app does not keep — and it still would not settle it, because
 * "Broke support" and "Sold into strength" are discretionary calls with no
 * rule to simulate. So this card describes, and stops.
 *
 * IT ALSO READS EVERY TRADE NOW, NOT ONLY THE WINNERS. A trailing stop exists
 * partly to end trades that would have round-tripped, and a chart of winners
 * alone can only ever show what it cost, never what it saved. One-sided is how
 * it came to recommend loosening a rule whose whole job is the other side of
 * that ledger.
 */
function exitBehaviour(closed) {
  const scored = closed.filter((t) => isFinite(t.r) && t.exit_reason);
  if (scored.length < 12) return null;

  const groups = new Map();
  for (const t of scored) {
    if (!groups.has(t.exit_reason)) groups.set(t.exit_reason, []);
    groups.get(t.exit_reason).push(t.r);
  }
  const rows = [...groups.entries()]
    .filter(([, v]) => v.length >= 5)
    .map(([k, v]) => ({
      reason: k, n: v.length, avgR: +mean(v).toFixed(2),
      winRate: +((v.filter((x) => x > 0).length / v.length) * 100).toFixed(0),
    }))
    .sort((a, b) => b.avgR - a.avgR);

  if (rows.length < 2) return null;

  const best = rows[0], worst = rows[rows.length - 1];
  const spread = +(best.avgR - worst.avgR).toFixed(2);
  const ev = { byReason: rows, spread, tradesWithAReason: scored.length };

  const minus = (v) => String(v).replace("-", "\u2212");
  const figs = [
    { value: `${minus(spread)}R`, label: "between the widest and the narrowest" },
    { value: `${worst.winRate}%`, label: `of "${worst.reason}" exits were winners` },
  ];

  /** One bar per way out, with the share that won printed on it — because the
   *  interesting thing about an average and a win rate is where they part. */
  const chart = {
    type: "bars",
    unit: "R",
    rows: rows.map((d) => ({
      label: d.reason, value: d.avgR, n: d.n,
      sub: `${d.winRate}% won`,
      best: d.reason === best.reason, worst: d.reason === worst.reason,
    })),
    axisNote: "average return per trade, with the share that won, by recorded exit reason",
  };

  const CONFOUND =
    ` These are not several ways out of one population — they are several populations, sorted by ` +
    `what the trade did. A position ends on "${best.reason}" only if it got far enough for that ` +
    `to happen, and on "${worst.reason}" because it did not. So most of this gap reports which ` +
    `trades ran, not which exit is better, and it is not grounds for changing a rule.`;

  /* Never a warning, whatever the spread. A warning is a call to act and
     nothing measured here can support one — see the note above. */
  if (spread >= 1) {
    return F("watch", "exit-method",
      "Your exits end in very different places",
      `Trades you closed on "${best.reason}" averaged ${best.avgR}R across ${best.n}; those closed ` +
      `on "${worst.reason}" averaged ${worst.avgR}R across ${worst.n}.` + CONFOUND,
      ev,
      { magnitude: spread,
        lede: LEDE_EXITS,
        figures: figs,
        chart,
        verdict: "Read this as a description of how your trades end, not as a case for loosening " +
                 "anything. The question it cannot answer — what a given trade would have done " +
                 "if left alone — needs that same trade measured against itself, which is what " +
                 "the scale-out check does and this one cannot." });
  }
  return F("good", "exit-method", "Your exits end in much the same place",
    `The spread across your recorded exit reasons is ${spread}R, small enough that no way out ` +
    `stands apart from the others.` + CONFOUND,
    ev,
    { magnitude: spread,
      lede: LEDE_EXITS,
      figures: figs,
      chart,
      verdict: "Nothing to read into this either way — which is the honest reading of a " +
               "comparison of this shape, whichever direction the bars had gone." });
}

/* ==================================================================== */
/*  6. Market alignment — the NSE 500 comparison                        */
/* ==================================================================== */

function marketAlignment(closed, regimes) {
  if (!regimes) return null;
  const rows = closed
    .map((t) => ({ ...t, reg: regimes.at(t.entry_date)?.regime }))
    .filter((t) => t.reg && t.reg !== "unknown" && isFinite(t.r));
  if (rows.length < 15) return null;

  const dates = chron(rows).map((t) => t.entry_date);
  const dayCounts = regimes.dayCounts(dates[0], dates[dates.length - 1]);

  const byReg = {};
  for (const key of ["uptrend", "pressure", "correction"]) {
    const g = rows.filter((t) => t.reg === key);
    const days = dayCounts[key] || 0;
    byReg[key] = {
      trades: g.length,
      tradingDays: days,
      tradesPer100Days: days ? +((g.length / days) * 100).toFixed(1) : null,
      expectancy: g.length ? +mean(g.map((t) => t.r)).toFixed(2) : null,
      totalR: g.length ? +g.reduce((a, t) => a + t.r, 0).toFixed(1) : 0,
      winRate: g.length ? +((g.filter((t) => t.r > 0).length / g.length) * 100).toFixed(0) : null,
    };
  }

  const up = byReg.uptrend, corr = byReg.correction, press = byReg.pressure;

  /**
   * WHICH REGIME BUILT THE WORST DRAWDOWN.
   *
   * A regime comparison on averages can be true and still miss the thing that
   * hurt: an expectancy is a long-run figure, and a drawdown is a specific
   * stretch of dates that actually cost real money. If the over-traded regime
   * is also where the deep losses landed, that is a cost you can point at
   * rather than one inferred from a mean.
   *
   * Attribution is by trades whose EXIT falls inside the peak-to-trough
   * window, since that is when the R was booked and therefore when the equity
   * curve moved. A trade opened before the peak and closed inside the slide
   * belongs to the slide.
   */
  const worstDrawdown = (() => {
    const seq = chron(rows);
    if (seq.length < 20) return null;
    let cum = 0, peak = 0, peakAt = 0;
    let best = null;
    seq.forEach((t, i) => {
      cum += t.r;
      if (cum > peak) { peak = cum; peakAt = i; return; }
      const depth = peak - cum;
      if (!best || depth > best.depth) best = { depth, from: peakAt, to: i };
    });
    if (!best || best.depth < 3) return null;

    const inside = seq.slice(best.from + 1, best.to + 1);
    if (!inside.length) return null;
    const byRegLoss = {};
    for (const k of ["uptrend", "pressure", "correction"]) {
      const g = inside.filter((t) => t.reg === k);
      byRegLoss[k] = { trades: g.length, netR: +g.reduce((a, t) => a + t.r, 0).toFixed(1) };
    }
    /* The regime that gave back the most across the slide. */
    const blame = Object.entries(byRegLoss)
      .filter(([, v]) => v.trades > 0)
      .sort((a, b) => a[1].netR - b[1].netR)[0];
    return {
      depthR: +best.depth.toFixed(1),
      from: inside[0].exit_date || inside[0].entry_date,
      to: inside[inside.length - 1].exit_date || inside[inside.length - 1].entry_date,
      trades: inside.length,
      byRegime: byRegLoss,
      worstRegime: blame ? blame[0] : null,
      worstRegimeR: blame ? blame[1].netR : null,
      worstRegimeTrades: blame ? blame[1].trades : null,
    };
  })();

  /**
   * DOES THIS TRADER'S RECORD ACTUALLY PENALISE THE WRONG REGIME?
   *
   * It is textbook that breakouts fail more with the index below its averages,
   * and this check used to escalate on that prior alone: activity skewed
   * toward corrections was enough for a CRITICAL, and the text then asserted
   * "your own record shows it" whether or not it did. On a real account it did
   * not — 0.98R in uptrends against 1.05R in corrections, three bars the same
   * length, under a headline calling it critical. The card argued against its
   * own chart.
   *
   * So the gap is measured and the severity follows it. Under 0.30R apart the
   * regimes are not distinguishable at these sample sizes and no claim about
   * cost is available, whatever the textbook says.
   */
  const gap = up.expectancy != null && corr.expectancy != null
    ? +(up.expectancy - corr.expectancy).toFixed(2) : null;
  const regimeMatters = gap != null && Math.abs(gap) >= 0.3;

  /**
   * How much of a regime's return came from its biggest few trades.
   *
   * An expectancy carried by three outliers is not an expectancy you can plan
   * the next trade around, and it is the first thing to check before calling
   * any regime comparison a finding.
   */
  const topShare = (key) => {
    const g = rows.filter((t) => t.reg === key).map((t) => t.r).sort((a, b) => b - a);
    const total = g.reduce((a, b) => a + b, 0);
    if (g.length < 6 || total <= 0) return null;
    const top3 = g.slice(0, 3).reduce((a, b) => a + b, 0);
    return {
      pct: +((top3 / total) * 100).toFixed(0),
      /* Over 100% is not a rounding artefact, it is the sharper fact: the best
         three made more than the regime kept, so everything else lost money
         between them. Printed as "117% of the return" that reads as a bug. */
      restNegative: top3 > total,
      rest: +(total - top3).toFixed(1),
      n: g.length,
    };
  };

  /**
   * Win rate and expectancy can move apart, and when they do that is the
   * finding rather than a footnote: a book whose win rate falls twenty points
   * while expectancy holds has not lost its edge, it has changed shape —
   * fewer winners, each bigger. "Trade less" is the wrong prescription for
   * that; it is what you would say to an edge that had gone.
   */
  const winSpread = up.winRate != null && press.winRate != null
    ? up.winRate - press.winRate : null;

  /**
   * The drawdown sentence, said only when it points at the regime under
   * discussion. Naming a different regime as the one that hurt would be a
   * fact, but not this finding's fact — and a paragraph that wanders is how a
   * card stops being read.
   */
  const REGIME_WORD = { uptrend: "confirmed uptrends", pressure: "pressure", correction: "corrections" };
  const ddNote = (regimeKey) => {
    const d = worstDrawdown;
    if (!d || d.worstRegimeR == null || d.worstRegimeR >= 0) return "";
    if (d.worstRegime === regimeKey) {
      return ` It also shows up where it costs most: your deepest drawdown ran ${d.depthR}R from ` +
        `${d.from} to ${d.to}, and ${REGIME_WORD[regimeKey]} gave back ${Math.abs(d.worstRegimeR)}R of it ` +
        `across ${d.worstRegimeTrades} trades — more than any other regime over the same stretch.`;
    }
    /* The culprit being a DIFFERENT regime is not silence, it is the other
       half of the same check: the stretch that actually cost money was built
       somewhere else, which is evidence about where the damage really comes
       from and belongs on the card either way. */
    return ` And the damage did not come from there: your deepest drawdown ran ${d.depthR}R from ` +
      `${d.from} to ${d.to}, and the largest share of it — ${Math.abs(d.worstRegimeR)}R across ` +
      `${d.worstRegimeTrades} trades — was given back in ${REGIME_WORD[d.worstRegime]}.`;
  };

  /**
   * THE SHAPE READING, FOLDED INTO THE REGIME CARD RATHER THAN GIVEN ITS OWN.
   *
   * It had one for a while: same three regimes, same trades, a second chart
   * of win rate under a second headline. Two cards saying "your trades, by
   * market regime" is one card and a repetition, and the reader pays for the
   * repetition by having to hold the first chart in mind while reading the
   * second. The win rate is on the bars now, and the sentence that matters —
   * that it falls while the return does not — belongs to the finding it
   * qualifies.
   */
  const shapeNote = (winSpread != null && winSpread >= 15 && press.trades >= 12 &&
      up.expectancy != null && press.expectancy != null &&
      Math.abs(up.expectancy - press.expectancy) < 0.3)
    ? ` One thing the bars show that the averages hide: your win rate falls from ${up.winRate}% in ` +
      `uptrends to ${press.winRate}% under pressure while the return per trade barely moves. The same ` +
      `money is arriving from fewer, bigger winners — a change in the shape of the edge, not a loss of ` +
      `it, and the two want opposite responses. An edge that has gone wants fewer trades; an edge that ` +
      `has changed shape wants its winners left alone.`
    : "";

  const ev = {
    byRegime: byReg, indexDays: dayCounts,
    expectancyGapUptrendVsCorrection: gap,
    /* Flattened for the evidence table, which renders an object of objects as
       raw JSON — the developer output this screen was supposed to stop
       showing. The nested version stays out of `ev` entirely. */
    ...(worstDrawdown ? {
      worstDrawdownDepthR: worstDrawdown.depthR,
      worstDrawdownFrom: worstDrawdown.from,
      worstDrawdownTo: worstDrawdown.to,
      worstDrawdownTrades: worstDrawdown.trades,
      mostGivenBackIn: worstDrawdown.worstRegime,
      mostGivenBackR: worstDrawdown.worstRegimeR,
    } : {}),
    topThreeShareOfPressurePct: topShare("pressure")?.pct ?? null,
    topThreeShareOfUptrendPct: topShare("uptrend")?.pct ?? null,
    topThreeShareOfCorrectionPct: topShare("correction")?.pct ?? null,
  };

  /**
   * A bar per regime, on expectancy — because the claim is that the market's
   * state changes what a trade is worth, and three bars of different lengths
   * say that where "0.96R against −0.24R" asks the reader to hold two numbers
   * and subtract.
   */
  const REGIME_WORDS = { uptrend: "Confirmed uptrend", pressure: "Under pressure", correction: "Correction" };
  const regimeChart = {
    type: "bars",
    unit: "R",
    rows: ["uptrend", "pressure", "correction"]
      .filter((k) => byReg[k] && byReg[k].trades > 0 && byReg[k].expectancy != null)
      /* No `worst` flag: which regime is worst is a fact about this record,
         not a rule. Marking corrections by assumption drew the solid bar on
         the BEST one wherever somebody happened to trade corrections well.
         Left undefined, the chart marks whichever bar is actually lowest. */
      /**
       * Win rate rides along on each row rather than getting a second card.
       * The bar is expectancy — one measure, one length — and the win rate is
       * printed beside it, because the interesting thing about these two is
       * where they DISAGREE, and that is only visible when they are on the
       * same line.
       */
      .map((k) => ({
        label: REGIME_WORDS[k], value: byReg[k].expectancy, n: byReg[k].trades,
        sub: byReg[k].winRate != null ? `${byReg[k].winRate}% won` : null,
      })),
    axisNote: "average return per trade, with the share that won, by market regime",
  };
  const out = [];

  // The core question: is activity following the market's lead?
  const upRate = up.tradesPer100Days, corrRate = corr.tradesPer100Days;
  if (upRate != null && corrRate != null && corr.trades >= 5) {
    ev.activityRatio = +(upRate / corrRate).toFixed(2);

    const rateFigs = [
      { value: `${corrRate}`, label: "trades per 100 days in corrections" },
      { value: `${upRate}`, label: "per 100 days in uptrends" },
      ...(gap != null
        ? [{ value: `${gap > 0 ? "+" : "\u2212"}${Math.abs(gap)}R`, label: "uptrend minus correction" }]
        : []),
    ];

    /* Skewed toward corrections AND corrections demonstrably worse: the only
       branch where the textbook claim is also this trader's result. */
    if (corrRate > upRate && regimeMatters && gap > 0) {
      out.push(F("critical", "market-misaligned",
        "You trade most where your record is worst",
        `Breakouts fail at a higher rate when the index is below its 50-day and the 50 is below the 200, ` +
        `because there is no institutional bid to carry them — and here your own record agrees: ` +
        `${up.expectancy}R a trade in uptrends against ${corr.expectancy}R in corrections, while you take ` +
        `more of them in corrections.` + ddNote("correction") + shapeNote,
        ev,
        { lede: LEDE_REGIME, figures: rateFigs, chart: regimeChart,
          verdict: "The fix is not better stock selection. It is fewer trades in the wrong " +
                   "regime — the same setups, taken less often when the index is against them." }));
    /* Skewed toward corrections, and corrections are this trader's BEST
       regime. The textbook says one thing and the record says another; the
       record wins, and saying so is the whole value of measuring it. */
    } else if (corrRate > upRate && regimeMatters && gap < 0) {
      const conc = topShare("correction");
      out.push(F("watch", "market-contrarian",
        "You trade most in corrections, and that is where you do best",
        `The usual reading is that breakouts fail with the index below its averages, so trading more of ` +
        `them there costs money. Your record says the opposite: ${corr.expectancy}R a trade in corrections ` +
        `against ${up.expectancy}R in confirmed uptrends. That is your evidence and it beats the general ` +
        `rule — but it is worth knowing WHY before leaning on it.` +
        (conc && conc.restNegative
          ? ` And it rests on very little: the best three correction trades made more than the whole ` +
            `regime kept, so the other ${conc.n - 3} lost ${Math.abs(conc.rest)}R between them.`
          : conc && conc.pct >= 50
          ? ` Especially since ${conc.pct}% of what corrections returned came from their best three trades.`
          : "") + ddNote("correction") + shapeNote,
        ev,
        { lede: LEDE_REGIME, figures: rateFigs, chart: regimeChart,
          verdict: `On ${corr.trades} correction trades this is a lead, not a law. Worth checking ` +
                   `whether those were genuinely bought into weakness or entered before the index ` +
                   `rolled over and simply exited well.` }));
    /* Skewed, but the regimes are indistinguishable. Worth noticing, not
       worth alarming about, and the difference has to be said out loud. */
    } else if (corrRate > upRate) {
      const conc = topShare("pressure");
      out.push(F("watch", "market-misaligned",
        "You trade more when the market is against you",
        `The textbook reading is that this costs money, and on your record so far it has not: the three ` +
        `regimes return ${up.expectancy}R, ${press.expectancy}R and ${corr.expectancy}R a trade, which at ` +
        `these sample sizes is one number. So this is worth knowing rather than fixing — the exposure is ` +
        `real, the cost is not yet visible.` +
        (conc && conc.restNegative
          ? ` And thinner than it looks: the best three trades in that regime made more than it kept, ` +
            `so the other ${conc.n - 3} lost ${Math.abs(conc.rest)}R between them.`
          : conc && conc.pct >= 50
          ? ` One caution: ${conc.pct}% of everything that regime returned came from its best three ` +
            `trades, so that figure is thinner than it looks.`
          : "") + ddNote("correction") + shapeNote,
        ev,
        { lede: LEDE_REGIME, figures: rateFigs, chart: regimeChart,
          verdict: "Nothing to change on this evidence. If the gap opens up as more trades " +
                   "land, this becomes the most expensive habit on the page — which is why it " +
                   "is here rather than silent." }));
    } else if (upRate < corrRate * 1.5 && corr.trades >= 8 && regimeMatters) {
      out.push(F("warning", "market-underweight",
        "Activity barely responds to market direction",
        `You trade at roughly the same pace whatever the index is doing, while what those trades return ` +
        `differs by ${Math.abs(gap)}R between the best regime and the worst. The conditions matter to ` +
        `your results; the activity does not reflect it.` + ddNote("correction") + ddNote("pressure") + shapeNote,
        ev,
        { lede: LEDE_REGIME, figures: rateFigs, chart: regimeChart,
          verdict: "Pressing harder in uptrends and easing off in corrections is the single " +
                   "highest-leverage change available here — it changes nothing about the setups." }));
    } else {
      out.push(F("good", "market-aligned",
        "Your activity follows the market",
        `You press when conditions support it and step back when they do not. That discipline is worth ` +
        `more than any individual setup refinement.` + ddNote("correction") + shapeNote,
        ev,
        { lede: LEDE_REGIME,
          figures: [
            { value: `${upRate}`, label: "per 100 days in uptrends" },
            { value: `${corrRate}`, label: "per 100 days in corrections" },
          ],
          chart: regimeChart,
          verdict: "Nothing to change. This is the habit most traders never build." }));
    }


  }

  // Is trading in corrections worth it at all?
  if (corr.trades >= 8 && corr.expectancy != null && corr.expectancy < 0) {
    out.push(F("warning", "correction-drag",
      "Correction trades are a net loss",
      `${corr.trades} trades taken while the index was in a correction produced ${corr.totalR}R total ` +
      `(${corr.expectancy}R each, ${corr.winRate}% win rate). Had you simply not taken them, your total R would be ` +
      `${(-corr.totalR).toFixed(1)}R higher. This is the cheapest improvement available — it requires no new skill, only a filter.`,
      ev));
  }

  if (press.trades >= 8 && up.expectancy != null && press.expectancy != null) {
    ev.pressureVsUptrend = +(press.expectancy - up.expectancy).toFixed(2);
  }

  return out.length ? out : null;
}

/* ==================================================================== */
/*  7. Overtrading after a loss                                         */
/* ==================================================================== */

function tradingCadence(closed) {
  const rows = chron(closed).filter((t) => t.exit_date && t.entry_date);
  if (rows.length < 15) return null;

  const gapAfterLoss = [], gapAfterWin = [];
  for (let i = 1; i < rows.length; i++) {
    const gap = (new Date(rows[i].entry_date) - new Date(rows[i - 1].exit_date)) / 86400000;
    if (gap < 0 || gap > 90) continue;
    (rows[i - 1].r <= 0 ? gapAfterLoss : gapAfterWin).push(gap);
  }
  if (gapAfterLoss.length < 5 || gapAfterWin.length < 5) return null;

  const gl = median(gapAfterLoss), gw = median(gapAfterWin);
  const ev = {
    medianDaysAfterLoss: +gl.toFixed(1),
    medianDaysAfterWin: +gw.toFixed(1),
    sampleAfterLoss: gapAfterLoss.length,
  };

  if (gl < gw * 0.6 && gl < 3) {
    return F("warning", "revenge-cadence",
      "You re-enter faster after a loss",
      `Quick re-entry after a loss is rarely a setup arriving on its own schedule — it is usually the urge ` +
      `to get it back. Worth reading beside your diary entries for what you were feeling those days.`,
      ev,
      { lede: LEDE_CADENCE,
        figures: [{ value: `${(ev.medianDaysAfterWin - ev.medianDaysAfterLoss).toFixed(1)}d`, label: "sooner after a loss" }],
        chart: { type: "bars", unit: "d", rows: [
          { label: "After a loss", value: ev.medianDaysAfterLoss, n: ev.sampleAfterLoss, worst: true },
          { label: "After a win", value: ev.medianDaysAfterWin },
        ], axisNote: "days to the next entry, typical" },
        verdict: "The next setup does not arrive faster because the last one failed. " +
                 "If anything is different about these trades, it is you, not the market." });
  }
  return null;
}

/* ==================================================================== */
/*  8. Data completeness — can't analyse what isn't recorded            */
/* ==================================================================== */

/* ==================================================================== */
/*  Mistake cost — execution errors only                                */
/* ==================================================================== */

/**
 * What each recurring execution error has cost.
 *
 * Outcome tags like "Setup failed" are deliberately excluded. A valid setup
 * that didn't work is the cost of doing business, not a behaviour to fix, and
 * in a breakout system it is the single largest category of losses — leaving it
 * in would put it top of the table every time and bury the things you can
 * actually change.
 */
export function mistakeCost(closed, isExecutionError) {
  const m = new Map();
  for (const t of closed) {
    for (const tag of t.mistakes || []) {
      if (isExecutionError && !isExecutionError(tag)) continue;
      if (!m.has(tag)) m.set(tag, []);
      m.get(tag).push(t);
    }
  }

  const rows = [...m.entries()]
    .map(([tag, trades]) => {
      const rs = trades.map((t) => t.r).filter(isFinite);
      const total = rs.reduce((a, b) => a + b, 0);
      /**
       * What the tag came to in money, net of charges.
       *
       * Summed over ALL trades carrying the tag, not only those with a
       * computable R — a trade with no stop recorded still has a P&L, and
       * dropping it here would understate the cost of the very trades most
       * likely to have gone wrong.
       *
       * It is the total on those trades, not a counterfactual. Nobody can say
       * what they would have made without the mistake; this says what the
       * trades it was tagged on actually did.
       */
      const netPnl = trades
        .map((t) => t.pnl)
        .filter(isFinite)
        .reduce((a, b) => a + b, 0);
      return {
        tag,
        count: trades.length,
        netPnl,
        totalR: +total.toFixed(2),
        avgR: rs.length ? +(total / rs.length).toFixed(2) : null,
        winRate: rs.length
          ? +((rs.filter((x) => x > 0).length / rs.length) * 100).toFixed(0)
          : null,
      };
    })
    .sort((a, b) => a.totalR - b.totalR);

  return rows;
}

/** Separate count of trades that simply didn't work, kept out of the above. */
export function outcomeTagCounts(closed, isExecutionError) {
  const m = new Map();
  for (const t of closed) {
    for (const tag of t.mistakes || []) {
      if (isExecutionError && isExecutionError(tag)) continue;
      m.set(tag, (m.get(tag) || 0) + 1);
    }
  }
  return [...m.entries()].map(([tag, count]) => ({
    tag, count, share: closed.length ? +((count / closed.length) * 100).toFixed(0) : null,
  }));
}

/**
 * The setup fields — and ONLY the setup fields.
 *
 * Charges used to be a sixth bar here and it was the wrong card for it. Every
 * other field on this chart is read off a chart and typed in, which is exactly
 * what the verdict below promises; charges are computed by the app, so the
 * fix is a broker preset or a re-save and the instruction underneath was
 * false for one bar in five. It has its own check now — see chargesRecorded.
 */
function dataQuality(closed) {
  if (closed.length < 10) return null;
  const pc = (f) => +((closed.filter(f).length / closed.length) * 100).toFixed(0);
  const ev = {
    trades: closed.length,
    pivotPct: pc((t) => isFinite(n(t.pivot_price))),
    volumePct: pc((t) => isFinite(n(t.vol_pct_avg))),
    patternPct: pc((t) => !!t.pattern),
    exitReasonPct: pc((t) => !!t.exit_reason),
  };
  const gaps = Object.entries(ev).filter(([k, v]) => k !== "trades" && v < 60);
  if (!gaps.length) return null;

  const names = { pivotPct: "pivot price", volumePct: "breakout volume",
                  patternPct: "base pattern", exitReasonPct: "exit reason" };

  return F("watch", "data-gaps",
    "Some fields are mostly empty",
    `The setup breakdowns can only compare what is recorded. A blank does not count against a pattern — ` +
    `it makes that pattern invisible, so the cut goes on working and quietly stops meaning anything.`,
    ev,
    { /* How many fields are blank, so recency can see four become one — this
         check never changes severity and would otherwise be frozen. */
      magnitude: gaps.length,
      lede: LEDE_GAPS,
      figures: [{ value: `${gaps.length}`, label: gaps.length === 1 ? "field mostly blank" : "fields mostly blank" }],
      chart: {
        type: "bars",
        unit: "%",
        rows: Object.entries(ev)
          .filter(([k]) => k !== "trades")
          .map(([k, v]) => ({ label: names[k] || k, value: v, worst: v < 60 })),
        axisNote: "share of closed trades where the field is filled in",
      },
      verdict: "These are read off the chart, so they can be filled in any time — " +
               "and they are what the whole Edge screen has to work with." });
}

/* ==================================================================== */
/*  Charges that were never recorded                                    */
/* ==================================================================== */

/**
 * MISSING CHARGES ARE NOT A MISSING FIELD, THEY ARE OVERSTATED RETURNS.
 *
 * This was a sixth bar on the data-gaps chart, which put it beside four
 * fields you read off a chart and type in, under a verdict telling you to
 * fill them in. Charges are computed — the fix is a broker preset or a
 * re-save, and the consequence is not a thinner Edge screen, it is that net
 * P&L, return on capital and XIRR are all reading better than reality.
 *
 * AN IMPORTED ZERO IS DATA, NOT A GAP, and the old bar got this wrong. It
 * counted any trade at zero as unrecorded; ChargesField's own rule is
 * `!(charges > 0) && !imported`, because shares from a demerger carry an
 * apportioned cost and no brokerage — LTI, NLSL, TRANSINDIA and
 * ALLCARGOTERMINALS all sit at zero legitimately. That zero came from the
 * broker and is the truth, so counting it as missing understates the figure.
 *
 * THE COST IS ESTIMATED FROM THIS BOOK, NOT FROM A RATE TABLE. What the
 * missing charges are worth is guessable two ways: run charges.js over them,
 * which needs the profile this function is not given and would silently apply
 * today's broker preset to trades taken under another; or measure what
 * charges actually cost on the trades that DO record them, as a share of
 * turnover, and apply that. The second is this trader's own measured rate,
 * needs nothing passed in, and is honest about being an estimate.
 */
function chargesRecorded(closed) {
  if (closed.length < 10) return null;

  const turnover = (t) => {
    const q = n(t.quantity), inP = n(t.entry_price), outP = n(t.exit_price);
    if (!isFinite(q) || !isFinite(inP)) return null;
    return q * inP + (isFinite(outP) ? q * outP : 0);
  };

  /* ChargesField's rule, verbatim: a zero is "never set" only if nobody
     imported the trade. */
  const missing = closed.filter((t) => !(n(t.charges) > 0) && !t.imported);
  const recorded = closed.filter((t) => n(t.charges) > 0);
  const pct = +(((closed.length - missing.length) / closed.length) * 100).toFixed(0);

  /* Above this it is a handful of rows, not a distortion worth a card. */
  if (pct >= 90) return null;

  /* The trader's own cost of doing business, as a share of what they turned
     over. Needs enough priced trades to be a rate rather than an anecdote. */
  const priced = recorded.map((t) => ({ c: n(t.charges), v: turnover(t) }))
    .filter((x) => isFinite(x.c) && isFinite(x.v) && x.v > 0);
  const rate = priced.length >= 10
    ? priced.reduce((a, x) => a + x.c, 0) / priced.reduce((a, x) => a + x.v, 0)
    : null;

  const missingTurnover = missing.map(turnover).filter(isFinite).reduce((a, b) => a + b, 0);
  const estimate = rate != null && missingTurnover > 0
    ? Math.round(rate * missingTurnover) : null;

  const ev = {
    trades: closed.length,
    chargesRecordedPct: pct,
    tradesWithNoCharges: missing.length,
    /* Named so the evidence table cannot imply this was measured. */
    measuredChargeRatePctOfTurnover: rate != null ? +(rate * 100).toFixed(3) : null,
    estimatedMissingCharges: estimate,
  };

  const costs = estimate != null
    ? ` On the trades that do record them, charges come to ${(rate * 100).toFixed(2)}% of turnover. ` +
      `At your own rate the missing ones are worth roughly ${rupee(estimate)} — currently counted as ` +
      `profit, in every net figure on the app.`
    : ` What they came to cannot be estimated here, because too few trades record charges to measure ` +
      `a rate from.`;

  return F(pct < 60 ? "warning" : "watch", "charges-missing",
    "Some trades have no charges recorded",
    `${missing.length} of your ${closed.length} closed trades carry no charges — brokerage, STT, ` +
    `exchange fees, stamp duty and GST all counted as zero.${costs} This is the one gap that flatters ` +
    `rather than blurs: net P&L, return on capital and XIRR all read better than reality, and by more ` +
    `the longer the book gets.`,
    ev,
    { /* The share still missing, so a book that has been importing properly
         for a year stops being judged on the years before it. */
      magnitude: 100 - pct,
      lede: LEDE_CHARGES,
      figures: [
        { value: `${missing.length}`, label: "trades with no charges" },
        { value: `${pct}%`, label: "of trades have them recorded" },
        ...(estimate != null
          ? [{ value: rupee(estimate), label: "counted as profit, roughly" }]
          : []),
      ],
      /* No chart. One share and one estimate are two numbers, and the figures
         above already are the chart — a two-bar graphic of recorded against
         missing would add a picture without adding a fact. */
      verdict: "Nothing to fill in by hand. Set your broker and rates in Settings, then " +
               "re-save the affected trades — the app computes the rest, and every net " +
               "figure on the app moves to match." });
}

/* ==================================================================== */
/*  What you were feeling, against what happened                        */
/* ==================================================================== */

/** Below this an emotion is noise and gets shown but not spoken about. */
const MIN_PER_EMOTION = 8;

/**
 * A feeling as it reads mid-sentence. Lowercased, because "Trades you open
 * feeling Anxious" reads like a proper noun — except FOMO, which is an
 * acronym and comes out as "fomo" if you lowercase it blindly.
 */
const feelingWord = (s) =>
  /^[A-Z0-9]+$/.test(String(s)) ? String(s) : String(s).toLowerCase();

/**
 * Emotion tags against the R of the trades they sat beside.
 *
 * The diary has asked for a feeling on every entry since the app existed and
 * has never once said what those feelings were worth. The only mention of it
 * anywhere in this file used to be a line telling the reader to go and pair
 * the two up by hand — with both halves sitting right here.
 *
 * MATCHED ON ENTRY DATE, NOT EXIT. This is the whole difference between a
 * finding and a horoscope. A feeling recorded the day a position was opened is
 * something that could have shaped the decision. A feeling recorded the day it
 * closed mostly records how the result felt, so pairing it with that result
 * would discover, with great confidence, that losing puts people in a bad
 * mood. `trade_id` is honoured where the writer set one, since that is them
 * saying which trade they meant.
 *
 * A trade counts once per emotion however many entries mention it: two
 * calm notes on one day are one calm day, not two.
 */
function emotionOutcomes(closed, diary) {
  if (!Array.isArray(diary) || !diary.length) return null;

  const scored = closed.filter((t) => isFinite(t.r));
  if (scored.length < 10) return null;

  const byId = new Map(scored.map((t) => [t.id, t]));
  const byEntryDate = new Map();
  for (const t of scored) {
    const d = String(t.entry_date || "").slice(0, 10);
    if (!d) continue;
    if (!byEntryDate.has(d)) byEntryDate.set(d, []);
    byEntryDate.get(d).push(t);
  }

  const perEmotion = new Map();          // emotion -> Map(tradeId -> trade)
  for (const e of diary) {
    const tags = Array.isArray(e.emotions) ? e.emotions : [];
    if (!tags.length) continue;

    const hits = [];
    if (e.trade_id && byId.has(e.trade_id)) hits.push(byId.get(e.trade_id));
    const d = String(e.entry_date || "").slice(0, 10);
    if (d && byEntryDate.has(d)) hits.push(...byEntryDate.get(d));
    if (!hits.length) continue;

    for (const tag of tags) {
      if (!perEmotion.has(tag)) perEmotion.set(tag, new Map());
      const m = perEmotion.get(tag);
      for (const t of hits) m.set(t.id, t);
    }
  }
  if (!perEmotion.size) return null;

  const rows = [...perEmotion.entries()].map(([emotion, m]) => {
    const list = [...m.values()];
    const total = list.reduce((a, t) => a + t.r, 0);
    return {
      emotion,
      trades: list.length,
      expectancy: +(total / list.length).toFixed(2),
      winRatePct: +((list.filter((t) => t.r > 0).length / list.length) * 100).toFixed(0),
      totalR: +total.toFixed(1),
    };
  }).sort((a, b) => a.expectancy - b.expectancy);

  const solid = rows.filter((r) => r.trades >= MIN_PER_EMOTION);
  const tagged = new Set([...perEmotion.values()].flatMap((m) => [...m.keys()]));

  const ev = {
    diaryEntriesRead: diary.length,
    tradesTagged: tagged.size,
    feelingsWithEnoughTrades: solid.length,
    minimumTradesToCount: MIN_PER_EMOTION,
    byFeeling: rows,
  };

  // Nothing to compare against yet — say so plainly rather than reading a
  // difference off four trades.
  if (solid.length < 2) {
    return F("watch", "emotion-outcome",
      "Not enough diary entries to read your moods yet",
      `${tagged.size} trade${tagged.size === 1 ? " has" : "s have"} a feeling recorded against ` +
      `${diary.length} diary ${diary.length === 1 ? "entry" : "entries"}, and no two feelings yet ` +
      `have the ${MIN_PER_EMOTION} trades it takes to compare them. The table below is what there ` +
      `is so far. Tag the mood as you enter a trade rather than after it closes — the second only ` +
      `records how the result felt.`,
      ev);
  }

  const worst = solid[0];
  const best = solid[solid.length - 1];
  const gap = best.expectancy - worst.expectancy;

  if (gap < 0.4) {
  /** A bar per feeling, ordered worst to best as `rows` already is. The claim
   *  is a gap between two moods, which is two bar lengths. */
  const feelingChart = {
    type: "bars",
    unit: "R",
    rows: solid.map((r) => ({
      label: feelingWord(r.emotion), value: r.expectancy, n: r.trades,
      worst: r.emotion === worst.emotion,
    })),
    axisNote: "average return per trade, by how the day felt",
  };

    return F("good", "emotion-outcome",
      "Your mood doesn't seem to move your results",
      `Across ${solid.length} feelings with at least ${MIN_PER_EMOTION} trades each, expectancy ` +
      `runs from ${worst.expectancy}R when ${feelingWord(worst.emotion)} to ${best.expectancy}R ` +
      `when ${feelingWord(best.emotion)} — a spread of ${gap.toFixed(2)}R, which is small enough ` +
      `to be noise. Worth knowing: it means the process is holding up whatever kind of day you are ` +
      `having, which is harder than it sounds.`,
      ev,
      { lede: LEDE_FEELING,
        figures: [{ value: `${gap.toFixed(2)}R`, label: "between best and worst mood" }],
        chart: feelingChart,
        verdict: "Nothing to act on — and that is the finding. Most records show a gap here." });
  }

  return F(worst.expectancy < 0 ? "warning" : "watch", "emotion-outcome",
    `Trades you open feeling ${feelingWord(worst.emotion)} do worse`,
    `${worst.trades} trades entered on days you logged ${feelingWord(worst.emotion)} came to ` +
    `${worst.expectancy}R each, against ${best.expectancy}R across ${best.trades} when you logged ` +
    `${feelingWord(best.emotion)} — a gap of ${gap.toFixed(2)}R a trade. ` +
    `Matched on the day the position was OPENED, not closed, so this is about the state you were ` +
    `in when you decided rather than how the result made you feel afterwards. ` +
    `It is still your own tagging and a small sample, so read it as a question worth watching ` +
    `rather than a law — but ${feelingWord(worst.emotion)} is a cheap thing to notice before you ` +
    `press the button.`,
    ev,
    { lede: LEDE_FEELING,
      figures: [{ value: `${gap.toFixed(2)}R`, label: "gap between moods" }],
      chart: feelingChart,
      verdict: `Matched on the day you OPENED the position, so this is the state you decided in — ` +
               `not how the result felt afterwards. ${feelingWord(worst.emotion)} is a cheap thing ` +
               `to notice before pressing the button.` });
}

/* ==================================================================== */
/*  How much of the record rests on how few trades                      */
/* ==================================================================== */

/**
 * Concentration of the result.
 *
 * The app already computes every number this needs and has never once said it
 * out loud. On the journal it was written against, 105 trades out of 404 —
 * one in four — carried nearly three quarters of the total R.
 *
 * NOT a fault, and deliberately not phrased as one. Cutting losers and letting
 * winners run produces concentration by construction; a breakout trader whose
 * returns were evenly spread would be the one with a problem. The finding is
 * useful for a different reason.
 *
 * WHAT IT ACTUALLY TELLS YOU: how big your sample really is. Four hundred
 * trades sounds like enough to trust an expectancy. If a dozen of them carry
 * the result, the expectancy rests on those twelve and the other three hundred
 * and ninety are mostly noise around zero — so the error bars are far wider
 * than the trade count suggests, and a run of ordinary months says much less
 * about whether the edge has gone than it appears to.
 *
 * Measured against gross winnings rather than net R. Net can be small or
 * negative while the winners are large, and "the top ten trades made 340% of
 * your total" is arithmetic nobody should have to parse.
 */
function returnConcentration(closed) {
  const rows = closed.filter((t) => isFinite(t.r));
  if (rows.length < 20) return null;

  const sorted = [...rows].sort((a, b) => b.r - a.r);
  const gross = sorted.reduce((a, t) => a + Math.max(0, t.r), 0);
  if (!(gross > 0)) return null;

  // How few of the best trades it takes to make half of everything earned.
  let cum = 0, halfCount = 0;
  for (const t of sorted) {
    if (t.r <= 0) break;
    cum += t.r;
    halfCount++;
    if (cum >= gross / 2) break;
  }

  const decileCount = Math.max(1, Math.round(rows.length * 0.1));
  const decileR = sorted.slice(0, decileCount).reduce((a, t) => a + t.r, 0);
  const decilePct = (decileR / gross) * 100;
  const halfPct = (halfCount / rows.length) * 100;

  // What the rest of the record comes to once the top decile is set aside —
  // the number that makes the point without any interpretation attached.
  const restR = sorted.slice(decileCount).reduce((a, t) => a + t.r, 0);

  const ev = {
    trades: rows.length,
    grossR: +gross.toFixed(1),
    totalR: +sorted.reduce((a, t) => a + t.r, 0).toFixed(1),
    tradesForHalfTheGains: halfCount,
    shareOfAllTradesPct: +halfPct.toFixed(1),
    topDecileTrades: decileCount,
    topDecileSharePct: +decilePct.toFixed(1),
    everythingElseR: +restR.toFixed(1),
    biggest: sorted.slice(0, 5).map((t) => ({
      symbol: t.symbol, r: +Number(t.r).toFixed(2),
      heldDays: isFinite(t.heldDays) ? Math.round(t.heldDays) : null,
      exit: t.exit_date,
    })),
  };

  /**
   * How long the big ones were held against everything else.
   *
   * The finding says a few trades carry the record; the next question is what
   * those trades were like, and holding period is the part the trader can do
   * something about. If the winners were held far longer, the lesson is about
   * not cutting them short rather than about finding more of them.
   */
  const heldOf = (list) => list.map((t) => t.heldDays).filter((d) => isFinite(d));
  const topHeld = heldOf(sorted.slice(0, decileCount));
  const restHeld = heldOf(sorted.slice(decileCount));
  if (topHeld.length && restHeld.length) {
    ev.topDecileMedianHeldDays = Math.round(median(topHeld));
    ev.everythingElseMedianHeldDays = Math.round(median(restHeld));
  }

  /**
   * Two ways a record can rest on a few trades, and the share of gains only
   * catches one of them.
   *
   * The journal this was written against reported 57.6% from the top decile —
   * under any reasonable threshold — while everything outside that decile came
   * to MINUS 143.9R. So the share said "spread out" and the remainder said the
   * whole result was those forty trades, and the finding printed both in the
   * same paragraph.
   *
   * If setting the best tenth aside leaves the rest underwater, the record
   * rests on them whatever the percentage says.
   */
  const heavy = decilePct >= 60 || restR <= 0;

  // Only worth a sentence when the gap is big enough to act on.
  const held = ev.topDecileMedianHeldDays && ev.everythingElseMedianHeldDays
    && ev.topDecileMedianHeldDays >= ev.everythingElseMedianHeldDays * 1.5
    ? ` They were also held far longer — a median of ${ev.topDecileMedianHeldDays} days against ` +
      `${ev.everythingElseMedianHeldDays} for the rest, which points at holding rather than picking.`
    : "";

  const concChart = {
    type: "bars",
    unit: "R",
    rows: [
      { label: `Best ${decileCount}`, value: +(gross * (ev.topDecileSharePct / 100)).toFixed(1), n: decileCount },
      { label: `The other ${rows.length - decileCount}`, value: ev.everythingElseR, n: rows.length - decileCount },
    ],
    axisNote: "total R, split between the best tenth and everything else",
  };

  return F(heavy ? "watch" : "good", "return-concentration",
    heavy
      ? "A few trades carry the whole record"
      : "Your returns are spread across many trades",
    `${halfCount} trade${halfCount === 1 ? "" : "s"} — ${ev.shareOfAllTradesPct}% of the ones with an R — ` +
    `made half of everything you earned, and your best ${decileCount} produced ` +
    `${ev.topDecileSharePct}% of it. Set those aside and the remaining ` +
    `${rows.length - decileCount} come to ${ev.everythingElseR >= 0 ? "+" : ""}${ev.everythingElseR}R. ` +
    (heavy
      ? `That is not a fault — cutting losers and letting winners run concentrates returns by ` +
        `construction, and a breakout record with evenly spread gains would be the odd one. What it ` +
        `changes is how much your own numbers prove. ${rows.length} trades sounds like enough to ` +
        `trust an expectancy; if ${decileCount} of them carry it, that is closer to your real sample ` +
        `size, and a quiet few months says far less about whether the edge has gone than it feels ` +
        `like it does.`
      : `No single stretch of luck is holding this up, which means the expectancy above is doing ` +
        `what a sample that size should — describing the method rather than a handful of trades.`) + held,
    ev,
    { lede: LEDE_CONC,
      figures: [
        { value: `${ev.topDecileSharePct}%`, label: `from your best ${decileCount}` },
        { value: `${ev.shareOfAllTradesPct}%`, label: "of trades made half of it" },
      ],
      chart: concChart,
      verdict: heavy
        ? `Your real sample is closer to ${decileCount} than to ${rows.length}. A quiet few months ` +
          `says much less about whether the edge has gone than it will feel like it does.`
        : "The expectancy above is describing the method rather than a handful of trades — " +
          "which is what makes it worth acting on." });
}

/* ==================================================================== */
/*  Duplicate positions                                                 */
/* ==================================================================== */

/**
 * The same symbol opening more than once on the same day.
 *
 * Sometimes deliberate — a position built through two orders and recorded as
 * two trades. Often not: a hand-entered trade that a later import re-created
 * under a different id, so the journal counts one position twice.
 *
 * It costs more than a count. A Zerodha import matches sells to a position by
 * symbol and entry date, and where two positions share both it cannot tell
 * which one the sells belong to. Rather than guess and put real exits on the
 * wrong trade, the import holds those rows back — so the exits never land at
 * all until the duplicate is resolved. That is why this is worth surfacing
 * even when the pair is legitimate: it will keep blocking every future file.
 *
 * Reads every trade, open and closed, since a duplicate is about how the
 * position was entered and has nothing to do with whether it finished.
 */
function duplicatePositions(all) {
  if (!Array.isArray(all) || all.length < 2) return null;

  const by = new Map();
  for (const t of all) {
    if (!t.symbol || !t.entry_date) continue;
    const k = `${t.symbol}|${t.entry_date}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(t);
  }

  /**
   * SAME SYMBOL, SAME DAY, DIFFERENT BROKERS IS NOT A DUPLICATE.
   *
   * This grouped on symbol and entry date alone, which is the exact rule
   * migration 019 removed from the importer and for the same reason: buying
   * one stock on one day through two accounts is routine, and the two rows
   * are two real positions. `reconcile()` filters candidates through
   * `sameBroker` before it will call anything a collision, so a check that
   * skips that step reports pairs the importer would never confuse — and
   * then tells the reader their next file is blocked on it, which is false.
   *
   * The null broker is why this is a grouping and not a key. A hand-entered
   * trade has no broker and matches either way (deliberately — that is what
   * lets a later import complete it), so one null fuses everything that
   * shares the symbol and date into a single collision set. With no nulls
   * present, each broker collides only with itself.
   */
  const collisionSets = (g) => {
    if (g.length < 2) return [];
    if (g.some((t) => !t.broker)) return [g];
    const known = new Map();
    for (const t of g) {
      if (!known.has(t.broker)) known.set(t.broker, []);
      known.get(t.broker).push(t);
    }
    return [...known.values()].filter((s) => s.length > 1);
  };

  const groups = [...by.values()].flatMap(collisionSets);
  if (!groups.length) return null;

  groups.sort((a, b) => b.length - a.length || (a[0].symbol < b[0].symbol ? -1 : 1));
  const trades = groups.reduce((a, g) => a + g.length, 0);

  /**
   * The one measurement that separates the two causes.
   *
   * If the rows sell on entirely different dates, nothing has been counted
   * twice: it is one position scaled out over time, arriving through two
   * files that each saw only their own financial year. The money is right and
   * the position is merely fragmented.
   *
   * If the same sell date appears on both rows, the same exit may have been
   * recorded twice, and the P&L really is inflated. Rarer, and much worse.
   */
  const overlapping = groups.filter((g) => {
    const seen = new Set();
    for (const t of g) {
      const dates = new Set((t.exits || []).map((e) => e.exit_date).filter(Boolean));
      if (!dates.size && t.exit_date) dates.add(t.exit_date);
      for (const d of dates) {
        if (seen.has(d)) return true;
        seen.add(d);
      }
    }
    return false;
  }).length;
  const split = groups.length - overlapping;

  const ev = {
    groups: groups.length,
    trades,
    sharingASellDate: overlapping,
    scaledOutAcrossFiles: split,
    /**
     * ONE ROW PER TRADE, NOT PER PAIR WITH THE TRADES NESTED INSIDE IT.
     *
     * The nested version rendered as `[object Object],[object Object]`: the
     * evidence table takes a list of like-shaped objects and prints each
     * value, and an array of objects has no printable form. It had never
     * shown a single useful character.
     *
     * Flat is also the more useful shape. What decides whether a pair is one
     * position split across two files or the same position recorded twice is
     * the quantity, the price and where each row came from — and those only
     * mean anything side by side, which is what rows are for.
     */
    positions: groups.slice(0, 12).flatMap((g) =>
      g.map((t) => ({
        symbol: t.symbol,
        entry_date: t.entry_date,
        quantity: Number(t.quantity),
        entry_price: Number(t.entry_price),
        status: t.status,
        /* The broker name when there is one, since with two accounts that is
           the first thing worth seeing. Null means hand-entered. */
        source: t.broker || (t.imported ? "imported" : "entered by hand"),
      }))
    ),
  };

  const one = groups.length === 1;
  const parts = [];
  if (split) {
    parts.push(
      `${split === 1 ? "In one, the rows" : `In ${split} of them the rows`} sell on entirely ` +
      `different dates, so nothing has been counted twice — that is one position scaled out over ` +
      `time and recorded in two pieces, usually because two files each saw only their own financial ` +
      `year. The money is right; the position is split, so each half carries its own R against a ` +
      `fraction of the risk you actually took.`
    );
  }
  if (overlapping) {
    parts.push(
      `${overlapping === 1 ? "In one, both rows share" : `In ${overlapping} of them the rows share`} ` +
      `a sell date, which can mean the same exit was recorded twice. Worth opening ` +
      `${overlapping === 1 ? "that one" : "those"} before anything else — if it is a genuine double, ` +
      `your P&L is overstated by it.`
    );
  }

  return F("watch", "duplicate-positions",
    one ? "One position recorded as two trades" : "Some positions are recorded as two trades",
    /* Not "through the same broker": a hand-entered row has no broker and
       collides with every one of them, so that clause would be false on
       exactly the pair most likely to be a genuine duplicate. The `source`
       column says where each row came from, which is the honest version. */
    `${groups.length} position${one ? " was" : "s were"} opened more than once in the same stock on ` +
    `the same day — ${trades} trades between them. ${parts.join(" ")} ` +
    `Either way an import can't tell which of the pair a later sell belongs to, so it holds those ` +
    `rows back instead of guessing, and will keep doing that on every future file until they are merged.`,
    ev);
}

/* ==================================================================== */
/*  What the trades reached                                             */
/* ==================================================================== */

/**
 * THE ONLY COMPARISONS ON THIS SCREEN THAT ARE IMMUNE TO THE SORTING PROBLEM.
 *
 * Every group-versus-group finding here carries the same hazard, and the
 * exit-method card had to be rewritten because of it: split trades by
 * something the trade's own behaviour decided, and the groups differ because
 * the trades differ, not because the choice did.
 *
 * These do not split anything. Each trade is measured against ITSELF — what it
 * reached against what was taken from it — which is the shape `scaleOutFinding`
 * uses and the reason that one is allowed a verdict. One population, one trade
 * at a time, nothing sorted.
 *
 * All of it needs `path_to`, which only exists once the bars have been read.
 * Silent until then rather than partial: a capture ratio over the third of a
 * book that happened to be measured is a number about that third.
 */

/** Below this the figures describe a handful of trades rather than a habit. */
const MIN_MEASURED = 15;

const measured = (closed) =>
  closed.filter((t) => t.path_to && isFinite(t.mfe_r) && isFinite(t.r));

/**
 * How much of what the trades offered actually came back.
 *
 * A HUNDRED PERCENT IS NOT THE TARGET AND THE CARD MUST NOT IMPLY IT IS.
 * Capturing the whole of every peak means selling the exact high every time,
 * which nobody does and no method tries to. So this reports the shape of the
 * distribution rather than scoring the ratio: the interesting trades are the
 * ones that gave back most of a real move, and they are countable without any
 * claim about what the number ought to be.
 */
function captureRate(closed) {
  const rows = measured(closed).filter((t) => t.mfe_r > 0.5);
  if (rows.length < MIN_MEASURED) return null;

  const offered = rows.reduce((a, t) => a + t.mfe_r, 0);
  const taken = rows.reduce((a, t) => a + t.r, 0);
  if (!(offered > 0)) return null;
  const pct = +((taken / offered) * 100).toFixed(0);

  /* The cut is in the label. "Kept about half" and "Gave most of it back" are
     two points on one continuum, and without the boundary the reader is
     trusting that it was drawn somewhere sensible instead of seeing where. */
  const band = (t) => {
    const k = t.r / t.mfe_r;
    return k >= 0.6 ? "Kept most \u00b7 60%+"
      : k >= 0.3 ? "Kept about half \u00b7 30\u201360%"
      : k > 0 ? "Gave most back \u00b7 under 30%"
      : "Gave it all back \u00b7 nothing left";
  };
  const ORDER = ["Kept most \u00b7 60%+", "Kept about half \u00b7 30\u201360%",
                 "Gave most back \u00b7 under 30%", "Gave it all back \u00b7 nothing left"];
  const counts = ORDER.map((label) => ({
    label, value: rows.filter((t) => band(t) === label).length,
  }));
  const gaveAll = counts[3].value;

  return F("watch", "capture-rate",
    "What your trades offered, against what you took",
    `Across ${rows.length} measured trades the best closing price on each came to ${offered.toFixed(1)}R ` +
    `between them, and you finished with ${taken.toFixed(1)}R — ${pct}% of it. ${gaveAll} of them ` +
    `were up at some point and finished at or below where they started.`,
    { tradesMeasured: rows.length, offeredR: +offered.toFixed(1), takenR: +taken.toFixed(1),
      capturePct: pct, gaveItAllBack: gaveAll },
    { magnitude: 100 - pct,
      lede: LEDE_CAPTURE,
      figures: [
        { value: `${pct}%`, label: "of the peak, kept" },
        { value: `${gaveAll}`, label: "gave all of it back" },
      ],
      chart: {
        type: "bars", unit: "",
        rows: counts.map((c) => ({ ...c, worst: c.label === ORDER[3] })),
        axisNote: "trades, by how much of their best close they finished with",
      },
      verdict: "Nobody keeps all of a peak — selling the exact high every time is not a method " +
               "anyone has, which is why this is not scored. The row that matters is the last " +
               "one: those trades were free at some point and ended up costing." });
}

/**
 * Trades that reached the point where the stop could go to breakeven, and
 * finished at or below entry anyway.
 *
 * DELIBERATELY NOT A VERDICT. The app suggests moving a stop to breakeven at
 * 1.5R; that is a suggestion, and a trader running their own tested exit rules
 * has every right to ignore it. Calling this indiscipline would be the journal
 * marking somebody against its own method rather than theirs — the same error
 * that had to come out of the exit-method card. So it counts an OUTCOME. What
 * to do about it is the reader's call, and the card says so.
 */
function roundTrips(closed) {
  const rows = measured(closed);
  if (rows.length < MIN_MEASURED) return null;

  const free = rows.filter((t) => t.became_free_on);
  if (free.length < 5) return null;
  const back = free.filter((t) => t.r <= 0);
  if (!back.length) {
    return F("good", "round-trips",
      "Nothing that got free came back",
      `${free.length} of your measured trades closed at or past ${FREE_AT_R}R at some point, and none ` +
      `of them finished at a loss. Whatever you are doing once a trade is in front, it is holding.`,
      { measuredTrades: rows.length, becameFree: free.length, roundTripped: 0 },
      { lede: LEDE_ROUNDTRIP, magnitude: 0,
        figures: [{ value: `${free.length}`, label: `reached ${FREE_AT_R}R` }, { value: "0", label: "came back" }],
        verdict: "Nothing to change. This is the failure mode that quietly costs the most " +
                 "and it is not happening to you." });
  }

  const pct = +((back.length / free.length) * 100).toFixed(0);
  const peak = back.reduce((a, t) => a + t.mfe_r, 0);
  const cost = back.reduce((a, t) => a + (t.mfe_r - t.r), 0);
  /**
   * WHERE THEY ACTUALLY FINISHED, because without it the sentence reads as an
   * error. "Up 21.6R at their best closes and gave back 26.2R" is arithmetic
   * — these trades ended BELOW where they started, so the fall from the peak
   * is necessarily larger than the peak itself — but on the page it looks
   * like a number that cannot be right, and a reader who stops to check the
   * subtraction has stopped reading the finding.
   *
   * Naming the end point closes it: 21.6 minus 26.2 is −4.6, and the three
   * numbers reconcile in the order they are read.
   */
  const ended = peak - cost;

  return F(pct >= 30 ? "warning" : "watch", "round-trips",
    "Some trades got free, then came back",
    `${back.length} of the ${free.length} trades that reached ${FREE_AT_R}R finished at or below where ` +
    `they started — ${pct}% of them. Between them they were up ${peak.toFixed(1)}R at their best closes ` +
    `and finished at ${ended >= 0 ? "" : "−"}${Math.abs(ended).toFixed(1)}R, a round ` +
    `trip of ${cost.toFixed(1)}R.`,
    { measuredTrades: rows.length, becameFree: free.length, roundTripped: back.length,
      roundTrippedPct: pct, peakRGivenUp: +cost.toFixed(1) },
    { magnitude: pct,
      lede: LEDE_ROUNDTRIP,
      figures: [
        { value: `${back.length} of ${free.length}`, label: `reached ${FREE_AT_R}R, finished at or below entry` },
        { value: `${cost.toFixed(1)}R`, label: "round-tripped from peak to close" },
      ],
      chart: {
        type: "strip", unit: "R", threshold: FREE_AT_R,
        /* Not "1.5R · risk free": the chart appends the threshold and its unit
           itself, so naming it here printed "1.5R · risk free · 1.5R". */
        thresholdLabel: "risk free", worseIsLower: false,
        /* And not "past your stop", which is what this said before the caption
           could be overridden — a sentence about the stop, over a line that
           marks the opposite end of the trade. */
        pastLabel: "reached this, then came back",
        leftLabel: "least in front",
        rightLabel: "furthest in front",
        points: back
          .map((t) => ({ v: +t.mfe_r.toFixed(2), label: t.symbol, past: true }))
          .sort((a, b) => b.v - a.v),
        axisNote: "how far in front each of these got, at the close, before it came back",
      },
      verdict: `An outcome, not a verdict. The app suggests moving a stop to breakeven once ` +
               `a trade is ${FREE_AT_R}R in front, but that is a suggestion and your own rules ` +
               `may hold the original stop deliberately. What is worth knowing is which of ` +
               `these gapped down and which drifted back through entry with the price there ` +
               `to be taken \u2014 only the second kind is a decision.` });
}

/**
 * The fastest movers, and what became of them.
 *
 * A breakout book is paid for by a small number of trades that work
 * immediately, so what happens to those is worth its own card. Same-trade
 * again: each of these is measured against its own peak, never against the
 * trades that did not run.
 */
function powerTrades(closed) {
  const rows = measured(closed);
  if (rows.length < MIN_MEASURED) return null;

  const power = rows.filter((t) => t.is_power);
  if (power.length < 5) return null;

  const kept = power.filter((t) => t.r >= POWER_R * 0.5).length;
  const cut = power.filter((t) => t.r <= 1).length;
  const avgPeak = mean(power.map((t) => t.mfe_r));
  const avgTook = mean(power.map((t) => t.r));

  return F(cut / power.length >= 0.4 ? "warning" : "watch", "power-trades",
    "The ones that moved fastest",
    `${power.length} of your trades closed at or past ${POWER_R}R within ${POWER_DAYS} sessions of ` +
    `entry. Those are the trades a breakout method is built to catch, and they averaged ` +
    `${avgPeak.toFixed(1)}R at their best close against ${avgTook.toFixed(1)}R taken. ` +
    (cut > 0
      ? `${cut} of them finished at 1R or less.`
      : `None of them finished at 1R or less.`),
    { measuredTrades: rows.length, powerTrades: power.length,
      avgPeakR: +avgPeak.toFixed(2), avgTakenR: +avgTook.toFixed(2), finishedUnder1R: cut },
    { magnitude: power.length ? +((cut / power.length) * 100).toFixed(0) : 0,
      lede: LEDE_POWER,
      figures: [
        { value: `${power.length}`, label: `hit ${POWER_R}R inside ${POWER_DAYS} sessions` },
        { value: `${avgPeak.toFixed(1)}R`, label: "average best close" },
        { value: `${avgTook.toFixed(1)}R`, label: "average taken" },
      ],
      chart: {
        type: "bars", unit: "",
        rows: [
          { label: `Kept ${(POWER_R * 0.5).toFixed(1)}R or more`, value: kept },
          { label: "Finished at 1R or less", value: cut, worst: true },
        ],
        axisNote: `trades that reached ${POWER_R}R within ${POWER_DAYS} sessions`,
      },
      verdict: "In a breakout book these are the trades that pay for the losers, so what " +
               "happens to them matters more than what happens to the average one." });
}

/** Within this much of the stop is a near miss — a quarter of the distance
 *  the trade was allowed to travel against you, and close enough that a
 *  slightly worse day would have ended it. */
const NEAR_STOP_R = -0.75;

/**
 * How far the winners went against you before they worked.
 *
 * THE ONE THING THIS MUST NOT SAY IS "WIDEN YOUR STOP", and the temptation is
 * strong because the chart looks exactly like an argument for it. Widening
 * would have saved some of these AND let every loser run further, and this
 * data cannot see the second half at all: the journal reads bars from entry to
 * exit, so once a trade stopped out there is no record of what it did
 * afterwards. Half a ledger is not a case for changing a rule — the same
 * mistake the exit-method card was making, in a new place.
 *
 * WHAT IT CAN SAY IS HOW CLOSE-RUN THE RECORD IS. A book where a third of the
 * winners nearly stopped out is one where the same method, on the same trades,
 * could have printed a very different number. That is a fact about how settled
 * the expectancy is, it needs no counterfactual, and nothing else on the page
 * measures it.
 */
function adverseExcursion(closed) {
  const rows = measured(closed).filter((t) => isFinite(t.mae_r));
  const winners = rows.filter((t) => t.r > 0);
  if (winners.length < 12) return null;

  const maes = winners.map((t) => t.mae_r);
  const med = median(maes);
  const near = winners.filter((t) => t.mae_r <= NEAR_STOP_R);
  /* A daily CLOSE below the stop on a trade that still won means the stop was
     not in the market that evening — worth reporting as a fact, without any
     guess about whether it was a mental stop, a moved one, or one never
     placed. */
  const below = winners.filter((t) => t.mae_r <= -1);
  const nearPct = +((near.length / winners.length) * 100).toFixed(0);

  const chart = {
    type: "strip",
    unit: "R",
    threshold: -1,
    thresholdLabel: "your stop",
    worseIsLower: true,
    pastLabel: "closed below it and still won",
    leftLabel: "deeper against you",
    rightLabel: "never went against you · 0R",
    points: winners
      .map((t) => ({ v: +t.mae_r.toFixed(2), label: t.symbol, past: t.mae_r <= -1 }))
      .sort((a, b) => a.v - b.v),
    axisNote: "how far each winning trade closed against you before it turned",
  };

  const belowNote = below.length
    ? ` ${below.length} of them closed a day BELOW the stop and still finished as winners, which ` +
      `means the stop was not working in the market those evenings.`
    : "";

  if (nearPct >= 25) {
    return F("watch", "adverse-excursion",
      "A lot of your winners nearly stopped out first",
      `${near.length} of your ${winners.length} measured winners closed at ${Math.abs(NEAR_STOP_R)}R ` +
      `or worse against you at some point before turning — inside the last quarter of the distance ` +
      `to your stop. The typical winner went ${Math.abs(med).toFixed(2)}R against you first.` +
      belowNote +
      ` On the same method and the same trades, a slightly worse few days would have turned a good ` +
      `part of that win rate into losses.`,
      { measuredWinners: winners.length, medianAdverseR: +med.toFixed(2),
        withinQuarterOfStop: near.length, withinQuarterPct: nearPct,
        closedBelowStopAndWon: below.length },
      { magnitude: nearPct,
        lede: LEDE_ADVERSE,
        figures: [
          { value: `${near.length} of ${winners.length}`, label: `went past ${Math.abs(NEAR_STOP_R)}R against you first` },
          { value: `${String(med.toFixed(2)).replace("-", "−")}R`, label: "typical winner's worst close" },
        ],
        chart,
        verdict: "Not a case for a wider stop, and the chart should not be read as one. " +
                 "Widening would have saved some of these and let every loser run further, " +
                 "and that second half cannot be measured here — the journal reads prices " +
                 "from entry to exit, so once a trade stopped out there is no record of what " +
                 "it would have done next. What it does say is how close-run the record is, " +
                 "which is worth holding beside the expectancy figure." });
  }

  return F("good", "adverse-excursion",
    "Your winners tend to work quickly",
    `The typical winning trade closed no worse than ${Math.abs(med).toFixed(2)}R against you before ` +
    `it turned, and only ${near.length} of ${winners.length} got within a quarter of an R of the ` +
    `stop.` + belowNote + ` Entries that go green early are worth more than they look: the trade ` +
    `spends less time where a bad day can end it, and the win rate rests on less luck.`,
    { measuredWinners: winners.length, medianAdverseR: +med.toFixed(2),
      withinQuarterOfStop: near.length, withinQuarterPct: nearPct,
      closedBelowStopAndWon: below.length },
    { magnitude: nearPct,
      lede: LEDE_ADVERSE,
      figures: [
        { value: `${String(med.toFixed(2)).replace("-", "−")}R`, label: "typical winner's worst close" },
        { value: `${near.length}`, label: `got within ${Math.abs(NEAR_STOP_R)}R of the stop` },
      ],
      chart,
      verdict: "Nothing to fix. This is the quiet half of good timing — not how far the " +
               "winners run, but how little they have to survive first." });
}

/**
 * The one judgement, and it is the trader's own.
 *
 * `breakeven_ack_at` is them clicking "I have moved this stop to breakeven at
 * my broker" — migration 017, which touches nothing else. So a position that
 * was acked and then closed below entry, on a session that did NOT gap through
 * it, is the journal reporting a difference between what they said they had
 * done and where the trade finished. The app never asserts the stop should
 * have been moved; only that they said it was.
 *
 * A null gap reading is not a gap and not a drift — it is unknown, and unknown
 * is excluded. False is the value that accuses somebody.
 */
function acknowledgedStops(closed) {
  const rows = measured(closed).filter((t) => t.breakeven_ack_at);
  if (rows.length < 5) return null;

  const broke = rows.filter((t) => t.r < 0 && t.gapped_breakeven === false);
  const gapped = rows.filter((t) => t.r < 0 && t.gapped_breakeven === true);

  if (!broke.length) {
    return F("good", "acked-stops",
      "The stops you said you moved, held",
      `On ${rows.length} trades you marked the breakeven reminder as dealt with. None of them then ` +
      `closed below entry on a session where entry was there to be taken` +
      (gapped.length ? `; ${gapped.length} closed below it after a gap, which is not the same thing.` : `.`),
      { ackedTrades: rows.length, closedBelowAfterDrift: 0, closedBelowAfterGap: gapped.length },
      { lede: LEDE_ACK, magnitude: 0,
        figures: [{ value: `${rows.length}`, label: "stops marked moved" }, { value: "0", label: "closed below entry" }],
        verdict: "Nothing to change. This is the check with the least room for argument on " +
                 "the page, because the standard it measures against is the one you set." });
  }

  return F("watch", "acked-stops",
    "Some stops you marked moved still closed below entry",
    `${broke.length} of ${rows.length} trades where you marked the breakeven reminder as dealt with ` +
    `finished below entry anyway, on sessions that did not gap — the price traded through breakeven ` +
    `during the day and was there to be taken. That is a gap between what was recorded and what ` +
    `happened, and it is worth knowing which: a stop that was never actually moved reads the same ` +
    `here as one that was moved and then pulled.` +
    (gapped.length
      ? ` Separately, ${gapped.length} closed below entry after a gap, and those are not this — ` +
        `nothing could have been done about them.`
      : ""),
    { ackedTrades: rows.length, closedBelowAfterDrift: broke.length, closedBelowAfterGap: gapped.length },
    { magnitude: broke.length,
      lede: LEDE_ACK,
      figures: [
        { value: `${broke.length} of ${rows.length}`, label: "marked moved, closed below entry" },
        { value: `${gapped.length}`, label: "gapped instead — not counted" },
      ],
      verdict: "The reminder is only worth having if clicking it means the stop moved. If it " +
               "has become a way to clear the flag, that is worth knowing before any of the " +
               "risk figures on Holdings are trusted." });
}

/* ==================================================================== */
/*  Recency                                                             */
/* ==================================================================== */

/**
 * EVERY RATE ON THIS SCREEN WAS A LIFETIME RATE, AND A LIFETIME RATE BARELY
 * MOVES.
 *
 * The stop-discipline card proved the general case: a figure computed over
 * the whole book describes a trader's history, and a severity badge is a
 * claim about their present. On a long record the two come apart completely —
 * a habit dropped two years ago still reads as a current failing, and forty
 * consecutive clean trades will not shift the number enough to notice.
 *
 * WHY A WRAPPER AND NOT THIRTEEN REWRITES. Every check already takes a list
 * of trades and returns findings. Handing it a shorter list asks the same
 * question of a shorter period, exactly, with no new arithmetic and no chance
 * of the two windows disagreeing about what a rate means — which is what
 * rewriting each one by hand would have risked. It also means a check added
 * later gets recency by being listed here, rather than by remembering to
 * implement it again.
 *
 * THE LONGER WINDOW WINS TIES, DELIBERATELY. When both windows reach the same
 * severity, the lifetime card is shown, because nothing has changed and the
 * bigger sample is the better evidence. The recent card is only substituted
 * when the two DISAGREE — which is the whole and only signal being looked
 * for here.
 */

/** Below this the recent window cannot support a rate and the record stands. */
const MIN_RECENT = 25;
const SEV_RANK = { critical: 0, warning: 1, watch: 2, good: 3 };
const asArr = (x) => (!x ? [] : Array.isArray(x) ? x : [x]);

/**
 * The recent window: the last twelve months, or the last sixty closed trades,
 * whichever holds MORE.
 *
 * Calendar alone breaks on a quiet year — three trades is not a window. A
 * fixed count alone breaks on a busy one, where sixty trades is six weeks and
 * every seasonal habit reads as a trend. Taking the larger keeps an active
 * trader on a meaningful "this year" and still gives a slow one enough rows
 * to compute anything at all.
 */
export function recentBook(closed, { months = 12, min = 60 } = {}) {
  const seq = chron(closed);
  const cut = new Date();
  cut.setMonth(cut.getMonth() - months);
  const iso = cut.toISOString().slice(0, 10);
  const byDate = seq.filter((t) => String(t.exit_date || t.entry_date || "").slice(0, 10) >= iso);
  const byCount = seq.slice(-min);
  return byDate.length >= byCount.length ? byDate : byCount;
}

/**
 * Run one check over both windows and decide which card to show.
 *
 * Four outcomes, and the two that do nothing matter as much as the two that
 * act:
 *
 *   · Same severity — show the record. Nothing changed; use the bigger sample.
 *   · Different severity — show the recent card, with a line naming the
 *     record. It is one card from one window, so its headline, figures and
 *     chart cannot contradict each other.
 *   · The recent window found nothing — SHOW THE RECORD. A check returning
 *     null usually means it had too little to work with inside the window,
 *     which is not evidence that the problem went away, and treating it as
 *     such would quietly clear real findings on any trader who slowed down.
 *   · Only the recent window found something — show it, said as new.
 */
function overWindows(run, closed, recent) {
  const life = asArr(run(closed));
  if (recent.length < MIN_RECENT || recent.length >= closed.length) return life;

  const now = asArr(run(recent));
  /* Reconciling two SETS means guessing which finding replaced which, and the
     ids legitimately change between windows — `risk-inconsistent` becoming
     `risk-consistent` is the improvement, not a mismatch. So this only speaks
     when each window returned exactly one thing; anything richer keeps the
     record, unreconciled, rather than being paired up by inference. */
  if (life.length > 1 || now.length > 1) return life;

  const a = life[0], b = now[0];
  if (!b) return life;
  if (!a) {
    return [{ ...b, detail: `${b.detail} This shows up only in your recent trading — ` +
      `across all ${closed.length} closed trades there was nothing here to flag, so it is new.`,
      window: recent.length }];
  }
  /**
   * SOME CHECKS ONLY EVER EMIT ONE SEVERITY, AND SEVERITY ALONE WOULD SILENCE
   * THEM FOREVER.
   *
   * `data-gaps` is always a watch — it can go from four empty fields to one
   * and never change tier, so a trader who started recording their setups six
   * months ago would keep reading "120 of 120 have no RS rank" for years.
   * That is the exact staleness this whole mechanism exists to remove, hiding
   * behind a comparison too coarse to see it.
   *
   * So a check may expose a `magnitude` — how much of the thing there is —
   * and a third of it moving counts as a change even when the tier does not.
   * Checks that expose nothing behave exactly as before.
   */
  const ma = a.magnitude, mb = b.magnitude;
  const sameSeverity = SEV_RANK[a.severity] === SEV_RANK[b.severity];
  const magnitudeMoved = ma != null && mb != null && Math.abs(ma) > 0 &&
    Math.abs(mb - ma) / Math.abs(ma) >= 0.34;
  if (sameSeverity && !magnitudeMoved) return life;

  const better = sameSeverity
    ? mb < ma
    : SEV_RANK[b.severity] > SEV_RANK[a.severity];
  const note = better
    ? ` This is measured on your last ${recent.length} trades. Across all ${closed.length} it reads ` +
      `worse — that is the record and it still counts, it is just not what you are doing now.`
    : ` This is measured on your last ${recent.length} trades. Across all ${closed.length} it reads ` +
      `milder, so this is a recent change rather than a long-standing habit.`;

  return [{
    ...b,
    detail: b.detail + note,
    window: recent.length,
    evidence: { ...b.evidence, measuredOnLastNTrades: recent.length, ofClosedTrades: closed.length },
  }];
}

/* ==================================================================== */
/*  Assemble                                                            */
/* ==================================================================== */

/**
 * The one thing to say about the whole record, before any finding.
 *
 * DERIVED, NOT WRITTEN. A model was asked to do this once and the route was
 * removed — it cost an API call per view, had no authentication, and gave a
 * different answer to the same book twice. Every part of the sentence below is
 * arithmetic on the trades, so it is free, identical on every load, and can be
 * checked against the findings underneath it.
 *
 * TWO CLAUSES, BECAUSE THERE ARE TWO QUESTIONS. Does the method make money,
 * and what is most in the way of it making more. They are independent — a book
 * can have a real edge and a sizing problem at once, which is exactly the case
 * worth naming, and one sentence about "performance" would blur them into a
 * grade.
 *
 * SAYS SO WHEN IT DOES NOT KNOW. Under thirty closed trades nothing here
 * separates skill from sequence, and a confident sentence over a thin sample is
 * worse than no sentence: it is the one part of the screen somebody will quote
 * back to themselves.
 */
export function reviewThesis(closed, findings, stats) {
  const withR = closed.filter((t) => isFinite(t.r));
  if (withR.length < 12) return null;

  const exp = mean(withR.map((t) => t.r));
  const wins = withR.filter((t) => t.r > 0);
  const thin = withR.length < 30;

  /* The edge, in the only terms this app measures anything: R per trade. */
  const edge = !isFinite(exp) ? null
    : exp >= 0.3 ? { verb: "The edge is real", tone: "good" }
    : exp > 0.05 ? { verb: "The edge is thin but positive", tone: "ok" }
    : exp >= -0.05 ? { verb: "The edge is a coin flip", tone: "flat" }
    : { verb: "There is no edge here yet", tone: "bad" };

  /**
   * What is most in the way — the worst finding, named as a subject rather
   * than repeated as a headline. "Losses are running past the stop" is the
   * finding's own title; the thesis wants the noun, so the two do not read as
   * the same sentence twice.
   */
  const SUBJECTS = {
    "risk-escalation": "how much you are betting",
    "risk-inconsistent": "how much you are betting",
    "risk-outliers": "the occasional oversized bet",
    "stop-discipline": "where your losses actually end",
    "revenge-sizing": "what you do straight after a loss",
    "conviction-inverted": "which trades you back hardest",
    "exit-method": "the way you get out",
    "market-misaligned": "when you choose to trade",
    "thin-volume": "the entries you are taking",
    "return-concentration": "how few trades carry it",
    "charges-missing": "what these trades actually cost you",
    "round-trips": "what happens once a trade is in front",
    "power-trades": "what you do with the ones that run",
    "acked-stops": "whether the stops move when you say they have",
    "adverse-excursion": "how much your winners had to survive first",
    "revenge-cadence": "how soon you re-enter",
  };
  const worst = findings.find((f) => f.severity === "critical")
             || findings.find((f) => f.severity === "warning");
  const subject = worst ? SUBJECTS[worst.id] : null;

  return {
    thin,
    trades: withR.length,
    expectancy: +exp.toFixed(2),
    winRate: +((wins.length / withR.length) * 100).toFixed(0),
    edge: edge.verb,
    tone: edge.tone,
    /* Null when nothing is wrong, so the sentence stops rather than reaching
       for a problem it does not have. */
    subject: subject || null,
    subjectSeverity: worst?.severity || null,
  };
}

export function reviewFindings(
  closed,
  { regimes = null, stats = null, all = null, diary = null } = {}
) {
  const flat = [];
  const push = (x) => { if (!x) return; Array.isArray(x) ? flat.push(...x) : flat.push(x); };

  const recent = recentBook(closed);
  /* Each check asked the same question of the whole record and of the recent
     window — see overWindows. `stopDiscipline` is absent because it does its
     own, on the last twenty LOSSES rather than trades: stops are only tested
     by losing, and a quiet spell of winners would otherwise clear the card
     without a single stop having been honoured. */
  const both = (run) => push(overWindows(run, closed, recent));

  push(stopDiscipline(closed));
  both((c) => riskConsistency(c));
  both((c) => sizingReflexes(c));
  both((c) => entryQuality(c));
  both((c) => exitBehaviour(c));
  both((c) => marketAlignment(c, regimes));
  both((c) => tradingCadence(c));
  both((c) => dataQuality(c));
  both((c) => chargesRecorded(c));
  /* Same-trade comparisons, and the only ones on the page immune to the
     sorting problem that had to be taken out of the exit-method card. Silent
     until the bars have been read. */
  both((c) => captureRate(c));
  both((c) => roundTrips(c));
  both((c) => powerTrades(c));
  both((c) => adverseExcursion(c));
  both((c) => acknowledgedStops(c));
  /**
   * NOT WINDOWED, AND THAT IS THE POINT OF IT.
   *
   * Concentration asks how much of a total came from how few trades. Ask it
   * of a shorter window and it does not report a trend — it reports a
   * different, smaller sample, where a handful of trades is a larger share of
   * everything by arithmetic rather than by behaviour. It would find
   * "worsening concentration" in every book on earth.
   */
  push(returnConcentration(closed));
  /**
   * Written months ago in positions.js and never called by anything.
   *
   * It answers the question a breakout record most needs answered — whether
   * taking partials is protecting the account or clipping the winners that
   * fund it — and it answers it better than bucketing by tranche count would,
   * because it compares each scaled trade against the same position held
   * whole rather than against other trades that were never comparable.
   */
  both((c) => scaleOutFinding(c));
  both((c) => emotionOutcomes(c, diary));
  /* Also not windowed: a duplicate is a standing state, not a rate. Two rows
     for one position stay two rows until somebody merges them, and they go on
     blocking every future import in the meantime — "you have not done this
     lately" would be no comfort at all. */
  push(duplicatePositions(all || closed));

  // Substitute the real max drawdown into any template placeholder
  if (stats?.maxDD != null) {
    for (const f of flat) {
      f.detail = f.detail.replace("{maxDD}", stats.maxDD.toFixed(1));
    }
  }

  const rank = { critical: 0, warning: 1, watch: 2, good: 3 };
  flat.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return {
    findings: flat,
    counts: {
      critical: flat.filter((f) => f.severity === "critical").length,
      warning: flat.filter((f) => f.severity === "warning").length,
      watch: flat.filter((f) => f.severity === "watch").length,
      good: flat.filter((f) => f.severity === "good").length,
    },
    sample: closed.length,
    /** Below this, treat everything as provisional. */
    provisional: closed.length < 30,
  };
}
