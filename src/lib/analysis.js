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
  "Your winning trades, grouped by how you got out of them. Same trader, same " +
  "setups — the only thing that differs is the way the position was closed.";
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

  const ev = {
    losers: losers.length,
    medianLossR: +med.toFixed(2),
    beyondStopCount: overruns.length,
    beyondStopPct: +overrunRate.toFixed(0),
    worstLossR: +Math.min(...rs).toFixed(2),
    avgOverrunR: overruns.length ? +mean(overruns.map((t) => t.r)).toFixed(2) : null,
    taggedIgnoredStop: losers.filter((t) => (t.mistakes || []).includes("Ignored the stop")).length,
  };

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

  if (overrunRate >= 30 || bad.length >= 3) {
    return F("critical", "stop-discipline",
      "Losses are running past the stop",
      `Those ${overruns.length} averaged ${ev.avgOverrunR}R, against a design that says a loss should cost 1R. ` +
      // Only when there are any. "the 0 you tagged ... are the ones that were"
      // is not a sentence, and it appeared on the first real account this ran on.
      (ev.taggedIgnoredStop > 0
        ? `Some of this will be gap-downs rather than hesitation — the ${ev.taggedIgnoredStop} you tagged ` +
          `"Ignored the stop" are the ones that were.`
        : `Some of this will be gap-downs rather than hesitation. Tagging the ones that were ` +
          `"Ignored the stop" is what tells the two apart.`),
      ev,
      { lede,
        figures: figs,
        chart,
        verdict: "Your 1R is not the number you think it is. Expectancy and position " +
                 "size are both worked out from it, so both are currently overstating " +
                 "how well this is going." });
  }
  if (overrunRate >= 15) {
    return F("warning", "stop-discipline",
      "Some losses drifting past the stop",
      `Not yet structural — but this is the failure mode that widens the average loss without ` +
      `ever announcing itself, because no single trade looks bad enough to notice.`,
      ev,
      { lede,
        figures: figs,
        chart,
        verdict: "Worth watching rather than fixing. If this share climbs past a third, " +
                 "every R figure in the journal starts to drift." });
  }
  return F("good", "stop-discipline",
    "Stops are being honoured",
    `A typical loss costs about what it was meant to, and only ${overruns.length} went beyond it.`,
    ev,
    { lede,
      figures: figs,
      chart,
      verdict: "Your 1R is real — which is what lets every other number on this screen " +
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
  const riskChart = {
    type: "series",
    unit: "%",
    points: risks.map((v) => +v.toFixed(3)),
    axisNote: `${rows.length} trades, oldest first`,
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
  const per = Math.floor(bySize.length / k);
  const buckets = Array.from({ length: k }, (_, i) => {
    const slice = i === k - 1 ? bySize.slice(i * per) : bySize.slice(i * per, (i + 1) * per);
    const lo = slice[0].riskPct, hi = slice[slice.length - 1].riskPct;
    return {
      lo, hi,
      range: lo.toFixed(2) === hi.toFixed(2) ? `${lo.toFixed(2)}%` : `${lo.toFixed(2)}–${hi.toFixed(2)}%`,
      value: +mean(slice.map((t) => t.r)).toFixed(2),
      n: slice.length,
    };
  });
  /**
   * Rank labels when the ranges collide.
   *
   * Somebody who sizes consistently puts most trades at the same risk, so the
   * buckets come back as "0.50%", "0.50%", "0.50%" — three rows that look
   * identical and make the chart read as broken. The rank is what actually
   * separates them, and the range only helps when the ranges differ.
   */
  const RANKS = k === 5
    ? ["Smallest", "2nd", "Middle", "4th", "Largest"]
    : ["Smallest", "Middle", "Largest"];
  const distinct = new Set(buckets.map((b) => b.range)).size === k;
  const sizeChart = {
    type: "bars",
    unit: "R",
    rows: buckets.map((b, i) => ({
      label: distinct ? b.range : RANKS[i],
      value: b.value,
      n: b.n,
    })),
    axisNote: distinct
      ? "risk per trade, smallest to largest"
      : `by size, smallest to largest · ${buckets[0].lo.toFixed(2)}–${buckets[k - 1].hi.toFixed(2)}% risk`,
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

function exitBehaviour(closed) {
  const winners = closed.filter((t) => isFinite(t.r) && t.r > 0 && t.exit_reason);
  if (winners.length < 10) return null;

  const groups = new Map();
  for (const t of winners) {
    if (!groups.has(t.exit_reason)) groups.set(t.exit_reason, []);
    groups.get(t.exit_reason).push(t.r);
  }
  const rows = [...groups.entries()]
    .filter(([, v]) => v.length >= 4)
    .map(([k, v]) => ({ reason: k, n: v.length, avgR: +mean(v).toFixed(2) }))
    .sort((a, b) => b.avgR - a.avgR);

  if (rows.length < 2) return null;

  const best = rows[0], worst = rows[rows.length - 1];
  const ev = { byReason: rows, spread: +(best.avgR - worst.avgR).toFixed(2) };

  const minus = (v) => String(v).replace("-", "\u2212");
  const figs = [
    { value: `${minus(ev.spread)}R`, label: "between best and worst" },
  ];

  /** One bar per way out. The gap between the longest and the shortest IS the
   *  finding, and a bar chart states it without anybody doing subtraction. */
  const chart = {
    type: "bars",
    unit: "R",
    rows: rows.map((d) => ({
      label: d.reason, value: d.avgR, n: d.n,
      best: d.reason === best.reason, worst: d.reason === worst.reason,
    })),
  };

  if (best.avgR - worst.avgR >= 1) {
    return F("warning", "exit-method",
      `Exiting on "${worst.reason}" leaves money behind`,
      `The gap is the exit method alone — it is not that one group held better trades, since both ` +
      `are drawn from the same winners. In a breakout system the big winners pay for every loser, ` +
      `so anything that caps them changes the arithmetic of the whole approach rather than trimming it.`,
      ev,
      { lede: LEDE_EXITS,
        figures: figs,
        chart,
        verdict: `Every winner you close on "${worst.reason}" instead gives up about ` +
                 `${ev.spread}R. That is the single cheapest thing on this page to change: ` +
                 `it asks nothing of your entries.` });
  }
  return F("good", "exit-method", "Exit methods are broadly consistent",
    `No single way of getting out is quietly costing you — the spread across your exit reasons is ` +
    `small enough to be noise rather than a habit.`,
    ev,
    { lede: LEDE_EXITS,
      figures: figs,
      chart,
      verdict: "Nothing to fix here. Worth re-reading once you have more exits on the " +
               "board, since this is the kind of gap that opens slowly." });
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
  const ev = { byRegime: byReg, indexDays: dayCounts };

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
      .map((k) => ({
        label: REGIME_WORDS[k], value: byReg[k].expectancy, n: byReg[k].trades,
      })),
    axisNote: "average return per trade, by what the index was doing",
  };
  const out = [];

  // The core question: is activity following the market's lead?
  const upRate = up.tradesPer100Days, corrRate = corr.tradesPer100Days;
  if (upRate != null && corrRate != null && corr.trades >= 5) {
    ev.activityRatio = +(upRate / corrRate).toFixed(2);

    if (corrRate > upRate) {
      out.push(F("critical", "market-misaligned",
        "You trade more when the market is against you",
        `That is backwards for a long-only breakout system. Breakouts fail at a much higher rate when the ` +
        `index is below its 50-day and the 50 is below the 200, because there is no institutional bid to ` +
        `carry them — and your own record shows it.`,
        ev,
        { lede: LEDE_REGIME,
          figures: [
            { value: `${corrRate}`, label: "trades per 100 days in corrections" },
            { value: `${upRate}`, label: "per 100 days in uptrends" },
          ],
          chart: regimeChart,
          verdict: "The fix is not better stock selection. It is fewer trades in the wrong " +
                   "regime — the same setups, taken less often when the index is against them." }));
    } else if (upRate < corrRate * 1.5 && corr.trades >= 8) {
      out.push(F("warning", "market-underweight",
        "Activity barely responds to market direction",
        `You trade at roughly the same pace whatever the index is doing, while what those trades return ` +
        `differs sharply by regime. The conditions clearly matter; the activity does not reflect it.`,
        ev,
        { lede: LEDE_REGIME,
          figures: [
            { value: `${upRate}`, label: "per 100 days in uptrends" },
            { value: `${corrRate}`, label: "per 100 days in corrections" },
          ],
          chart: regimeChart,
          verdict: "Pressing harder in uptrends and easing off in corrections is the single " +
                   "highest-leverage change available here — it changes nothing about the setups." }));
    } else {
      out.push(F("good", "market-aligned",
        "Your activity follows the market",
        `You press when conditions support it and step back when they do not. That discipline is worth ` +
        `more than any individual setup refinement.`,
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

function dataQuality(closed) {
  if (closed.length < 10) return null;
  const pc = (f) => +((closed.filter(f).length / closed.length) * 100).toFixed(0);
  const ev = {
    trades: closed.length,
    pivotPct: pc((t) => isFinite(n(t.pivot_price))),
    volumePct: pc((t) => isFinite(n(t.vol_pct_avg))),
    patternPct: pc((t) => !!t.pattern),
    exitReasonPct: pc((t) => !!t.exit_reason),
    chargesPct: pc((t) => n(t.charges) > 0),
  };
  const gaps = Object.entries(ev).filter(([k, v]) => k !== "trades" && v < 60);
  if (!gaps.length) return null;

  const names = { pivotPct: "pivot price", volumePct: "breakout volume",
                  patternPct: "base pattern", exitReasonPct: "exit reason", chargesPct: "charges" };

  return F("watch", "data-gaps",
    "Some fields are mostly empty",
    `The setup breakdowns can only compare what is recorded. A blank does not count against a pattern — ` +
    `it makes that pattern invisible, so the cut goes on working and quietly stops meaning anything. ` +
    `Charges missing is the one that flatters: net P&L and XIRR both read better than reality.`,
    ev,
    { lede: LEDE_GAPS,
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

  const groups = [...by.values()].filter((g) => g.length > 1);
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
    positions: groups.slice(0, 20).map((g) => ({
      symbol: g[0].symbol,
      entry_date: g[0].entry_date,
      count: g.length,
      trades: g.map((t) => ({
        id: t.id,
        quantity: Number(t.quantity),
        entry_price: Number(t.entry_price),
        status: t.status,
        source: t.imported ? "imported" : "entered by hand",
      })),
    })),
  };

  const parts = [];
  if (split) {
    parts.push(
      `${split} sell on entirely different dates, so nothing has been counted twice — that is one ` +
      `position scaled out over time, arriving through two files that each saw only their own ` +
      `financial year. The money is right; the position is split, so each half carries its own R ` +
      `against a fraction of the risk you actually took.`
    );
  }
  if (overlapping) {
    parts.push(
      `${overlapping} share a sell date across both rows, which can mean the same exit was recorded ` +
      `twice. Worth opening ${overlapping === 1 ? "that one" : "those"} before anything else — if it ` +
      `is a genuine double, your P&L is overstated by it.`
    );
  }

  return F("watch", "duplicate-positions",
    "One position recorded as two trades",
    `${groups.length} symbol-and-date pair${groups.length === 1 ? "" : "s"} open more than once — ` +
    `${trades} trades between them. ${parts.join(" ")} ` +
    `Either way an import can't tell which of the pair a later sell belongs to, so it holds those ` +
    `rows back instead of guessing, and will keep doing that on every future file until they are merged.`,
    ev);
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

  push(stopDiscipline(closed));
  push(riskConsistency(closed));
  push(sizingReflexes(closed));
  push(entryQuality(closed));
  push(exitBehaviour(closed));
  push(marketAlignment(closed, regimes));
  push(tradingCadence(closed));
  push(dataQuality(closed));
  push(returnConcentration(closed));
  push(emotionOutcomes(closed, diary));
  // Every trade, not just the closed ones — see the note on the check.
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
