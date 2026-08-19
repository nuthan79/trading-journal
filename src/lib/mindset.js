import { isConstructiveEntry, isExecutionError, ENTRY_EMOTIONS, EXIT_EMOTIONS } from "./constants";

/**
 * What the recorded feelings are worth, arithmetically.
 *
 * THE POINT OF THIS FILE IS ONE NUMBER: expectancy by entry emotion. Everything
 * else here is context for it. A trader who learns that their FOMO entries
 * average −0.4R while their patient entries average +0.8R has been handed a
 * rule they can act on tomorrow — stop taking the first kind. A radar chart
 * and a flow diagram are how that gets looked at; they are not the finding.
 *
 * WHY THIS RESISTS BEING DECORATIVE. A "mental fitness score" is the easiest
 * thing in this app to fake: pick five words, invent a number for each, average
 * them, print 67. It looks insightful and means nothing. So every axis below
 * counts something the trader actually did — stops honoured, trades reviewed,
 * winners held longer than losers — and any axis that cannot be counted is not
 * on the chart. `pattern recognition`, which the reference design showed, is
 * absent for exactly that reason: there is no honest way to compute it from a
 * trade log, and a made-up axis discredits the four real ones beside it.
 *
 * NOTHING HERE INFERS A FEELING. An unrecorded emotion is null and stays null.
 * Guessing "they were probably anxious, they lost" would manufacture the
 * correlation the page then reports, which is the one failure that would make
 * every number on it worthless.
 */

/** Below this a per-emotion figure is noise. `edge.js` uses 15 for the same
 *  reason; emotions are recorded less often, so this is lower and the UI is
 *  told rather than the row being hidden. */
export const THIN_EMOTION = 5;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pctOf = (n, d) => (d > 0 ? (n / d) * 100 : NaN);

/** Closed trades with a computable R and a stop the trader actually set —
 *  the same basis `analysis.js` and the Edge tab use, so the three screens
 *  cannot quietly disagree about which trades count. */
export const measurable = (closed = []) =>
  closed.filter((t) => t.stop_source !== "assumed" && Number.isFinite(t.r));

/**
 * Expectancy by the state you were in when you took it.
 *
 * The finding this feature exists for. Sorted worst first, because the useful
 * end is the one costing money — a list that opens with the trader's best mood
 * is a compliment, and they did not need a chart for that.
 */
export function emotionEdge(closed = [], field = "entry_emotion") {
  const rows = measurable(closed).filter((t) => t[field]);
  const by = new Map();
  for (const t of rows) {
    if (!by.has(t[field])) by.set(t[field], []);
    by.get(t[field]).push(t);
  }

  const order = field === "entry_emotion" ? ENTRY_EMOTIONS : EXIT_EMOTIONS;

  return [...by.entries()]
    .map(([emotion, ts]) => {
      const rs = ts.map((t) => t.r);
      const wins = rs.filter((r) => r > 0);
      return {
        emotion,
        n: ts.length,
        expectancy: mean(rs),
        totalR: rs.reduce((a, b) => a + b, 0),
        winRate: pctOf(wins.length, rs.length),
        isThin: ts.length < THIN_EMOTION,
        /** Where it sits in the vocabulary, so the UI can keep constructive
         *  and reactive states visually grouped when it wants to. */
        rank: order.indexOf(emotion),
      };
    })
    .sort((a, b) => a.expectancy - b.expectancy);
}

/**
 * The gap between your best and worst state, in R per trade.
 *
 * One number that says whether any of this matters. If a trader's calm trades
 * and their FOMO trades return the same thing, their mood is not their problem
 * and the page should say so rather than implying a pattern that is not there.
 * Only computed across states with enough trades to be worth comparing.
 */
export function emotionSpread(closed = []) {
  const solid = emotionEdge(closed).filter((r) => !r.isThin);
  if (solid.length < 2) return null;
  const worst = solid[0];
  const best = solid[solid.length - 1];
  return {
    worst, best,
    gapR: best.expectancy - worst.expectancy,
    /**
     * What the worst state actually cost, in R — and nothing more.
     *
     * The tempting figure is `n × (best − worst)`: what those trades would have
     * returned taken in the best state instead. It is much bigger and it is a
     * counterfactual — it assumes trades taken while chasing would have won had
     * the trader been calm, which is exactly the thing not in evidence. This is
     * the sum of what was lost on them, which needs no assumption at all.
     *
     * Null when the worst state still makes money: there is no cost to report,
     * and inventing one to keep a number on screen is how the page starts
     * lying.
     */
    costOfWorst: worst.totalR < 0 ? -worst.totalR : null,
  };
}

/**
 * Entry state → outcome → exit state, as ribbon counts.
 *
 * Only trades carrying BOTH ends flow all the way through; a trade with an
 * entry emotion and no exit emotion still counts on the left. Reporting them
 * as complete journeys would invent the half that was never recorded.
 */
export function emotionFlow(closed = []) {
  const rows = measurable(closed);
  const entryLinks = new Map();   // "Calm|win" -> count
  const exitLinks = new Map();    // "win|Satisfied" -> count
  const entryTotals = new Map();
  const exitTotals = new Map();
  let wins = 0, losses = 0, winR = 0, lossR = 0;

  for (const t of rows) {
    const side = t.r > 0 ? "win" : "loss";
    if (side === "win") { wins++; winR += t.r; } else { losses++; lossR += t.r; }

    if (t.entry_emotion) {
      const k = `${t.entry_emotion}|${side}`;
      entryLinks.set(k, (entryLinks.get(k) || 0) + 1);
      entryTotals.set(t.entry_emotion, (entryTotals.get(t.entry_emotion) || 0) + 1);
    }
    if (t.exit_emotion) {
      const k = `${side}|${t.exit_emotion}`;
      exitLinks.set(k, (exitLinks.get(k) || 0) + 1);
      exitTotals.set(t.exit_emotion, (exitTotals.get(t.exit_emotion) || 0) + 1);
    }
  }

  const asLinks = (m) => [...m.entries()].map(([k, count]) => {
    const [from, to] = k.split("|");
    return { from, to, count };
  });

  return {
    /* Ordered by the vocabulary, not by volume, so the constructive states stay
       at the top and the shape of the diagram means something between one
       reading and the next. */
    entryNodes: ENTRY_EMOTIONS
      .filter((e) => entryTotals.has(e))
      .map((e) => ({ key: e, count: entryTotals.get(e) })),
    exitNodes: EXIT_EMOTIONS
      .filter((e) => exitTotals.has(e))
      .map((e) => ({ key: e, count: exitTotals.get(e) })),
    entryLinks: asLinks(entryLinks),
    exitLinks: asLinks(exitLinks),
    outcome: {
      wins, losses,
      avgWinR: wins ? winR / wins : NaN,
      avgLossR: losses ? lossR / losses : NaN,
    },
    /** So the UI can say what the picture is drawn from rather than implying
     *  it covers everything. */
    recordedEntry: entryTotals.size ? [...entryTotals.values()].reduce((a, b) => a + b, 0) : 0,
    recordedExit: exitTotals.size ? [...exitTotals.values()].reduce((a, b) => a + b, 0) : 0,
    total: rows.length,
  };
}

/**
 * Four axes, each counting something that happened.
 *
 * Scores are 0–100 because a radar needs a common scale, and every one of them
 * is a percentage of trades meeting a stated test — not a weighting invented to
 * make the shape look interesting. Each carries `basis` so the UI can show what
 * it was computed from, since a score from six trades and a score from two
 * hundred should not look alike.
 *
 * Returns null where there is nothing to measure. A zero would read as a
 * failing grade for somebody who simply has not recorded anything yet, which is
 * the same mistake as counting a young cohort's retention as 0%.
 */
export function mindsetProfile(closed = []) {
  const rows = measurable(closed);
  const all = closed.filter((t) => t.status === "closed");
  if (!rows.length) return null;

  /* DISCIPLINE — losses that stopped where they were meant to.
     A loss worse than −1.2R means the stop was not taken at the stop. The
     tolerance is there because slippage and gaps are real and are not
     indiscipline; past it, something was decided in the moment. */
  const losses = rows.filter((t) => t.r <= 0);
  const held = losses.filter((t) => t.r >= -1.2);
  const discipline = losses.length ? pctOf(held.length, losses.length) : null;

  /* EMOTIONAL CONTROL — entered in a state worth committing money in.
     Counted only over trades where a state was recorded; the unrecorded ones
     are unknown, not bad. */
  const withEntry = rows.filter((t) => t.entry_emotion);
  const constructive = withEntry.filter((t) => isConstructiveEntry(t.entry_emotion));
  const control = withEntry.length ? pctOf(constructive.length, withEntry.length) : null;

  /* REFLECTION — closed trades that were actually reviewed afterwards.
     Any of: a tag, a note, or a recorded exit feeling. Over ALL closed trades,
     including assumed-stop ones, because reviewing a trade does not require a
     computable R. */
  const reviewed = all.filter(
    (t) => (t.mistakes?.length > 0) || !!t.notes?.trim() || !!t.exit_emotion
  );
  const reflection = all.length ? pctOf(reviewed.length, all.length) : null;

  /* PATIENCE — winners held longer than losers.
     The disposition effect, which is the most diagnostic behaviour in a
     breakout system: cutting winners early and nursing losers is precisely
     how a positive-expectancy method is turned into a negative one. Scored as
     the ratio, capped at 100 — holding winners twice as long is full marks,
     and past that it stops being more virtuous. */
  const winHold = mean(rows.filter((t) => t.r > 0).map((t) => t.heldDays).filter(Number.isFinite));
  const lossHold = mean(rows.filter((t) => t.r <= 0).map((t) => t.heldDays).filter(Number.isFinite));
  const patience = Number.isFinite(winHold) && Number.isFinite(lossHold) && lossHold > 0
    ? Math.max(0, Math.min(100, (winHold / lossHold) * 50))
    : null;

  const axes = [
    { key: "discipline", label: "Discipline", score: discipline,
      basis: `${held.length} of ${losses.length} losses stopped at plan`,
      hint: "Losses that ended near where the stop said they would." },
    { key: "control", label: "Emotional control", score: control,
      basis: withEntry.length
        ? `${constructive.length} of ${withEntry.length} entries in a settled state`
        : "no entry states recorded yet",
      hint: "Calm, confident, patient or focused when the position was opened." },
    { key: "reflection", label: "Reflection", score: reflection,
      basis: `${reviewed.length} of ${all.length} closed trades reviewed`,
      hint: "A tag, a note, or an exit feeling recorded after the trade." },
    { key: "patience", label: "Patience", score: patience,
      basis: Number.isFinite(winHold) && Number.isFinite(lossHold)
        ? `winners ${Math.round(winHold)}d vs losers ${Math.round(lossHold)}d`
        : "not enough dated trades",
      hint: "Holding winners longer than losers, which is the whole game." },
  ];

  const scored = axes.filter((a) => Number.isFinite(a.score));

  return {
    axes,
    /* The average of what could be measured, and the count it came from — an
       overall built from two axes is not the same claim as one built from four
       and the UI has to be able to say so. */
    overall: scored.length ? Math.round(mean(scored.map((a) => a.score))) : null,
    measuredAxes: scored.length,
    n: rows.length,
  };
}

/**
 * How much of this is actually recorded.
 *
 * Every screen reading these numbers has to be able to say what they are drawn
 * from. A flow diagram built on four of ninety trades is a curiosity, and
 * presenting it like a finding is how a feature stops being trustworthy.
 */
export function coverage(closed = []) {
  const all = closed.filter((t) => t.status === "closed");
  const rows = measurable(closed);
  const entry = rows.filter((t) => t.entry_emotion).length;
  const exit = rows.filter((t) => t.exit_emotion).length;
  const both = rows.filter((t) => t.entry_emotion && t.exit_emotion).length;
  return {
    closed: all.length,
    measurable: rows.length,
    /** Excluded for carrying an importer's invented stop — worth naming,
     *  because they are fixable in the /stops queue. */
    assumedStops: all.length - rows.length,
    entry, exit, both,
    entryPct: pctOf(entry, rows.length),
    exitPct: pctOf(exit, rows.length),
    /** Enough to draw the flow at all. Two trades make a diagram, not a
     *  finding. */
    ready: both >= THIN_EMOTION,
  };
}

/**
 * Which execution errors cluster in which entry state.
 *
 * The mechanism behind the headline. "Your FOMO trades lose money" is a
 * result; "your FOMO trades are where 'chased extended' and 'oversized' come
 * from" is the reason, and the reason is what changes behaviour. Outcome tags
 * are excluded via `isExecutionError` for the same reason `analysis.js`
 * excludes them — "setup failed" is not a thing anybody did.
 */
export function errorsByEntryState(closed = []) {
  const rows = measurable(closed).filter((t) => t.entry_emotion && t.mistakes?.length);
  const by = new Map();
  for (const t of rows) {
    for (const m of t.mistakes) {
      if (!isExecutionError(m)) continue;
      const k = `${t.entry_emotion}|${m}`;
      by.set(k, (by.get(k) || 0) + 1);
    }
  }
  return [...by.entries()]
    .map(([k, count]) => {
      const [emotion, mistake] = k.split("|");
      return { emotion, mistake, count };
    })
    .sort((a, b) => b.count - a.count);
}
