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

const F = (severity, id, title, detail, evidence) =>
  ({ id, severity, title, detail, evidence });

/* ==================================================================== */
/*  1. Stop-loss discipline                                             */
/* ==================================================================== */

function stopDiscipline(closed) {
  const losers = closed.filter((t) => isFinite(t.r) && t.r <= 0);
  if (losers.length < 8) return null;

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

  if (overrunRate >= 30 || bad.length >= 3) {
    return F("critical", "stop-discipline",
      "Losses are running past the stop",
      `${overruns.length} of ${losers.length} losing trades (${ev.beyondStopPct}%) closed worse than −1.15R, ` +
      `averaging ${ev.avgOverrunR}R. Median loss is ${ev.medianLossR}R against a −1.00R design. ` +
      `Every metric in this journal assumes 1R is your real maximum loss — when it isn't, ` +
      `expectancy and position sizing are both built on a number that doesn't hold. ` +
      `Some of this may be gap-downs rather than hesitation; the trades tagged "Ignored the stop" (${ev.taggedIgnoredStop}) are the ones that were.`,
      ev);
  }
  if (overrunRate >= 15) {
    return F("warning", "stop-discipline",
      "Some losses drifting past the stop",
      `${overruns.length} of ${losers.length} losses closed beyond −1.15R (median ${ev.medianLossR}R). ` +
      `Not yet structural, but worth watching — this is the failure mode that quietly widens your average loss.`,
      ev);
  }
  return F("good", "stop-discipline",
    "Stops are being honoured",
    `Median loss is ${ev.medianLossR}R across ${losers.length} losing trades, with ${overruns.length} beyond −1.15R. ` +
    `Your 1R is real, which means everything else measured here can be trusted.`,
    ev);
}

/* ==================================================================== */
/*  2. Risk-per-trade consistency                                       */
/* ==================================================================== */

function riskConsistency(closed) {
  const rows = chron(closed).filter((t) => isFinite(t.riskPct) && t.riskPct > 0);
  if (rows.length < 12) return null;

  const risks = rows.map((t) => t.riskPct);
  const m = mean(risks), s = sd(risks);
  const cv = s / m;
  const sl = slope(risks);
  const drift = (sl * rows.length) / m * 100;   // % change implied across the sample

  const firstQ = risks.slice(0, Math.max(4, Math.floor(rows.length / 4)));
  const lastQ = risks.slice(-Math.max(4, Math.floor(rows.length / 4)));
  const change = ((mean(lastQ) - mean(firstQ)) / mean(firstQ)) * 100;

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
  };

  if (change > 40 && ev.lastQuarterAvg > ev.firstQuarterAvg) {
    return F("critical", "risk-escalation",
      "Risk per trade is climbing",
      `Your average risk went from ${ev.firstQuarterAvg}% in the first quarter of these trades to ` +
      `${ev.lastQuarterAvg}% in the most recent — up ${ev.changePct}%. ` +
      `Position size scales both your return and your drawdown by exactly the same factor, so this has ` +
      `silently changed the drawdown you're exposed to without changing anything about the edge. ` +
      `If your worst historical run is ${"{maxDD}"}R, at ${ev.lastQuarterAvg}% that run now costs you a different account.`,
      ev);
  }
  if (cv > 0.5) {
    return F("warning", "risk-inconsistent",
      "Position sizing is erratic",
      `Risk per trade ranges from ${ev.minRiskPct}% to ${ev.maxRiskPct}% (average ${ev.avgRiskPct}%, ` +
      `variation coefficient ${ev.coeffVariation}). Inconsistent sizing means your biggest positions ` +
      `dominate the results — so your P&L reflects which trades you felt strongest about, not whether the system works. ` +
      `That makes the expectancy figure much less meaningful than it looks.`,
      ev);
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
      `Trades taken straight after a loss risk ${ev.avgRiskAfterLoss}% on average, against ${ev.avgRiskAfterWin}% ` +
      `after a win — ${ev.differencePct}% larger. The market has no memory of your last trade, so there's no ` +
      `edge reason for this. It's the mechanism that turns an ordinary losing streak into a serious drawdown.`,
      ev));
  }

  if (isFinite(corr) && corr < -0.2) {
    out.push(F("warning", "conviction-inverted",
      "Your biggest positions are your worst trades",
      `Correlation between position size and outcome is ${ev.sizeOutcomeCorrelation} — negative, meaning the ` +
      `trades you sized up on have performed worse than the ones you sized down on. ` +
      `Whatever is driving your conviction is not predicting outcomes. Flat sizing would have produced a better result than your judgement did.`,
      ev));
  } else if (isFinite(corr) && corr > 0.25) {
    out.push(F("good", "conviction-works",
      "Your conviction is informative",
      `Size and outcome correlate at ${ev.sizeOutcomeCorrelation}. The trades you back harder do perform better — ` +
      `rare, and worth preserving. Just keep the upper bound fixed.`,
      ev));
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
        out.push(F(eFar < 0 ? "critical" : "warning", "chasing",
          "Extended entries are costing you",
          `Entries within 3% of the pivot return ${ev.nearPivotExpectancy}R on average. Entries more than 5% ` +
          `above it return ${ev.extendedExpectancy}R — a gap of ${ev.gap}R per trade across ${far.length} extended trades. ` +
          `Buying extended also forces a wider stop, so the same rupee risk buys you fewer shares and a lower ` +
          `probability of surviving normal noise. This is the most fixable item on the list: it's a rule, not a skill.`,
          ev));
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
        out.push(F("warning", "thin-volume",
          "Low-volume breakouts are underperforming",
          `Breakouts on under 120% of average volume return ${ev.thinExpectancy}R across ${thin.length} trades, ` +
          `against ${ev.heavyExpectancy}R on 150%+ volume. Volume is the confirmation that institutions are ` +
          `behind the move — without it you're buying a price level, not a signal.`,
          ev));
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

  if (best.avgR - worst.avgR >= 1) {
    return F("warning", "exit-method",
      `Exiting on "${worst.reason}" leaves money behind`,
      `Winners closed via "${best.reason}" average ${best.avgR}R over ${best.n} trades. Winners closed via ` +
      `"${worst.reason}" average ${worst.avgR}R over ${worst.n}. That's ${ev.spread}R per trade of difference ` +
      `attributable to the exit method alone, not to trade selection. ` +
      `In a breakout system the large winners pay for everything else — capping them changes the arithmetic of the whole approach.`,
      ev);
  }
  return F("good", "exit-method", "Exit methods are broadly consistent",
    `Average winner ranges from ${worst.avgR}R to ${best.avgR}R across your exit reasons — no single method is bleeding returns.`,
    ev);
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
  const out = [];

  // The core question: is activity following the market's lead?
  const upRate = up.tradesPer100Days, corrRate = corr.tradesPer100Days;
  if (upRate != null && corrRate != null && corr.trades >= 5) {
    ev.activityRatio = +(upRate / corrRate).toFixed(2);

    if (corrRate > upRate) {
      out.push(F("critical", "market-misaligned",
        "You trade more when the market is against you",
        `In corrections you took ${corrRate} trades per 100 trading days. In confirmed uptrends, only ${upRate}. ` +
        `That's backwards for a long-only breakout system — breakouts fail at a much higher rate when the index is ` +
        `below its 50-day and the 50 is below the 200, because there's no institutional bid to carry them. ` +
        `Your own numbers show it: ${up.expectancy}R expectancy in uptrends against ${corr.expectancy}R in corrections. ` +
        `The fix isn't better stock selection, it's fewer trades in the wrong regime.`,
        ev));
    } else if (upRate < corrRate * 1.5 && corr.trades >= 8) {
      out.push(F("warning", "market-underweight",
        "Activity barely responds to market direction",
        `${upRate} trades per 100 days in uptrends versus ${corrRate} in corrections — you're trading at roughly ` +
        `the same pace regardless of conditions. Your expectancy differs sharply by regime ` +
        `(${up.expectancy}R vs ${corr.expectancy}R), so the conditions clearly matter even if your activity doesn't reflect it. ` +
        `Pressing harder in uptrends and easing off in corrections is the single highest-leverage change available to you.`,
        ev));
    } else {
      out.push(F("good", "market-aligned",
        "Your activity follows the market",
        `${upRate} trades per 100 days in uptrends against ${corrRate} in corrections — you press when conditions ` +
        `support it and step back when they don't. That discipline is worth more than any individual setup refinement.`,
        ev));
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
      `Median gap to the next entry is ${ev.medianDaysAfterLoss} days after a loss, against ` +
      `${ev.medianDaysAfterWin} days after a win. Quick re-entry after a loss is rarely a setup arriving — ` +
      `it's usually the urge to get it back. Worth pairing with your diary entries to see what you were feeling.`,
      ev);
  }
  return null;
}

/* ==================================================================== */
/*  8. Data completeness — can't analyse what isn't recorded            */
/* ==================================================================== */

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
    `${gaps.map(([k, v]) => `${names[k]} on ${v}% of trades`).join(", ")}. ` +
    `The setup breakdowns can only compare what's recorded — a blank field doesn't count against a pattern, ` +
    `it just makes that pattern invisible. Charges missing means your net P&L and XIRR read better than reality.`,
    ev);
}

/* ==================================================================== */
/*  Assemble                                                            */
/* ==================================================================== */

export function reviewFindings(closed, { regimes = null, stats = null } = {}) {
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
