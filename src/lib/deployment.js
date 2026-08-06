/**
 * How much of the account was actually in the market, day by day.
 *
 * A journal measured in R answers "was the decision good". It does not answer
 * "was the money working", and those come apart badly: a run of 2R winners
 * taken with a tenth of the account is a good system barely used. This file
 * builds the second answer.
 *
 * WHAT IS BEING MEASURED
 *
 * Deployed capital at cost — entry price × quantity still held. Not market
 * value. The app keeps one cached mark per open position and no price history
 * at all, so a market-value series backwards through time is not something
 * this data can support; inventing one would mean carrying today's price back
 * over eighteen months. Cost is also the more honest reading of "how much of
 * my money was committed", because it is the number that actually left the
 * bank.
 *
 * THE DENOMINATOR IS NOT A CONSTANT
 *
 * Deployment as a percentage is measured against the capital that existed on
 * that date — opening capital, plus flows that had arrived, plus P&L realised
 * up to then. Against a fixed present-day figure every early period reads as
 * under-deployed for the sole reason that the money had not turned up yet,
 * and every recent one is flattered by profits the early trades had not made.
 * For an account funded once and never added to, the two agree at the start
 * and diverge by exactly the compounding.
 *
 * CALENDAR DAYS, NOT TRADING DAYS
 *
 * There is no market calendar in this app and inventing one from weekday
 * arithmetic would be wrong about every Diwali. Capital committed on a Friday
 * is still committed on the Sunday, so carrying the value across is not a
 * distortion. It does mean the averages here are per calendar day.
 *
 * WHAT IT CANNOT SEE
 *
 * A position the journal never recorded deploys nothing. Broker tax P&L files
 * carry closed trades only, so anything held across the edge of an import
 * leaves a dip in this series that never happened in the account. That is a
 * gap in the record, not a finding, and the UI says so where it shows.
 */

const n = (v) => (v === "" || v == null ? NaN : Number(v));
const DAY = 86400000;

/** YYYY-MM-DD in local terms — the same shape the DB stores dates in. */
export function dayKey(d) {
  const x = new Date(d);
  if (!isFinite(+x)) return null;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(
    x.getDate()
  ).padStart(2, "0")}`;
}

const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Bands trades are grouped into by how committed the account was at entry.
 *
 * Fixed fractions of capital rather than fixed rupee amounts, so the same
 * bands mean the same thing to a ₹2L account and a ₹2Cr one. Quantile bands
 * would be wrong here for once: the question is "did a fuller book pay
 * better", and adaptive cuts would define "full" relative to your own habit,
 * which is the thing being examined.
 */
export const DEPLOY_BANDS = [
  { max: 10, label: "under 10%" },
  { max: 25, label: "10–25%" },
  { max: 40, label: "25–40%" },
  { max: 55, label: "40–55%" },
  { max: 70, label: "55–70%" },
  { max: 85, label: "70–85%" },
  { max: Infinity, label: "over 85%" },
];

const bandOf = (pct) => DEPLOY_BANDS.findIndex((b) => pct < b.max);

/**
 * Every change in committed capital, as dated events.
 *
 * Entry puts the whole position on. Each exit tranche takes off the cost of
 * the shares it sold — at ENTRY price, since that is what was committed —
 * and releases its share of the risk. Positions are counted as open until the
 * last tranche closes them.
 *
 * Trades with a zero entry price (bonus shares, demerger apportionments) put
 * no capital in and correctly move nothing here.
 */
function events(positions) {
  const out = [];

  for (const t of positions) {
    const entry = n(t.entry_price);
    const qty = n(t.quantity);
    if (!isFinite(entry) || !isFinite(qty) || qty <= 0) continue;
    const enteredOn = dayKey(t.entry_date);
    if (!enteredOn) continue;

    // 1R on the whole position, the same number positions.js pins at entry.
    const riskPerShare = isFinite(t.riskPerShare)
      ? t.riskPerShare
      : Math.abs(entry - n(t.stop_loss));
    const riskAll = isFinite(riskPerShare) ? riskPerShare * qty : 0;

    out.push({
      d: enteredOn,
      cost: entry * qty,
      risk: riskAll,
      count: 1,
      pnl: 0,
    });

    const exits = Array.isArray(t.exits) ? t.exits : [];
    const totalCharges =
      (n(t.charges) || 0) +
      exits.reduce((s, e) => s + (n(e.charges) || 0), 0);
    const dir = t.side === "short" ? -1 : 1;

    let left = qty;
    exits.forEach((e, i) => {
      const q = Math.min(n(e.quantity) || 0, left);
      if (!(q > 0)) return;
      const on = dayKey(e.exit_date);
      if (!on) return;
      left -= q;

      // Charges spread across tranches by size. The alternative — landing the
      // whole cost on the last one — makes the equity walk step down at the
      // end of a scaled exit rather than through it.
      const share = qty > 0 ? q / qty : 0;
      const gross = (n(e.price) - entry) * dir * q;

      out.push({
        d: on,
        cost: -(entry * q),
        risk: -(riskAll * share),
        count: left <= 1e-6 ? -1 : 0,
        pnl: (isFinite(gross) ? gross : 0) - totalCharges * share,
      });
    });
  }

  return out;
}

/**
 * The daily walk.
 *
 * `positions` are rows that have been through `derivePosition` — they carry
 * the normalised `exits` array and the entry-pinned `riskPerShare`.
 */
export function deploymentSeries(
  positions,
  { openingCapital = 0, flows = [], asOf = new Date() } = {}
) {
  const evs = events(positions || []);
  if (!evs.length) return null;

  const byDay = new Map();
  for (const e of evs) {
    const acc = byDay.get(e.d) || { cost: 0, risk: 0, count: 0, pnl: 0 };
    acc.cost += e.cost;
    acc.risk += e.risk;
    acc.count += e.count;
    acc.pnl += e.pnl;
    byDay.set(e.d, acc);
  }

  const fl = (flows || [])
    .map((f) => ({ d: dayKey(f.flow_date), a: Number(f.amount) }))
    .filter((f) => f.d && isFinite(f.a))
    .sort((a, b) => (a.d < b.d ? -1 : 1));

  const keys = [...byDay.keys()].sort();
  const start = keys[0];
  const endKey = dayKey(asOf);
  const end = endKey && endKey > keys[keys.length - 1] ? endKey : keys[keys.length - 1];

  // Capital that arrived before the first trade is part of the base, not a
  // top-up — the same rule equityCurve uses, so the two agree on day one.
  let capital = Number(openingCapital) || 0;
  let fi = 0;
  while (fi < fl.length && fl[fi].d <= start) { capital += fl[fi].a; fi++; }

  let deployed = 0, risk = 0, count = 0;
  const days = [];

  for (let t = +new Date(start); t <= +new Date(end); t += DAY) {
    const k = dayKey(t);
    while (fi < fl.length && fl[fi].d <= k) { capital += fl[fi].a; fi++; }

    const mv = byDay.get(k);
    if (mv) {
      deployed += mv.cost;
      risk += mv.risk;
      count += mv.count;
      capital += mv.pnl;
    }

    // Float noise accumulates across a few thousand additions and subtractions
    // and leaves a position "open" at 1e-11 rupees.
    if (Math.abs(deployed) < 1) deployed = 0;
    if (Math.abs(risk) < 1) risk = 0;
    if (count < 0) count = 0;

    days.push({
      d: k,
      deployed,
      risk,
      count,
      capital,
      pct: capital > 0 ? (deployed / capital) * 100 : NaN,
      riskPct: capital > 0 ? (risk / capital) * 100 : NaN,
    });
  }

  /* ---- summary ------------------------------------------------------ */
  const dep = days.map((x) => x.deployed);
  const pcts = days.map((x) => x.pct).filter(isFinite);
  let peak = days[0];
  for (const x of days) if (x.deployed > peak.deployed) peak = x;
  let peakPct = days[0];
  for (const x of days) if (isFinite(x.pct) && x.pct > (peakPct.pct || 0)) peakPct = x;

  const counts = days.map((x) => x.count);
  let busiest = days[0];
  for (const x of days) if (x.count > busiest.count) busiest = x;

  const sizes = (positions || [])
    .map((t) => n(t.entry_price) * n(t.quantity))
    .filter((v) => isFinite(v) && v > 0);

  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

  /* ---- by month ------------------------------------------------------ */
  //
  // A month of a daily step series, averaged. Not a second source of truth —
  // every figure here is a mean of the days above it — but a month is the
  // grain people actually think in, and the daily line is too busy to read a
  // trend off at a glance.
  const mMap = new Map();
  for (const x of days) {
    const k = x.d.slice(0, 7);
    const m = mMap.get(k) || { key: k, dep: [], pct: [], cnt: [], risk: [] };
    m.dep.push(x.deployed);
    if (isFinite(x.pct)) m.pct.push(x.pct);
    m.cnt.push(x.count);
    if (isFinite(x.riskPct)) m.risk.push(x.riskPct);
    mMap.set(k, m);
  }
  const months = [...mMap.values()].map((m) => ({
    key: m.key,
    avgDeployed: avg(m.dep),
    maxDeployed: Math.max(...m.dep),
    minDeployed: Math.min(...m.dep),
    avgPct: avg(m.pct),
    avgCount: avg(m.cnt),
    maxCount: Math.max(...m.cnt),
    avgRiskPct: avg(m.risk),
  }));

  const last = days[days.length - 1];

  return {
    days,
    months,
    from: start,
    to: end,
    dayCount: days.length,
    peak,          // most rupees committed
    peakPct,       // largest share of capital committed — not always the same day
    busiest,
    current: last,
    avgDeployed: avg(dep),
    medianDeployed: median(dep),
    avgPct: avg(pcts),
    medianPct: median(pcts),
    avgCash: avg(days.map((x) => Math.max(0, x.capital - x.deployed))),
    avgCount: avg(counts),
    avgRiskPct: avg(days.map((x) => x.riskPct).filter(isFinite)),
    peakRiskPct: Math.max(...days.map((x) => x.riskPct).filter(isFinite), 0),
    avgPositionSize: avg(sizes),
    positionsCounted: sizes.length,
  };
}

/**
 * Did deploying more actually earn more?
 *
 * The question the deployment chart provokes and cannot answer on its own.
 * Each closed trade is tagged with how deployed the account was on the day it
 * was ENTERED — the state of the book when the decision was taken — and the R
 * that came out is grouped by that band.
 *
 * Entry, not exit, for the same reason `emotionOutcomes` matches on entry: it
 * is a question about the decision, and the exit happens in a different world.
 *
 * Deliberately returns counts alongside the R so a band holding four trades
 * cannot be read as a verdict. `THIN` mirrors edge.js.
 */
export const THIN_DEPLOY_SLICE = 10;

export function deploymentOutcomes(closed, series) {
  if (!series?.days?.length) return [];
  const onDay = new Map(series.days.map((x) => [x.d, x]));

  // Both edges of the band, not just the top. The UI needs the lower bound to
  // print the band as a span, and deriving it there by peeking at the previous
  // row breaks the moment an empty band is filtered out.
  const rows = DEPLOY_BANDS.map((b, i) => ({
    key: b.label,
    min: i === 0 ? 0 : DEPLOY_BANDS[i - 1].max,
    max: b.max,
    n: 0,
    wins: 0,
    totalR: 0,
    rs: [],
  }));

  for (const t of closed || []) {
    const k = dayKey(t.entry_date);
    const day = k != null ? onDay.get(k) : undefined;
    if (!day || !isFinite(day.pct)) continue;
    const i = bandOf(day.pct);
    if (i < 0) continue;
    const r = Number(t.r);
    if (!isFinite(r)) continue;
    rows[i].n++;
    rows[i].rs.push(r);
    rows[i].totalR += r;
    if (r > 0) rows[i].wins++;
  }

  return rows
    .filter((r) => r.n > 0)
    .map((r) => ({
      ...r,
      expectancy: r.totalR / r.n,
      winRate: (r.wins / r.n) * 100,
      isThin: r.n < THIN_DEPLOY_SLICE,
    }));
}
