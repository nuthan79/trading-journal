import { scaleOutEffect } from "./positions";
import { hasRealStop } from "./stops";

/**
 * The trading process as stages, and which one is leaking.
 *
 * WHY THIS EXISTS. Review computes fourteen findings and sorts them by
 * severity, which answers "what is worst" and not "where in my process does it
 * go wrong". Those are different questions: a stop problem and a sizing
 * problem read as two unrelated items on a list, when they are two stages of
 * one pipeline and only one of them is the bottleneck. Nothing new is measured
 * here — the findings are the detail underneath each stage — but they are
 * grouped by the decision that produced them and, where it is honest to do so,
 * costed.
 *
 * THE RULE ABOUT COUNTERFACTUALS, WHICH IS THE WHOLE INTEGRITY OF THE SCREEN.
 * A stage is given a number only when the comparison is against something the
 * trader actually decided, not against a better trader:
 *
 *   · The stop was your line. A loss past it is arithmetic, and the overrun is
 *     money the plan said you would not lose.
 *   · Your typical position size was your decision. Re-running the same trades
 *     at that size assumes nothing about which trades you would have taken.
 *   · A scaled exit has a defined baseline — the same position held whole to
 *     your own final exit price.
 *
 * Everything else gets a state and no number. "You would have made more
 * trading a different regime" assumes you could have found the same setups
 * somewhere else, and a screen that prints that figure beside two real ones
 * teaches the reader to trust all three equally. Which stages are costed is
 * therefore a permanent property of this file, not a limitation to be fixed
 * later by estimating harder.
 *
 * AND IT CANNOT BE RECOMPUTED WEEKLY. A handful of closed trades cannot move
 * an expectancy or reorder a ranking; a page that redrew itself every Sunday
 * would be showing noise and calling it progress. So the ranking runs on the
 * whole book and changes slowly, and `recentCompliance` answers the separate,
 * honest weekly question — not "has my edge changed" but "did I follow my own
 * rules on the trades I just closed", which is a fact about three trades
 * rather than a statistic about three trades.
 */

/** Below this a stage is reported but marked provisional rather than ranked
 *  with confidence. Matches THIN_SLICE in edge.js in spirit: enough to notice,
 *  not enough to act on. */
const THIN_STAGE = 20;

/**
 * Below this there is no baseline worth comparing a sample against — an
 * "average ten" drawn from twenty trades is two samples, not a norm.
 */
const BASELINE_MIN = 30;

/** The same line stopDiscipline draws. Two checks disagreeing about what
 *  counts as a stop overrun is how one screen contradicts another. */
const OVERRUN_R = -1.15;

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Stages in the order the decisions happen, not in the order they matter.
 *
 * The sequence is the point: it is what turns a list into a process, and it is
 * what lets a reader see that a sizing problem sits downstream of a selection
 * problem and will not be fixed by better selection. The ranking reorders
 * these by cost; the `step` number keeps the original sequence visible.
 */
const STAGES = [
  {
    key: "selection", step: 1, name: "Selection",
    blurb: "What you choose to buy",
    /* No finding in analysis.js measures this — the setup breakdowns live on
       the Edge screen and need pattern, RS rank and stage, which is exactly
       the data most journals do not carry. It is listed anyway: a stage that
       cannot be seen is a more useful thing to show than a stage omitted. */
    findings: [],
    fields: ["pattern", "rs_rank", "weinstein_stage"],
  },
  {
    key: "timing", step: 2, name: "Timing",
    blurb: "When you buy, and into what market",
    findings: ["market-misaligned", "market-contrarian", "market-aligned",
               "market-underweight", "correction-drag", "thin-volume"],
    fields: ["vol_pct_avg", "pivot_price"],
  },
  {
    key: "sizing", step: 3, name: "Sizing",
    blurb: "How much you put on each one",
    findings: ["risk-escalation", "risk-inconsistent", "risk-outliers",
               "risk-consistent", "revenge-sizing", "conviction-inverted",
               "conviction-works"],
    fields: [],
  },
  {
    key: "risk-control", step: 4, name: "Risk control",
    blurb: "Where your losses actually end",
    findings: ["stop-discipline", "stop-discipline-unknown",
               /* Both are about the stop rather than the exit: one asks how
                  much room the trades that worked needed before they worked,
                  the other whether the stop moved when it was said to have. */
               "adverse-excursion", "acked-stops"],
    fields: [],
  },
  {
    key: "exit", step: 5, name: "Exit",
    blurb: "How you get out of the ones that work",
    findings: ["exit-method", "scale-out-costly", "scale-out-good",
               "scale-out-neutral",
               /**
                * The three path findings, which is what this stage was short
                * of. Until the bars were read the only evidence here was the
                * exit-reason comparison — since demoted to a watch, because
                * it sorts trades by what they did rather than by how they
                * were closed — and the scale-out check, which needs tranches.
                * A book with neither left the stage saying nothing.
                *
                * They do NOT feed the cost column, deliberately. What a trade
                * reached is not a baseline anybody set: nobody decided to
                * sell the exact high, so "gave back 27.9R from the peak" is
                * not R lost against a plan the way an overrun stop or an
                * oversized position is. The rule for that column is the
                * trader's own baseline or no number at all.
                */
               "capture-rate", "round-trips", "power-trades"],
    fields: ["exit_reason"],
  },
  {
    key: "cadence", step: 6, name: "Cadence",
    blurb: "How soon you go again",
    findings: ["revenge-cadence"],
    fields: [],
  },
];

const RANK = { critical: 0, warning: 1, watch: 2, good: 3 };

/* ==================================================================== */
/*  The three stages that can be costed                                 */
/* ==================================================================== */

/**
 * Money lost past your own stop.
 *
 * Assumed stops are excluded for the reason stopDiscipline excludes them: an
 * overrun measured against a line the importer drew accuses the trader of
 * indiscipline over a number they never chose.
 */
function riskControlCost(closed) {
  const measured = closed.filter(
    (t) => hasRealStop(t) && Number.isFinite(t.r)
  );
  const losers = measured.filter((t) => t.r <= 0);
  if (losers.length < 8) return { sample: losers.length, costR: null, costRupees: null };

  const over = losers.filter((t) => t.r < OVERRUN_R);
  /* Past 1R, in R and in rupees. Not the whole loss — the loss up to the stop
     is the cost of doing business and was budgeted for. */
  const costR = -sum(over.map((t) => Math.abs(t.r) - 1));
  const costRupees = -sum(
    over.map((t) => (Number.isFinite(t.riskAmt) ? (Math.abs(t.r) - 1) * t.riskAmt : 0))
  );
  return {
    sample: losers.length,
    costR: +costR.toFixed(1),
    costRupees: Math.round(costRupees),
    detail: { overruns: over.length, losers: losers.length },
  };
}

/**
 * What varying the position size cost, against your own typical size.
 *
 * MEASURED IN PERCENT, NOT RUPEES, AND THAT IS THE WHOLE TRICK. Rupee risk
 * climbs as an account grows, and sizing up as you grow is correct — costing
 * it against a fixed rupee figure would score compounding as a mistake and
 * put "sizing" at the top of every profitable trader's list. Comparing each
 * trade against your typical PERCENT of the account is scale-free: it asks
 * only whether you put more of the account on the trades that worked, which
 * is the actual question.
 *
 * Negative means the bigger bets did worse.
 */
function sizingCost(closed) {
  const sized = closed.filter(
    (t) => Number.isFinite(t.r) && hasRealStop(t) &&
           num(t.riskPct) > 0 && num(t.riskAmt) > 0
  );
  if (sized.length < 12) return { sample: sized.length, costR: null, costRupees: null };

  const typical = median(sized.map((t) => t.riskPct));
  if (!typical) return { sample: sized.length, costR: null, costRupees: null };

  /* Each trade's rupee outcome, against the same trade at your typical
     percent of the same account. riskAmt × (typical / riskPct) is what you
     would have had at risk that day had you sized normally. */
  const actual = sum(sized.map((t) => t.r * t.riskAmt));
  const flat = sum(sized.map((t) => t.r * t.riskAmt * (typical / t.riskPct)));
  const costRupees = actual - flat;

  /* Expressed in R at that typical size, so it can be ranked beside the
     other two. */
  const unit = median(sized.map((t) => t.riskAmt * (typical / t.riskPct)));
  return {
    sample: sized.length,
    costR: unit ? +(costRupees / unit).toFixed(1) : null,
    costRupees: Math.round(costRupees),
    detail: { typicalRiskPct: +typical.toFixed(2) },
  };
}

/** What taking partials did, against holding the same position whole to your
 *  own final exit. scaleOutEffect already computes it; this only puts a rupee
 *  figure beside the R and returns null when there is nothing scaled. */
function exitCost(closed) {
  const s = scaleOutEffect(closed);
  if (!s) return { sample: 0, costR: null, costRupees: null };
  const byId = new Map(closed.map((t) => [t.id, t]));
  const costRupees = sum(
    s.rows.map((x) => {
      const t = byId.get(x.id);
      return t && Number.isFinite(t.riskAmt) ? x.diff * t.riskAmt : 0;
    })
  );
  return {
    sample: s.trades,
    costR: s.totalDiffR,
    costRupees: Math.round(costRupees),
    detail: { helped: s.helped, hurt: s.hurt },
  };
}

const COSTERS = {
  "risk-control": riskControlCost,
  sizing: sizingCost,
  exit: exitCost,
};

/**
 * How many recent trades decide whether a stage is leaking NOW.
 *
 * Every cost above is a sum over the book, and a sum only grows. Left that
 * way the ranking drifts toward whichever stage has the longest history
 * rather than the one currently hurting: a trader who fixed their sizing two
 * years ago carries the full historical leak forever, and the bar can never
 * shorten. The same defect that kept the stop-discipline card permanently
 * critical, in a different place — see the note in stopDiscipline.
 *
 * Sixty is chosen to clear the minimum samples the three costers need (eight
 * losses, twelve sized trades, six scaled ones) on a book that trades at any
 * reasonable pace. Below that the window returns nothing and the lifetime
 * figure governs, which is stated rather than hidden.
 */
const RECENT_TRADES = 60;

const chron = (rows) =>
  [...rows].sort((a, b) =>
    new Date(a.exit_date || a.entry_date) - new Date(b.exit_date || b.entry_date));

/**
 * Lifetime and recent side by side, with the recent one governing.
 *
 * Both are kept because they answer different questions and the difference
 * between them is the most useful thing on the row. "−48R, of −137R all time"
 * says the leak is real and shrinking; one number alone says neither.
 */
function costFor(key, closed, recent) {
  const coster = COSTERS[key];
  if (!coster) return { costR: null, costRupees: null, sample: null, basis: null };

  const life = coster(closed);
  const now = recent.length >= 20 ? coster(recent) : null;
  const useRecent = now && now.costR != null;

  /* Per trade, because the two windows hold different numbers of trades and
     comparing two sums would call every shortened window an improvement. */
  const rate = (c) => (c && c.costR != null && c.sample ? c.costR / c.sample : null);
  const rNow = rate(now), rLife = rate(life);
  const trend =
    rNow == null || rLife == null || Math.abs(rLife) < 0.005 ? null
    : rNow > rLife * 0.75 ? "improving"
    : rNow < rLife * 1.25 ? "worsening"
    : null;

  /* toFixed can hand back −0, which renders as "−0R" — a minus sign on a
     stage that is not leaking at all. */
  const z = (v) => (v == null ? null : Object.is(v, -0) || v === 0 ? 0 : v);

  return {
    costR: z(useRecent ? now.costR : life.costR),
    costRupees: z(useRecent ? now.costRupees : life.costRupees),
    sample: useRecent ? now.sample : life.sample,
    detail: useRecent ? now.detail : life.detail,
    basis: useRecent ? "recent" : "lifetime",
    window: useRecent ? recent.length : null,
    lifetimeCostR: z(life.costR),
    lifetimeCostRupees: z(life.costRupees),
    /* Only worth printing when the two actually differ — on a book shorter
       than the window they are the same number twice. */
    trend: useRecent && life.costR != null && Math.abs(life.costR - now.costR) > 0.5
      ? trend : null,
  };
}

/* ==================================================================== */
/*  The ranking                                                         */
/* ==================================================================== */

/**
 * @param closed   trades already through derivePosition (r, riskPct, riskAmt)
 * @param findings the output of reviewFindings, so nothing is measured twice
 */
export function processStages(closed = [], findings = []) {
  if (!Array.isArray(closed) || closed.length < 10) return null;

  const byId = new Map();
  for (const f of findings) if (f?.id) byId.set(f.id, f);

  const recent = chron(closed).slice(-RECENT_TRADES);

  const rows = STAGES.map((st) => {
    const found = st.findings.map((id) => byId.get(id)).filter(Boolean);
    const worst = found.slice().sort(
      (a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9)
    )[0] || null;

    const cost = costFor(st.key, closed, recent);

    /**
     * How much of the stage is visible at all.
     *
     * A stage whose fields are blank is not passing — it is dark, and those
     * are different enough that calling both "fine" would be the single most
     * misleading thing this screen could do. Selection is the usual one: no
     * pattern, no RS rank, nothing to say.
     */
    /* Read on the recent window for the same reason the costs are: somebody
       who started recording their setups six months ago is not blind to
       selection any more, and a lifetime coverage figure would tell them they
       were for years. */
    const covRows = recent.length >= 20 ? recent : closed;
    const coverage = st.fields.length
      ? Math.round(
          (sum(st.fields.map((f) =>
            covRows.filter((t) => {
              const v = t[f];
              return v !== null && v !== undefined && v !== "" &&
                     !(typeof v === "number" && !Number.isFinite(v));
            }).length
          )) / (st.fields.length * covRows.length)) * 100
        )
      : null;

    /**
     * "NO DATA" AND "NO FINDING" ARE NOT THE SAME STATE.
     *
     * The first version collapsed them and told the reader that timing and
     * cadence had "nothing recorded that would show this" — while breakout
     * volume sat on every trade and cadence is computable from dates alone.
     * The truth was duller and completely different: the checks ran and had
     * nothing to say. Reporting that as missing data sends somebody off to
     * fill in fields that are already full.
     *
     * A stage is dark only when its own fields are actually empty. Otherwise
     * silence means silence.
     */
    const dark = !found.length && cost.costR == null &&
                 coverage !== null && coverage < 25;
    const quiet = !found.length && cost.costR == null && !dark;
    const sample = cost.sample ?? closed.length;

    return {
      key: st.key, step: st.step, name: st.name, blurb: st.blurb,
      reason: dark ? "no-data" : quiet ? "no-finding" : null,
      /**
       * A CHIP SAYING "LEAKING" BESIDE A COST OF ZERO IS THE SCREEN ARGUING
       * WITH ITSELF.
       *
       * The chip comes from the finding, which reads the whole book; the cost
       * comes from the recent window. When the two disagree that is not noise
       * — it is the trader having fixed something, and it is the single most
       * useful thing this row can report. So it gets its own state rather than
       * either number being suppressed: the finding below still stands on the
       * record, and the row says the record is no longer current.
       *
       * Only claimed where the recent window actually ran. A lifetime cost of
       * zero says nothing about lately.
       */
      state: dark ? "unmeasured"
        : (cost.basis === "recent" && cost.costR != null && cost.costR >= 0 &&
           worst && (worst.severity === "critical" || worst.severity === "warning" ||
                     worst.severity === "watch"))
          ? "improving"
        : worst ? (worst.severity === "good" ? "solid"
                 : worst.severity === "watch" ? "watch" : "weak")
        : cost.costR != null ? "measured" : "quiet",
      severity: worst?.severity || null,
      costR: cost.costR,
      costRupees: cost.costRupees,
      costDetail: cost.detail || null,
      /* Which window the headline figure came from, so the UI never labels a
         lifetime sum as recent behaviour. */
      basis: cost.basis,
      window: cost.window,
      lifetimeCostR: cost.lifetimeCostR,
      lifetimeCostRupees: cost.lifetimeCostRupees,
      trend: cost.trend,
      /* A cost is only a cost when it is against you. A stage that made money
         against its own baseline — partials that protected the account — is
         reported, but it is not competing to be the bottleneck. */
      leak: cost.costR != null && cost.costR < 0 ? cost.costR : null,
      sample,
      /* A stage with no sample at all is not thin, it is absent — "only 0
         trades, provisional" was the first render of that mistake. */
      thin: sample != null && sample > 0 && sample < THIN_STAGE,
      coverage,
      findingIds: found.map((f) => f.id),
      findingTitle: worst?.title || null,
    };
  });

  /**
   * Costed leaks first, deepest first — then weak stages that cannot be
   * costed, by severity, then the rest. A stage with a number outranks one
   * without because the number is the evidence; ordering them the other way
   * would put a `watch` with no measurement above a quantified loss.
   */
  const order = (r) =>
    r.leak != null ? [0, r.leak]
    : r.state === "weak" ? [1, RANK[r.severity] ?? 9]
    : r.state === "watch" ? [2, 0]
    /* Above solid, because it still carries a finding worth reading — and
       below anything currently leaking, because it is not. */
    : r.state === "improving" ? [2, 1]
    : r.state === "solid" ? [3, 0]
    : r.state === "measured" ? [3, 1]
    : r.state === "quiet" ? [3, 2]
    : [4, 0];

  const ranked = rows.slice().sort((a, b) => {
    const [ga, va] = order(a), [gb, vb] = order(b);
    return ga - gb || va - vb || a.step - b.step;
  });

  const worst = ranked[0];
  const strong = ranked.filter((r) => r.state === "solid");
  const dark = ranked.filter((r) => r.state === "unmeasured");

  return {
    stages: ranked,
    /* The single sentence, only when there is a quantified leak to name. A
       bottleneck asserted from a severity chip is the "your own record shows
       it" mistake in a new place. */
    bottleneck: worst && worst.leak != null ? worst : null,
    worstStage: worst || null,
    strong: strong.map((r) => r.name),
    unmeasured: dark.map((r) => r.name),
    totalLeakR: +sum(ranked.map((r) => r.leak || 0)).toFixed(1),
    totalLeakRupees: Math.round(
      sum(ranked.map((r) => (r.leak != null && r.costRupees != null ? r.costRupees : 0)))
    ),
  };
}

/* ==================================================================== */
/*  The weekly question, which is a different question                  */
/* ==================================================================== */

/**
 * Did you follow your own rules on the trades you just closed?
 *
 * NOT A SMALLER VERSION OF THE RANKING. Nothing here is an average or a rate,
 * because three trades cannot support one. Every figure is a count or a range
 * over a named handful of trades — "two of three losses ran past the stop" is
 * a fact about those three, and stays true no matter how thin the week was.
 * That is what makes it safe to look at weekly when the ranking above is not.
 *
 * `asOf` is passed in rather than read from the clock so the caller owns the
 * boundary and this stays testable.
 */
export function recentCompliance(closed = [], { days = 7, last = null, open = [], asOf = new Date() } = {}) {
  const end = new Date(asOf);
  const start = new Date(end.getTime() - days * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const day = (t) => (t.exit_date ? String(t.exit_date).slice(0, 10) : "");
  const entryDay = (t) => (t.entry_date ? String(t.entry_date).slice(0, 10) : "");

  /**
   * TWO WAYS TO SAY "RECENTLY", and they answer different questions.
   *
   * A window asks what a stretch of calendar looked like, and a quiet week
   * answers with three trades or none — which is honest, and useless for
   * judging whether the sizing has settled down.
   *
   * A count asks the same questions of a fixed sample, so it says something
   * whatever the pace, and the dates it spans become information in
   * themselves: ten trades over five days is not the same trading as ten
   * over three months.
   *
   * AND THE COUNT ORDERS BY WHEN THE BET WAS PLACED, not when it resolved.
   * This is the difference between two completely different readings of the
   * same book: by exit date a run of old winners closing now reads as a good
   * spell, while the entries actually being placed are getting stopped out
   * within a day. Measured on a real book the two disagreed by 23R and by
   * five wins — one said raise the size, the other said stop trading. The
   * question being asked is whether the market is taking the setups now, so
   * it is the entries that have to be recent.
   *
   * Ties on a date keep their input order, sort being stable — ten trades
   * opened in one batch have no inherent order and this does not invent one.
   */
  const recent = last
    ? closed.filter(entryDay).sort((a, b) => (entryDay(a) < entryDay(b) ? -1 : entryDay(a) > entryDay(b) ? 1 : 0)).slice(-last)
    : closed.filter((t) => {
        const d = day(t);
        return d && d > iso(start) && d <= iso(end);
      });

  const scored = recent.filter((t) => Number.isFinite(t.r));
  const measured = scored.filter(hasRealStop);
  const losses = measured.filter((t) => t.r <= 0);
  const overruns = losses.filter((t) => t.r < OVERRUN_R);
  const risks = recent.map((t) => num(t.riskPct)).filter((v) => v != null && v > 0);

  /**
   * THE REST OF THE BOOK, so the sample can be read against something.
   *
   * "+23.2R" says nothing on its own: a reader cannot tell a good stretch
   * from an ordinary one, and the whole use of this strip is deciding
   * whether the market has turned. Against "your usual ten is +11.1R" it
   * answers immediately. Same for the wins — five of ten looks like a coin
   * until you know the long-run rate is five.
   *
   * THE SAMPLE IS EXCLUDED FROM ITS OWN BASELINE. Comparing ten trades
   * against a book that contains those ten pulls the norm toward whatever
   * just happened, and most on a short record, which is exactly where the
   * comparison is relied on hardest.
   */
  const inSample = new Set(recent);
  const restR = closed.filter((t) => !inSample.has(t))
    .map((t) => t.r).filter((v) => Number.isFinite(v));
  const baseline = restR.length >= BASELINE_MIN && recent.length
    ? {
        n: restR.length,
        perTrade: +(sum(restR) / restR.length).toFixed(2),
        expectedR: +((sum(restR) / restR.length) * recent.length).toFixed(1),
        expectedWins: Math.round(
          (restR.filter((v) => v > 0).length / restR.length) * recent.length),
      }
    : null;

  return {
    days: last ? null : days,
    last,
    baseline,
    /* A window states the dates it asked for; a count states the dates it
       happened to cover, which is the more interesting half of the answer. */
    from: last ? (recent.length ? entryDay(recent[0]) : null) : iso(start),
    to: last ? (recent.length ? entryDay(recent[recent.length - 1]) : null) : iso(end),
    /**
     * HOW MANY BETS FROM THE SAME STRETCH HAVE NOT RESOLVED, which this
     * sample cannot see and which cuts against it.
     *
     * Ordering closed trades by entry date over-represents quick losses: an
     * entry placed last week can only be closed already if it resolved fast,
     * and fast resolutions are mostly stop-outs. The ones still running are
     * the ones that have not failed. Left unsaid, a reader could stop trading
     * on the strength of nine losses while four recent entries sit in profit.
     */
    stillOpen: last && recent.length
      ? open.filter((t) => entryDay(t) && entryDay(t) >= entryDay(recent[0])).length
      : 0,
    trades: recent.length,
    won: scored.filter((t) => t.r > 0).length,
    lost: scored.filter((t) => t.r <= 0).length,
    netR: scored.length ? +sum(scored.map((t) => t.r)).toFixed(1) : null,
    netPnl: recent.length
      ? Math.round(sum(recent.map((t) => num(t.pnl) || 0)))
      : null,
    losses: losses.length,
    overruns: overruns.length,
    /* Named, because on a handful of trades the symbol is more use than the
       count — you remember the trade, not the statistic. */
    overrunSymbols: overruns.map((t) => t.symbol).filter(Boolean),
    riskMin: risks.length ? +Math.min(...risks).toFixed(2) : null,
    riskMax: risks.length ? +Math.max(...risks).toFixed(2) : null,
    assumedStops: recent.length - measured.length,
    noExitReason: recent.filter((t) => !t.exit_reason).length,
  };
}

/* ==================================================================== */
/*  The run you are on now                                              */
/* ==================================================================== */

/**
 * Seven losing entries in a row, and the book is telling you something.
 *
 * WHY SEVEN, AND WHY IT IS WORTH SAYING. Measured on a 1,176-trade book that
 * wins about half its trades and averages +1.1R: a run reaching seven happened
 * 13 times, and the ten trades that followed averaged −19.6R against a usual
 * +11.2R. Shuffling the same trades 2,000 times produced something that bad
 * only 0.4% of the time, so it is not the arithmetic of streaks — losses
 * cluster because regimes do. Shorter cuts fire more often and say less
 * (−9.5R at four, −15.0R at six); longer ones are too rare to act on.
 *
 * It is NOT a verdict on the system. A run this long turns up in any book
 * eventually. It says the market is not taking these setups at the moment,
 * which is a reason to size down or stand aside rather than to push harder.
 */
export const LOSING_RUN_ALERT = 7;

/**
 * COUNTED BY ENTRY DAY, AND CONSERVATIVELY, for the reason stats() counts
 * streaks by day rather than by row: trades sharing a date have no inherent
 * order, and a run counted per row moves with the tiebreak — on a real book
 * the same data gave 50, 53, 67 or 71 depending on how ties happened to sort.
 *
 * So a day ends the run if ANYTHING taken that day made money, and only whole
 * losing days are counted. That is the shortest run any ordering of the ties
 * could produce, which means the alert can never fire on a tiebreak.
 */
export function losingRun(closed = []) {
  const entryDay = (t) => (t?.entry_date ? String(t.entry_date).slice(0, 10) : "");
  /* R where there is one, money where there is not — a trade with no stop
     still won or lost, and leaving it out would let it span a run silently. */
  const outcome = (t) => (Number.isFinite(t?.r) ? t.r : num(t?.pnl));
  const scored = closed.filter((t) => entryDay(t) && Number.isFinite(outcome(t)));

  const byDay = new Map();
  for (const t of scored) {
    const d = entryDay(t);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(t);
  }
  const newestFirst = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));

  const run = [];
  for (const [, ts] of newestFirst) {
    if (ts.some((t) => outcome(t) > 0)) break;
    run.push(...ts);
  }
  const oldestFirst = run.slice().reverse();

  /* The last entry that made money, for somewhere to measure the run from. */
  const wins = scored.filter((t) => outcome(t) > 0)
    .sort((a, b) => (entryDay(a) < entryDay(b) ? -1 : 1));
  const lastWin = wins.length ? wins[wins.length - 1] : null;

  return {
    n: run.length,
    from: oldestFirst.length ? entryDay(oldestFirst[0]) : null,
    to: oldestFirst.length ? entryDay(oldestFirst[oldestFirst.length - 1]) : null,
    symbols: oldestFirst.map((t) => t.symbol).filter(Boolean),
    lastWin: lastWin ? { symbol: lastWin.symbol, date: entryDay(lastWin) } : null,
  };
}
