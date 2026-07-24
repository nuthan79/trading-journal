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
