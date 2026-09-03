/**
 * Every number the journal reports. Pure functions, no I/O — so this file is
 * also the one worth writing tests against.
 */

import { bankedEvents } from "./positions";
import { MONTHS } from "./format";

const n = (v) => (v === "" || v == null ? NaN : Number(v));

/* ------------------------------------------------------------------ */
/*  Per-trade                                                          */
/* ------------------------------------------------------------------ */

export function derive(t, accountSize) {
  const entry = n(t.entry_price), stop = n(t.stop_loss), qty = n(t.quantity);
  const exit = n(t.exit_price), pivot = n(t.pivot_price), charges = n(t.charges) || 0;
  const dir = t.side === "short" ? -1 : 1;

  const riskPerShare = Math.abs(entry - stop);
  const riskAmt = riskPerShare * qty;                       // 1R
  const riskPct = accountSize > 0 ? (riskAmt / accountSize) * 100 : NaN;
  const exposure = entry * qty;

  const distPivot = pivot > 0 ? ((entry - pivot) / pivot) * 100 * dir : NaN;

  // Mark open positions to the last known price so equity is honest today
  const mark = t.status === "closed" ? exit : n(t.last_price);
  const hasMark = isFinite(mark);

  const grossPnl = hasMark ? (mark - entry) * qty * dir : NaN;
  const pnl = hasMark ? grossPnl - charges : NaN;           // net of costs
  const r = riskAmt > 0 && isFinite(pnl) ? pnl / riskAmt : NaN;

  // An assumed entry date is not a date. A holdings file states what you own
  // and never when you bought it, so the importer has to put something in a
  // NOT NULL column; counting days from that guess would report a two-year
  // hold as a zero-day trade. NaN is already how "no entry date" travels here
  // and every consumer filters on isFinite, so the guess simply does not
  // become a measurement. See migration 036.
  let heldDays = NaN;
  if (t.entry_date && t.entry_date_source !== "assumed") {
    const end = t.status === "closed" && t.exit_date ? new Date(t.exit_date) : new Date();
    heldDays = Math.round((end - new Date(t.entry_date)) / 86400000);
  }

  return {
    riskPerShare, riskAmt, riskPct, exposure, distPivot,
    grossPnl, pnl, r, heldDays, mark, hasMark,
    unrealised: t.status === "open" ? pnl : NaN,
  };
}

/* ------------------------------------------------------------------ */
/*  Aggregate                                                          */
/* ------------------------------------------------------------------ */

export function stats(rows) {
  const rs = rows.map((x) => x.r).filter(isFinite);
  if (!rs.length) return { n: 0 };

  const wins = rs.filter((x) => x > 0);
  const losses = rs.filter((x) => x <= 0);
  const sum = rs.reduce((a, b) => a + b, 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;

  let cum = 0, peak = 0, maxDD = 0;
  for (const x of rs) { cum += x; peak = Math.max(peak, cum); maxDD = Math.max(maxDD, peak - cum); }

  /**
   * Streaks counted by day, not by row.
   *
   * Per-row, this measured nothing. Positions routinely close in batches —
   * going to cash across twenty-five names is one decision that lands as
   * seventy rows — and rows sharing an exit date have no inherent order, so
   * the answer moved with the tiebreak. On a real journal the same data gave
   * a worst run of 50, 53, 67 or 71 depending only on how ties happened to
   * sort. A number that changes with the sort is not a measurement.
   *
   * By day it is stable and means what people think it means: how many
   * sessions in a row went against you. A day counts as a loss when the day's
   * total R is at or below zero, so one bad exit among good ones doesn't break
   * a run and a mass liquidation is the single event it actually was.
   *
   * Rows with no exit date — an open position should never be here, but the
   * caller decides that — fall back to entry date rather than being dropped.
   */
  const byDay = new Map();
  for (const t of rows) {
    if (!isFinite(t.r)) continue;
    const day = t.exit_date || t.entry_date || "";
    byDay.set(day, (byDay.get(day) || 0) + t.r);
  }
  const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  let cw = 0, cl = 0, bestW = 0, worstL = 0;
  for (const [, dayR] of days) {
    if (dayR > 0) { cw++; cl = 0; bestW = Math.max(bestW, cw); }
    else { cl++; cw = 0; worstL = Math.max(worstL, cl); }
  }

  return {
    n: rs.length,
    winRate: (wins.length / rs.length) * 100,
    expectancy: sum / rs.length,
    totalR: sum, avgWin, avgLoss,
    payoff: avgLoss > 0 ? avgWin / avgLoss : Infinity,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : Infinity,
    maxDD, bestW, worstL,
    quality: maxDD > 0 ? sum / maxDD : Infinity,   // total R per unit of drawdown
    best: Math.max(...rs), worst: Math.min(...rs),
  };
}

/* ------------------------------------------------------------------ */
/*  Return on capital                                                  */
/* ------------------------------------------------------------------ */

/**
 * XIRR — money-weighted annual return over irregular cash flows.
 *
 * flows: [{ date, amount }] where a deposit into the trading account is
 * NEGATIVE (money leaving your pocket) and the closing account value is a
 * final POSITIVE flow. This is the same sign convention as Excel's XIRR.
 *
 * Solved by bisection rather than Newton-Raphson: slower by microseconds,
 * but it cannot diverge, which matters when a year has lumpy flows.
 */
export function xirr(flows) {
  const cf = flows
    .map((f) => ({ t: new Date(f.date).getTime(), a: Number(f.amount) }))
    .filter((f) => isFinite(f.a) && isFinite(f.t) && f.a !== 0)
    .sort((a, b) => a.t - b.t);

  if (cf.length < 2) return NaN;
  if (!cf.some((f) => f.a > 0) || !cf.some((f) => f.a < 0)) return NaN;

  const t0 = cf[0].t;
  const years = (t) => (t - t0) / (365 * 86400000);
  const npv = (rate) => cf.reduce((s, f) => s + f.a / Math.pow(1 + rate, years(f.t)), 0);

  let lo = -0.9999, hi = 100;
  let flo = npv(lo);
  if (flo * npv(hi) > 0) return NaN;   // no sign change — no solution in range

  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) hi = mid;
    else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

/** Build the flow list XIRR needs from your capital ledger and current equity. */
export function buildFlows(capitalFlows, closingEquity, asOf = new Date()) {
  const flows = capitalFlows.map((f) => ({
    date: f.flow_date,
    amount: -Number(f.amount),      // deposit = money in = negative flow
  }));
  flows.push({ date: asOf, amount: Number(closingEquity) });
  return flows;
}

/** CAGR — only honest when no capital moved in or out. Use XIRR otherwise. */
export function cagr(begin, end, years) {
  if (!(begin > 0) || !(years > 0) || !isFinite(end) || end <= 0) return NaN;
  return Math.pow(end / begin, 1 / years) - 1;
}

/** A calendar day count that never parses a date string through a timezone. */
const dayNum = (iso) => {
  if (iso instanceof Date) return Math.floor(iso.getTime() / 86400000);
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  return y > 0 ? Math.floor(Date.UTC(y, m - 1, d) / 86400000) : NaN;
};

/** Below this the annualising exponent does the talking, not the trading. */
const MIN_DAYS = 90;

/**
 * The annual return, measured — the figure people mean by XIRR or CAGR.
 *
 * WHY THIS EXISTS BESIDE "RETURN ON CAPITAL". That one is cumulative: 19% is
 * 19% whether it took nine months or four years, which is the one thing
 * anybody actually wants to know. Its own hint has said "Cumulative, not
 * annualised" since it was written.
 *
 * MARKED TO MARKET, which is the decision that matters most here. The closing
 * value counts open positions at the last price, not at cost, because every
 * broker and mutual fund statement does — and because a trader holding a book
 * of winners would otherwise see those winners simply absent from their
 * return until the day they sold.
 *
 * ONE NUMBER, TWO METHODS, AND IT SAYS WHICH.
 *
 * XIRR is CAGR generalised to money arriving and leaving at arbitrary dates.
 * With no deposits or withdrawals in the record the two cash flows are the
 * opening balance and today's value, and XIRR reduces to CAGR exactly — so
 * running the solver would be arithmetic theatre. `cagr()` is used there and
 * the label says CAGR, which is also the honest word for it. Record a
 * deposit and it becomes a genuine XIRR, money-weighted, and says so.
 *
 * REFUSES A SHORT RECORD. Annualising six weeks raises the period return to
 * the power of eight and prints a number governed by the exponent rather than
 * the trading: +4% in six weeks reads as +38% a year. Under MIN_DAYS it
 * returns the reason instead of the figure.
 */
export function annualisedReturn(trades, { openingCapital = 0, flows = [], asOf = new Date() } = {}) {
  const rows = trades || [];
  const fl = (flows || [])
    .map((f) => ({ day: dayNum(f.flow_date), date: f.flow_date, amount: n(f.amount) }))
    .filter((f) => isFinite(f.day) && isFinite(f.amount) && f.amount !== 0)
    .sort((a, b) => a.day - b.day);

  /* When the money went to work: the first position taken, or the first
     deposit if that came earlier. Entry dates, not exits — capital is
     committed when a trade is opened, and measuring from the first SALE
     would skip however long the first position was held. */
  const entryDays = rows.map((t) => dayNum(t.entry_date)).filter(isFinite);
  const startDay = Math.min(
    ...(entryDays.length ? entryDays : [Infinity]),
    ...(fl.length ? [fl[0].day] : [Infinity])
  );
  const endDay = dayNum(asOf);
  if (!isFinite(startDay) || !isFinite(endDay)) return { rate: NaN, method: "none" };

  const days = endDay - startDay;
  const years = days / 365;

  /* Opening balance: the account size plus anything paid in on or before the
     day the record starts. Those are not intermediate flows — they are what
     the account began with. */
  const opening = fl.filter((f) => f.day <= startDay).reduce((a, f) => a + f.amount, 0);
  const base = n(openingCapital) + opening;

  const realised = rows.reduce((a, t) => a + (isFinite(t.realisedPnl) ? t.realisedPnl : 0), 0);
  /* The mark, on whatever is still held. Unrealised is NaN on a position with
     no quote — the app degrades to no mark rather than to zero — and such a
     position is then carried at cost, which is the conservative reading. */
  const unrealised = rows.reduce((a, t) => a + (isFinite(t.unrealisedPnl) ? t.unrealisedPnl : 0), 0);
  const later = fl.filter((f) => f.day > startDay);
  const closing = base + later.reduce((a, f) => a + f.amount, 0) + realised + unrealised;

  const shape = {
    years, days, base, closing, realised, unrealised,
    flows: later.length,
    marked: rows.some((t) => isFinite(t.unrealisedPnl)),
  };

  if (!(base > 0)) return { ...shape, rate: NaN, method: "no-capital" };
  if (days < MIN_DAYS) return { ...shape, rate: NaN, method: "too-short", minDays: MIN_DAYS };

  if (!later.length) return { ...shape, rate: cagr(base, closing, years), method: "cagr" };

  const cf = [
    { date: new Date(startDay * 86400000), amount: -base },
    ...later.map((f) => ({ date: f.date, amount: -f.amount })),
    { date: asOf, amount: closing },
  ];
  return { ...shape, rate: xirr(cf), method: "xirr" };
}

/**
 * The two figures that qualify an annual return.
 *
 * A rate on its own says where you ended up and nothing about what it cost or
 * what it was earned on. These are the two questions people actually mean by
 * "is that realistic".
 *
 * PER UNIT OF DRAWDOWN — the MAR ratio. "For every 1% the account gave back,
 * it earned this much a year." Around 0.5 is respectable over a full cycle and
 * anything much past 1 deserves suspicion, which makes it the fastest way to
 * see that a big return was bought with a big hole.
 *
 * Its denominator is honest about its own limits and the caller must say so:
 * `equityCurve` steps on realisations, so the drawdown it measures is of
 * CLOSED-TRADE equity. A position that halved and recovered before it was
 * sold never appears in it. That understates the pain and therefore flatters
 * this ratio — the fix is a daily mark-to-market equity curve, which needs
 * historical prices the journal does not keep for every position.
 *
 * ON CAPITAL EMPLOYED — against the money actually at work rather than the
 * figure typed into Settings. A trader running at 126% of their nominal
 * capital on an average day is not earning that return on the nominal figure,
 * and this is the denominator they recognise.
 *
 * Simple annualisation, not compounding, and deliberately: average deployed
 * capital is an average across the whole span rather than a balance that
 * grew, so raising it to a power would describe a base that never existed.
 */
export function returnQuality({ rate, years, netPnl, maxDDPct, avgDeployed } = {}) {
  const perDrawdown = isFinite(rate) && isFinite(maxDDPct) && maxDDPct > 0
    ? (rate * 100) / maxDDPct
    : NaN;

  const employedTotal = isFinite(netPnl) && avgDeployed > 0 ? netPnl / avgDeployed : NaN;
  const employed = isFinite(employedTotal) && years > 0
    ? (employedTotal / years) * 100
    : NaN;

  return { perDrawdown, employed, employedTotal: employedTotal * 100, avgDeployed, maxDDPct };
}

/**
 * Forward expected annual return implied by the system, rather than measured
 * from one realised year: compounding `expectancy × risk%` over N trades.
 */
export function impliedAnnual(expectancyR, riskPct, tradesPerYear) {
  const per = expectancyR * (riskPct / 100);
  if (!isFinite(per) || !(tradesPerYear > 0)) return NaN;
  return Math.pow(1 + per, tradesPerYear) - 1;
}

/**
 * Monte Carlo over your own R-distribution. Resamples with replacement to
 * answer the question a single year's CAGR cannot: what range of outcomes
 * does this system produce, and how deep does the bad tail go?
 */
export function monteCarlo(rMultiples, { trades = 60, riskPct = 0.75, runs = 5000 } = {}) {
  const pool = rMultiples.filter(isFinite);
  if (pool.length < 10) return null;

  const rets = [], dds = [];
  for (let run = 0; run < runs; run++) {
    let equity = 1, peak = 1, maxDD = 0;
    for (let i = 0; i < trades; i++) {
      const r = pool[(Math.random() * pool.length) | 0];
      equity *= 1 + r * (riskPct / 100);
      peak = Math.max(peak, equity);
      maxDD = Math.max(maxDD, (peak - equity) / peak);
    }
    rets.push((equity - 1) * 100);
    dds.push(maxDD * 100);
  }
  rets.sort((a, b) => a - b);
  dds.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];

  return {
    runs, trades, riskPct,
    return: { p5: q(rets, 0.05), p25: q(rets, 0.25), median: q(rets, 0.5), p75: q(rets, 0.75), p95: q(rets, 0.95) },
    drawdown: { median: q(dds, 0.5), p95: q(dds, 0.95), worst: dds[dds.length - 1] },
    lossOdds: (rets.filter((x) => x < 0).length / runs) * 100,
  };
}

/* ==================================================================== */
/*  Equity curve, headline numbers, and period breakdowns               */
/* ==================================================================== */

/** Closed trades in the order they were realised. */
export function chronological(closed) {
  return [...closed].sort(
    (a, b) =>
      new Date(a.exit_date || a.entry_date) - new Date(b.exit_date || b.entry_date)
  );
}

/**
 * Rupee equity curve.
 *
 * Starts from opening capital and applies each closed trade's net P&L in
 * date order, injecting capital flows on their dates. This is what makes a
 * percentage drawdown meaningful — an R drawdown tells you how many units of
 * risk you gave back, a percentage drawdown tells you what it did to the
 * account, and only the second one is what you actually have to sit through.
 */
export function equityCurve(closed, { openingCapital = 0, flows = [] } = {}) {
  /**
   * THE CURVE STEPS ON EVERY SELL, NOT ON EVERY POSITION.
   *
   * `exit_date` is a position's LAST tranche, so a position sold across
   * months put its whole result on the later date — the curve stayed flat
   * through money that had already arrived, then jumped. Drawdown is measured
   * off this walk, so a peak-to-trough that really happened between two
   * partial sells was invisible, and one that never happened appeared at the
   * final exit.
   *
   * Each sell is now its own step, dated when it happened. A position that
   * cannot be split — an undated tranche — falls back to one step at its exit,
   * which is where it was before. realisationEvents guarantees the parts sum
   * to the position, so the curve ENDS in exactly the same place either way;
   * only the shape between the ends changes, and only towards the truth.
   */
  const rows = chronological(closed).flatMap((t) =>
    /* `charges`, not `charge`: these rows stand in for trades further down —
       the charges total below reads the trade field off them, and a split
       position silently contributed zero to it while the fallback kept its
       own. The headline read ₹0 on a book that had paid lakhs.

       bankedEvents rather than a fallback written out here: a part-sold
       position's `pnl` carries unrealised money, and the curve must step on
       what actually arrived. */
    bankedEvents(t).map((e) => ({
      id: t.id, entry_date: t.entry_date, exit_date: e.date,
      pnl: e.pnl, r: e.r, charges: e.charge,
    }))
  ).sort((a, b) => {
    const x = a.exit_date || a.entry_date, y = b.exit_date || b.entry_date;
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const fl = [...flows]
    .map((f) => ({ d: new Date(f.flow_date), a: Number(f.amount) }))
    .filter((f) => isFinite(f.a))
    .sort((a, b) => a.d - b.d);

  let equity = Number(openingCapital) || 0;
  let fi = 0;
  const points = [];

  // Any capital that arrived before the first trade is part of the base
  const firstDate = rows.length ? new Date(rows[0].exit_date || rows[0].entry_date) : new Date();
  while (fi < fl.length && fl[fi].d <= firstDate) { equity += fl[fi].a; fi++; }

  const base = equity;
  let peak = equity, maxDD = 0, maxDDPct = 0;

  for (const t of rows) {
    const when = new Date(t.exit_date || t.entry_date);
    while (fi < fl.length && fl[fi].d <= when) {
      equity += fl[fi].a;
      peak = Math.max(peak, equity);   // fresh capital isn't a recovery, but it does raise the bar
      fi++;
    }
    if (isFinite(t.pnl)) equity += t.pnl;

    peak = Math.max(peak, equity);
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
    if (peak > 0 && dd / peak > maxDDPct) maxDDPct = dd / peak;

    points.push({ id: t.id, date: when, equity, pnl: t.pnl, r: t.r });
  }

  while (fi < fl.length) { equity += fl[fi].a; fi++; }

  return {
    points, base, final: equity,
    maxDD, maxDDPct: maxDDPct * 100,
    netPnl: rows.reduce((s, t) => s + (isFinite(t.pnl) ? t.pnl : 0), 0),
    charges: rows.reduce((s, t) => s + (Number(t.charges) || 0), 0),
    capitalIn: fl.reduce((s, f) => s + (f.a > 0 ? f.a : 0), 0),
  };
}

/* -------------------- Indian financial year helpers ------------------ */

/**
 * THE YEAR AND MONTH, READ WITHOUT A TIMEZONE.
 *
 * Everything below takes either a Date — callers asking about TODAY — or a
 * stored "YYYY-MM-DD", which is what every trade carries. The string form must
 * not go through Date: `new Date("2025-04-01")` is UTC midnight and every
 * getter reads it back LOCAL, so west of Greenwich the first day of a
 * financial year lands in the previous one, the first of a month in the month
 * before, and a trade closed on 1 April is filed under the wrong year for the
 * life of the journal.
 *
 * format.js has carried that warning against `dmy` for a long time and these
 * helpers did not heed it. India is east of UTC so nothing was visibly wrong
 * here, which is exactly why it survived: a bug that only appears for somebody
 * else's timezone is one nobody in the room ever sees.
 */
function ymOf(date) {
  if (typeof date === "string") {
    const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
    if (y > 0 && m >= 1 && m <= 12) return { y, m };
  }
  const d = new Date(date);
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}

/** FY starts in April. Returns the calendar year the FY began in. */
export function fyStartYear(date) {
  const { y, m } = ymOf(date);
  return m >= 4 ? y : y - 1;
}

/** Q1 = Apr–Jun, Q2 = Jul–Sep, Q3 = Oct–Dec, Q4 = Jan–Mar. */
export function fyQuarter(date) {
  const { m } = ymOf(date);
  return Math.floor(((m - 1 + 9) % 12) / 3) + 1;
}

export const fyLabel = (date) => {
  const y = fyStartYear(date);
  return `FY${String(y + 1).slice(2)}`;
};

export const quarterLabel = (date) => `${fyLabel(date)} Q${fyQuarter(date)}`;

/**
 * Not toLocaleDateString, for two reasons at once.
 *
 * It reads a parsed date in the local zone, so it carries the same bug as the
 * helpers above. And its month names are ICU's: "Sept" under some builds and
 * "Sep" under others, four letters where every date in the tables says three,
 * and a value that can differ between the server and the browser — which is
 * one of the causes React lists for a hydration mismatch. This label is also a
 * BUCKET KEY, so two spellings would split one month into two rows.
 */
export const monthLabel = (date) => {
  const { y, m } = ymOf(date);
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
};

const realisedOn = (t) => t.exit_date || t.entry_date;

/**
 * The calendar boundary a period actually begins on — not the date of its
 * first trade. Capital arriving on the 3rd was available to a month whose
 * first trade closed on the 20th, and pretending otherwise distorts the
 * return of every month you funded.
 *
 * FY quarters share calendar-quarter boundaries (Apr-Jun, Jul-Sep, Oct-Dec,
 * Jan-Mar); only the labelling differs, so flooring the month to a multiple
 * of three is correct for both.
 */
function periodStartOf(dateStr, grain) {
  /* Read off the text, then built as a LOCAL date — this is compared against
     capital-flow dates and is not a label, so it has to be a real Date. What
     it must not do is take its year and month from a UTC-parsed string. */
  const { y, m } = ymOf(dateStr);
  const mi = m - 1;
  if (grain === "month") return new Date(y, mi, 1);
  if (grain === "quarter") return new Date(y, Math.floor(mi / 3) * 3, 1);
  return new Date(fyStartYear(dateStr), 3, 1);    // financial year: 1 April
}

/**
 * Group closed trades into periods and compute both the R view and the rupee
 * view for each. `openingCapital` lets each period report a return on the
 * capital it actually started with rather than on today's balance.
 */
/**
 * `basis` decides what a period means.
 *
 *   "exit"  — when the money was realised. The accounting view: it matches
 *             the equity curve, reconciles with a broker statement, and is
 *             the only basis on which return %, drawdown and the capital
 *             walk mean anything.
 *
 *   "entry" — when the decision was taken. The diagnostic view: it groups a
 *             month's trades by the conditions you entered them in, which is
 *             what setup quality and market regime are actually about. A
 *             March entry closed in July belongs to March here.
 *
 * On the entry basis the equity walk is skipped rather than faked. Crediting
 * March with money that arrived in July would make every percentage on the
 * row a fiction, and drawdown computed over entry order isn't an equity path
 * at all — both come back null so a caller can't render them by accident.
 */
export function byPeriod(
  closed,
  grain,
  { openingCapital = 0, flows = [], basis = "exit", universe = null } = {}
) {
  const label = grain === "month" ? monthLabel : grain === "quarter" ? quarterLabel : fyLabel;
  const byEntry = basis === "entry";
  const dateOf = byEntry ? (t) => t.entry_date : realisedOn;
  const rows = byEntry
    ? [...closed].sort((a, b) => new Date(a.entry_date) - new Date(b.entry_date))
    : chronological(closed);

  // How many trades were STARTED in each period, closed or not. Without this
  // a recent month shows only the entries that have already finished, which
  // skews toward whichever ones you exit fastest — and reads as a change in
  // performance rather than the artefact it is.
  const startedIn = new Map();
  if (byEntry && universe) {
    for (const t of universe) {
      if (!t.entry_date) continue;
      const k = label(t.entry_date);
      startedIn.set(k, (startedIn.get(k) || 0) + 1);
    }
  }

  /**
   * ON THE EXIT BASIS A PERIOD HOLDS REALISATIONS, NOT TRADES.
   *
   * `exit_date` is a position's LAST tranche, so grouping by it credited a
   * position sold across a boundary entirely to the later period. Measured on
   * a real book: ₹5.77 lakh net in the wrong financial year across 48
   * tranches. The all-time totals were right the whole time — only the buckets
   * were wrong, which is the kind of wrong that survives a reconciliation.
   *
   * So each SELL is its own event, carrying its own money and its own R, and
   * lands in the period it actually happened in. `realisationEvents` splits
   * them so they sum back to the position exactly.
   *
   * EVERY COLUMN MOVES WITH IT, deliberately. Leaving the count and the win
   * rate keyed to the final exit would put two populations on one row — money
   * describing sells, everything else describing positions — which is the
   * confusion this change exists to remove. So `trades` becomes the number of
   * DISTINCT POSITIONS that realised money in the period, and a position sold
   * across a boundary is counted in both. The column no longer sums to the
   * book's trade count across periods, and that is the honest answer rather
   * than a rounding error: the position really was in both years.
   *
   * The ENTRY basis is untouched. It groups by when a decision was taken, and
   * a decision happens once — splitting it across the sells that followed
   * would be meaningless.
   */
  const buckets = new Map();
  const put = (k, when, t, pnl, r, charge) => {
    if (!buckets.has(k)) {
      buckets.set(k, { key: k, first: when, trades: [], seen: new Set(), events: [] });
    }
    const b = buckets.get(k);
    if (when < b.first) b.first = when;
    if (!b.seen.has(t.id)) { b.seen.add(t.id); b.trades.push(t); }
    b.events.push({ trade: t, when, pnl, r, charge });
  };

  for (const t of rows) {
    if (byEntry) {
      /* Realised, never `pnl`. Grouping by entry date asks what positions
         opened in this period have made, and on a part-sold one `pnl` folds
         in the mark on shares still held — which is not something the period
         produced, and would move every time a quote refreshed. */
      const p = isFinite(t.realisedPnl) ? t.realisedPnl : t.pnl;
      const rr = isFinite(t.realisedR) ? t.realisedR : t.r;
      put(label(t.entry_date), t.entry_date, t, p, rr, n(t.charges) || 0);
      continue;
    }
    /* The same helper the equity curve uses, so the two cannot disagree about
       what a part-sold position has banked. It carries its own fallback for a
       legacy row whose exits never landed, which keeps that row in the table
       rather than vanishing. */
    const events = bankedEvents(t);
    for (const e of events) put(label(e.date), e.date, t, e.pnl, e.r, e.charge);
  }

  // Walk periods in order, carrying equity forward so each % return is on the
  // capital in play at the time
  const fl = [...flows]
    .map((f) => ({ d: new Date(f.flow_date), a: Number(f.amount) }))
    .sort((a, b) => a.d - b.d);

  let equity = Number(openingCapital) || 0;
  let fi = 0;
  const out = [];

  for (const b of [...buckets.values()].sort((a, b) => new Date(a.first) - new Date(b.first))) {
    const periodStart = periodStartOf(b.first, grain);
    const periodEnd = new Date(b.trades[b.trades.length - 1].exit_date || b.first);

    // Capital that arrived BEFORE this period is part of what the period had
    // to work with. Capital that arrives DURING it is not — counting it in the
    // opening balance would understate the return of every month you topped
    // the account up in.
    while (fi < fl.length && fl[fi].d < periodStart) { equity += fl[fi].a; fi++; }

    const opening = equity;

    let inflow = 0;
    while (fi < fl.length && fl[fi].d <= periodEnd) { inflow += fl[fi].a; fi++; }
    equity += inflow;
    /**
     * ROLLED UP TO THE POSITION FIRST, then measured.
     *
     * A position that sold twice inside one period is one result there, not
     * two — so win rate answers "did this position make money in this period",
     * which is a question about a trade, rather than "was this sell green",
     * which is a question about an order and would count scaling out of a
     * winner as several wins.
     *
     * Summing the parts first also keeps totalR identical either way, so the
     * R column is unchanged by the rollup and only its bucketing moved.
     */
    const perPosition = new Map();
    for (const e of b.events) {
      const cur = perPosition.get(e.trade.id)
        || { pnl: 0, r: 0, hasR: false, exit_date: e.when, entry_date: e.trade.entry_date };
      if (isFinite(e.pnl)) cur.pnl += e.pnl;
      if (isFinite(e.r)) { cur.r += e.r; cur.hasR = true; }
      if (e.when > cur.exit_date) cur.exit_date = e.when;
      perPosition.set(e.trade.id, cur);
    }
    const results = [...perPosition.values()].map((x) => ({
      /* NaN rather than 0 where no tranche had an R — stats() filters on
         isFinite, and a zero here would enter a stopless position into the
         win rate as a loss. */
      r: x.hasR ? x.r : NaN,
      pnl: x.pnl,
      exit_date: x.exit_date,
      entry_date: x.entry_date,
    }));

    const s = stats(results);
    const pnl = results.reduce((a, x) => a + (isFinite(x.pnl) ? x.pnl : 0), 0);
    /* Summed over the EVENTS rather than the rolled-up positions, because a
       charge belongs to a sell — two sells in one period are two charges, and
       rolling them up first would have lost that distinction for no reason. */
    const charges = b.events.reduce((a, e) => a + (isFinite(e.charge) ? e.charge : 0), 0);
    /* Position-level facts, so averaged over the distinct positions in the
       period rather than over the sells — a position sold four times did not
       have four position sizes. */
    const value = b.trades.reduce((a, t) => a + (isFinite(t.exposure) ? t.exposure : 0), 0);
    const risk = b.trades.reduce((a, t) => a + (isFinite(t.riskAmt) ? t.riskAmt : 0), 0);
    equity += pnl;

    // Deliberately null rather than a number on the entry basis: these three
    // describe money moving through the account, and this basis has grouped
    // the trades by when they were decided, not when they paid out.
    const accounting = !byEntry;

    out.push({
      ...s,
      key: b.key,
      basis,
      trades: b.trades.length,
      // Entries started in this period vs how many have finished. Only the
      // closed ones can carry an R, so the gap is what the row can't see yet.
      started: byEntry ? startedIn.get(b.key) ?? b.trades.length : null,
      settled: byEntry ? b.trades.length : null,
      pnl,
      charges,
      opening: accounting ? opening : null,
      capitalIn: accounting ? inflow : null,
      returnPct: accounting && opening > 0 ? (pnl / opening) * 100 : null,
      maxDD: accounting ? s.maxDD : null,
      avgValue: b.trades.length ? value / b.trades.length : NaN,
      avgRisk: b.trades.length ? risk / b.trades.length : NaN,
      avgRiskPct: accounting && opening > 0 && b.trades.length
        ? (risk / b.trades.length / opening) * 100
        : null,
    });
  }
  return out;
}

/** How many periods finished green — the "14/18 green months" figure. */
export function greenCount(closed, grain, opts) {
  const p = byPeriod(closed, grain, opts);
  return { green: p.filter((x) => x.pnl > 0).length, total: p.length };
}

/**
 * Everything the dashboard headline block shows, in one pass.
 */
export function headline(closed, { openingCapital = 0, flows = [], banking = null } = {}) {
  const rows = closed || [];
  /**
   * TWO POPULATIONS, ON PURPOSE.
   *
   * `rows` is finished positions and answers what KIND of trader this is —
   * win rate, expectancy, payoff, hold time. A position sold down but not out
   * has no verdict yet: the part still running can give it all back, and
   * counting it now as a win would flatter every one of those figures.
   *
   * `money` is every position that has banked something, finished or not, and
   * answers how much arrived. That question does not wait for the rest of the
   * position — the cash is in the account either way, and leaving it out made
   * the Dashboard read lower than the Holdings strip for the same book.
   *
   * Only the equity curve reads `money`, which is exactly the figures that
   * should move: net P&L, charges, return on capital, drawdown.
   */
  const money = banking?.length ? banking : rows;
  // Gate on having closed anything at all, not on having a stop for it.
  // Money, win rate by count, hold time and the rest are all knowable
  // without one — dropping them because R is missing hides real facts and
  // makes a freshly imported journal look empty when it isn't.
  if (!rows.length) return { n: 0 };

  const s = stats(rows);                       // R figures, over whatever has a stop
  const eq = equityCurve(money, { openingCapital, flows });
  const holds = rows.map((t) => t.heldDays).filter(isFinite);

  // Return on the capital that was actually committed, not on today's balance
  const capitalBase = eq.base + eq.capitalIn || Number(openingCapital) || NaN;

  // Percentage return per trade — the honest stand-in for R while stops are
  // missing. Unlike R it says nothing about risk taken, only about outcome.
  const pcts = rows
    .map((t) => {
      const cost = n(t.entry_price) * n(t.quantity);
      return cost > 0 && isFinite(t.pnl) ? (t.pnl / cost) * 100 : NaN;
    })
    .filter(isFinite);
  const gains = pcts.filter((p) => p > 0);
  const drops = pcts.filter((p) => p <= 0);

  const decided = rows.filter((t) => isFinite(t.pnl));
  const wonByCount = decided.filter((t) => t.pnl > 0).length;

  /**
   * What a trade actually put at risk, in money — the bridge between the
   * rupee figures and the R ones.
   *
   * MEASURED, NOT INFERRED. The tempting shortcut is netPnl ÷ totalR, which
   * also lands on "rupees per R" and needs no new arithmetic. It is a
   * different number: it weights each trade by how far it ran, so one 17R
   * winner taken on an oversized position drags it well away from what a
   * typical trade risked.
   *
   * (An earlier note here claimed the quotient also folded charges in, on the
   * grounds that netPnl is after them and R is not. That was simply wrong — r
   * is pnl / riskAmt and pnl is already net, so R is after charges too. The
   * conclusion stands on the weighting alone.)
   *
   * The two differ by exactly n × covariance(R, risk): multiplying this
   * average by total R returns net P&L only when every trade risked the same.
   * The mean of what was actually staked answers the question that was asked.
   *
   * Only over trades carrying a real risk figure. Free shares have no stop to
   * divide by and never will, and averaging a zero in for them would report a
   * smaller typical bet than was ever placed.
   */
  const riskAmts = rows.map((t) => t.riskAmt).filter((v) => isFinite(v) && v > 0);
  const avgRisk = riskAmts.length
    ? riskAmts.reduce((a, b) => a + b, 0) / riskAmts.length : NaN;

  /**
   * How much 1R itself has varied — the caveat under every R figure here.
   *
   * R is only a unit while it means the same thing each time. On an account
   * that has compounded it does not: risk grows with the balance, so a +2R
   * from two years ago and a +2R from last month are different amounts of
   * money, and total R adds them as though they were the same. That is not a
   * fault — sizing up as the account grows is correct — but it is the most
   * important thing left unsaid about the R band.
   *
   * TENTH AND NINETIETH PERCENTILE, not min and max. One unusually small
   * position would otherwise report a four-fold spread on an otherwise
   * disciplined record, and the figure is there to describe the habit rather
   * than to find its extremes.
   */
  const sortedRisk = [...riskAmts].sort((a, b) => a - b);
  const at = (q) => sortedRisk.length
    ? sortedRisk[Math.min(sortedRisk.length - 1, Math.floor(sortedRisk.length * q))]
    : NaN;
  const riskLo = at(0.1), riskHi = at(0.9);

  return {
    ...s,
    // Overrides the count stats() reports, which only counts what had a stop.
    n: rows.length,
    nWithR: s.n || 0,
    /**
     * Trades whose R is missing and could be supplied.
     *
     * Inferred from "has no R", which used to be the same question. It isn't
     * any more: shares that arrived free have no R and never will, because
     * there was no risk to divide by. Counting them here would nag about a
     * stop forever, and send the reader to a page that has correctly decided
     * they don't belong on it.
     */
    nNeedStop: rows.filter(
      (t) => !isFinite(t.r) && t.acquisition !== "bonus"
    ).length,
    nFree: rows.filter((t) => t.acquisition === "bonus").length,

    avgRisk,
    riskLo, riskHi,
    /* Below this the spread is not worth mentioning, and saying it anyway
       would nag a trader whose sizing is consistent — which is the behaviour
       being asked for. 1.5x is about where "1R means the same thing" stops
       being true enough to leave unqualified. */
    riskVaries: isFinite(riskLo) && isFinite(riskHi) && riskLo > 0
      && riskHi / riskLo >= 1.5,
    /* Against the capital that was committed, the same base the return
       percentage uses — so "0.20% a trade" and "19.5% overall" are quoted
       against the same denominator and can be read together. */
    avgRiskPct: isFinite(avgRisk) && capitalBase > 0 ? (avgRisk / capitalBase) * 100 : NaN,
    nWithRisk: riskAmts.length,

    winRateByCount: decided.length ? (wonByCount / decided.length) * 100 : NaN,
    avgGainPct: gains.length ? gains.reduce((a, b) => a + b, 0) / gains.length : NaN,
    avgLossPct: drops.length ? drops.reduce((a, b) => a + b, 0) / drops.length : NaN,

    netPnl: eq.netPnl,
    charges: eq.charges,
    returnOnCapital: capitalBase > 0 ? (eq.netPnl / capitalBase) * 100 : NaN,
    maxDDPct: eq.maxDDPct,
    maxDDAmt: eq.maxDD,
    avgHold: holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : NaN,
    months: greenCount(closed, "month", { openingCapital, flows }),
    quarters: greenCount(closed, "quarter", { openingCapital, flows }),
    equity: eq,
  };
}
