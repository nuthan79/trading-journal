/**
 * Every number the journal reports. Pure functions, no I/O — so this file is
 * also the one worth writing tests against.
 */

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

  let heldDays = NaN;
  if (t.entry_date) {
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

  let cw = 0, cl = 0, bestW = 0, worstL = 0;
  for (const x of rs) {
    if (x > 0) { cw++; cl = 0; bestW = Math.max(bestW, cw); }
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
  const rows = chronological(closed);
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

/** FY starts in April. Returns the calendar year the FY began in. */
export function fyStartYear(date) {
  const d = new Date(date);
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

/** Q1 = Apr–Jun, Q2 = Jul–Sep, Q3 = Oct–Dec, Q4 = Jan–Mar. */
export function fyQuarter(date) {
  const m = new Date(date).getMonth();
  return Math.floor(((m + 9) % 12) / 3) + 1;
}

export const fyLabel = (date) => {
  const y = fyStartYear(date);
  return `FY${String(y + 1).slice(2)}`;
};

export const quarterLabel = (date) => `${fyLabel(date)} Q${fyQuarter(date)}`;

export const monthLabel = (date) =>
  new Date(date).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });

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
  const d = new Date(dateStr);
  const y = d.getFullYear(), m = d.getMonth();
  if (grain === "month") return new Date(y, m, 1);
  if (grain === "quarter") return new Date(y, Math.floor(m / 3) * 3, 1);
  return new Date(fyStartYear(d), 3, 1);          // financial year: 1 April
}

/**
 * Group closed trades into periods and compute both the R view and the rupee
 * view for each. `openingCapital` lets each period report a return on the
 * capital it actually started with rather than on today's balance.
 */
export function byPeriod(closed, grain, { openingCapital = 0, flows = [] } = {}) {
  const label = grain === "month" ? monthLabel : grain === "quarter" ? quarterLabel : fyLabel;
  const rows = chronological(closed);

  const buckets = new Map();
  for (const t of rows) {
    const k = label(realisedOn(t));
    if (!buckets.has(k)) buckets.set(k, { key: k, first: realisedOn(t), trades: [] });
    buckets.get(k).trades.push(t);
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
    const s = stats(b.trades);
    const pnl = b.trades.reduce((a, t) => a + (isFinite(t.pnl) ? t.pnl : 0), 0);
    const value = b.trades.reduce((a, t) => a + (isFinite(t.exposure) ? t.exposure : 0), 0);
    const risk = b.trades.reduce((a, t) => a + (isFinite(t.riskAmt) ? t.riskAmt : 0), 0);
    equity += pnl;

    out.push({
      ...s,
      key: b.key,
      trades: b.trades.length,
      pnl,
      opening,
      capitalIn: inflow,
      returnPct: opening > 0 ? (pnl / opening) * 100 : NaN,
      avgValue: b.trades.length ? value / b.trades.length : NaN,
      avgRisk: b.trades.length ? risk / b.trades.length : NaN,
      avgRiskPct: opening > 0 && b.trades.length ? (risk / b.trades.length / opening) * 100 : NaN,
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
export function headline(closed, { openingCapital = 0, flows = [] } = {}) {
  const rows = closed || [];
  // Gate on having closed anything at all, not on having a stop for it.
  // Money, win rate by count, hold time and the rest are all knowable
  // without one — dropping them because R is missing hides real facts and
  // makes a freshly imported journal look empty when it isn't.
  if (!rows.length) return { n: 0 };

  const s = stats(rows);                       // R figures, over whatever has a stop
  const eq = equityCurve(rows, { openingCapital, flows });
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

  return {
    ...s,
    // Overrides the count stats() reports, which only counts what had a stop.
    n: rows.length,
    nWithR: s.n || 0,
    nNeedStop: rows.length - (s.n || 0),

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
