/**
 * How much of a trade's best close it handed back before you got out.
 *
 * WHY THIS EXISTS. "What the mistakes cost" costs a tag by what the trades
 * carrying it returned, and for most tags that is informative: trades tagged
 * "Not a real base" lose money, and the table says so. For the exit-timing
 * tags it is not merely uninformative, it inverts. You only write "Sold a
 * little late" on a trade that had run, and only write "Sold too early" on one
 * that kept going — so both tags select winners by construction and arrive in
 * a table headed "what the mistakes cost" carrying positive expectancy. On a
 * real book they read +1.47R and +4.10R, which says selling badly pays.
 *
 * The honest cost of a late exit is not what the trade made. It is the
 * distance between the best close it reached and the close you took, and that
 * is a number the measure pass already stores.
 *
 * WHAT THIS CANNOT MEASURE, AND WHY IT IS NOT HERE. `tradePath` bounds its
 * window at the exit date (`b.d <= to`), so `mfe_r` knows nothing about what
 * the stock did the week after you sold. Giveback is therefore only the right
 * measure for selling LATE — holding past the peak you had. Selling EARLY, in
 * the sense that it ran on without you, needs bars after the exit and a column
 * to put them in; `postExitNeeded()` names the trades that would answer it.
 * Costing "Sold too early" with this would measure the wrong thing confidently,
 * which is worse than the table that prompted the file.
 *
 * ON CLOSES, NOT HIGHS — `mfe_r` is the best daily CLOSE. An intraday spike
 * you could not have sold into is not a gain you had. One consequence has to
 * be handled rather than explained away: an exit can legitimately beat every
 * close in the hold, because you can sell intraday above where the day
 * finished. That makes `r > mfe`, and giveback floors at zero rather than
 * going negative and reading as a bonus.
 */

import { excursion } from "./path";

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

/** Below this there is nothing to have given back. A trade whose best close
 *  never cleared its entry had no peak to hold past. */
const PEAK_FLOOR_R = 0.25;

/**
 * One trade's giveback, or why there isn't one.
 *
 * `state` carries the reason straight from `excursion`, so a dash on this
 * screen means the same thing as a dash on the Trades table rather than
 * quietly meaning something else.
 */
export function giveback(t) {
  const none = (state, why) => ({
    measurable: false, state, why,
    givebackR: NaN, peakR: NaN, exitR: NaN, keptPct: NaN,
  });

  if (!t || t.status !== "closed") return none("open", "Still open");

  const ex = excursion(t);
  if (ex.state !== "measured") return none(ex.state, ex.why);

  const peakR = num(ex.mfe);
  const exitR = num(t.r);
  if (!Number.isFinite(peakR) || !Number.isFinite(exitR)) {
    return none("no-bars", "No usable figures for the dates this was held");
  }
  if (peakR < PEAK_FLOOR_R) {
    return none("never-ran", "Never closed far enough above entry to give anything back");
  }

  /* Floored: see the note at the top about an intraday exit beating every
     close in the hold. */
  const givebackR = Math.max(0, peakR - exitR);

  return {
    measurable: true,
    state: "measured",
    why: "",
    peakR,
    exitR,
    givebackR,
    /** The share of the best close that survived to the exit. The figure
     *  people actually repeat to themselves — "I kept two thirds of it". */
    keptPct: peakR > 0 ? Math.max(0, Math.min(100, (exitR / peakR) * 100)) : NaN,
    /** What that giveback was worth, when the trade carries a rupee 1R. */
    givebackMoney: Number.isFinite(num(t.riskAmt)) ? givebackR * num(t.riskAmt) : NaN,
    stale: ex.stale,
    through: ex.through,
  };
}

const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The book's exit quality.
 *
 * MEDIAN, NOT MEAN. One trade that ran to 17R and was closed at 9R would carry
 * a mean on its own and make a disciplined book look careless. The median says
 * what usually happens, which is the thing a trader can act on.
 */
export function givebackBook(closed = []) {
  const rows = [];
  const skipped = { "no-stop": 0, unmeasured: 0, "no-bars": 0, "never-ran": 0, open: 0 };

  for (const t of closed) {
    const g = giveback(t);
    if (g.measurable) rows.push({ t, ...g });
    else if (g.state in skipped) skipped[g.state]++;
  }

  if (!rows.length) {
    return { measured: 0, skipped, rows: [], eligible: 0 };
  }

  const gives = rows.map((r) => r.givebackR);
  const keeps = rows.map((r) => r.keptPct).filter(Number.isFinite);
  const money = rows.map((r) => r.givebackMoney).filter(Number.isFinite);

  return {
    measured: rows.length,
    eligible: rows.length + skipped["never-ran"],
    skipped,
    rows,
    medianGivebackR: median(gives),
    totalGivebackR: gives.reduce((a, b) => a + b, 0),
    totalGivebackMoney: money.length ? money.reduce((a, b) => a + b, 0) : NaN,
    medianKeptPct: median(keeps),
    /** The worst offenders, for the screen to link to. */
    worst: [...rows].sort((a, b) => b.givebackR - a.givebackR).slice(0, 8),
  };
}

/**
 * Does the tag find the trades the measurement finds?
 *
 * THE QUESTION THE TAG TABLE CANNOT ASK. A self-applied tag is only worth
 * costing if it marks something real. Comparing the median giveback on trades
 * tagged "Sold a little late" against every other measurable trade answers
 * that directly: a tag that lands on trades giving back no more than the rest
 * is noticing nothing, and the right response is to stop reporting it rather
 * than to report it more precisely.
 */
export function givebackByTag(closed = [], tag = "Sold a little late") {
  const book = givebackBook(closed);
  if (!book.measured) return null;

  const tagged = book.rows.filter((r) => (r.t.mistakes || []).includes(tag));
  const rest = book.rows.filter((r) => !(r.t.mistakes || []).includes(tag));

  const stat = (rows) => ({
    count: rows.length,
    medianGivebackR: median(rows.map((r) => r.givebackR)),
    medianKeptPct: median(rows.map((r) => r.keptPct).filter(Number.isFinite)),
    totalGivebackR: rows.reduce((a, r) => a + r.givebackR, 0),
    totalGivebackMoney: rows
      .map((r) => r.givebackMoney)
      .filter(Number.isFinite)
      .reduce((a, b) => a + b, 0),
  });

  const t = stat(tagged);
  const o = stat(rest);
  const gap = t.medianGivebackR - o.medianGivebackR;

  /* Both sides need enough trades before a difference between them means
     anything. Eight is not a confidence interval; it is the point below which
     one trade moves the median, which is the failure this guard is for. */
  const comparable = tagged.length >= 8 && rest.length >= 8;

  return {
    tag,
    tagged: t,
    untagged: o,
    gap,
    comparable,
    /** True when the tag marks trades that really did hold on longer. */
    tagIsReal: comparable && gap > 0.25,
    /** True when it does not — the tag is costing nothing it can show. */
    tagIsNoise: comparable && Math.abs(gap) <= 0.25,
  };
}

/**
 * Trades that would need bars AFTER the exit to be costed.
 *
 * Returned rather than silently dropped so the screen can say how many
 * judgements it is declining to make, and so a later measure pass has its
 * work list ready. The window is what to fetch, not what was fetched.
 */
export function postExitNeeded(closed = [], tag = "Sold too early", sessions = 20) {
  const rows = (closed || []).filter(
    (t) => t.status === "closed" && (t.mistakes || []).includes(tag) && t.exit_date
  );
  return {
    tag,
    sessions,
    count: rows.length,
    rows: rows.map((t) => ({
      id: t.id, symbol: t.symbol, exchange: t.exchange,
      exitDate: t.exit_date, exitR: num(t.r),
    })),
  };
}

/**
 * What a `givebackByTag` comparison found, in a few words, and its tone —
 * for the "Does the tag mark it?" column on What works.
 *
 * Four answers, not two: too few to say; real (the tagged trades gave back
 * more); noise (no different); and backwards — the tagged trades gave back
 * LESS than the rest, which `tagIsReal`/`tagIsNoise` leave unnamed and which
 * means the tag is being written on the wrong trades.
 */
export function exitVerdict(c) {
  if (!c) return { word: "—", tone: "" };
  if (!c.comparable) {
    return { word: `Too few to say — ${c.tagged.count} tagged, ${c.untagged.count} not; needs 8 a side`, tone: "" };
  }
  const gap = `${Math.abs(c.gap).toFixed(2)}R`;
  if (c.tagIsReal) return { word: `Real — these gave back ${gap} more than the rest`, tone: "neg" };
  if (c.tagIsNoise) return { word: "Noise — no more given back than untagged trades", tone: "" };
  return { word: `Backwards — these gave back ${gap} less than the rest`, tone: "pos" };
}
