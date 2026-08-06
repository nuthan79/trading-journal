"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { deploymentSeries, deploymentOutcomes, THIN_DEPLOY_SLICE } from "@/lib/deployment";
import { rupee, rfmt, pct, dmy } from "@/lib/format";

/**
 * Capital deployment — how much of the account was in the market, and when.
 *
 * The journal answers whether each decision was good. This answers whether the
 * money was working, which is a different question with a different failure
 * mode: a run of clean 2R winners taken with a tenth of the account is a good
 * system barely used.
 *
 * WHAT THIS SCREEN DELIBERATELY DOES NOT DO
 *
 * It does not tell you to deploy more. The arithmetic that says otherwise —
 * headline return divided by average deployment, presented as the "real" edge
 * — is a division rather than a discovery, and it double counts: capital
 * rotates, so money that funded three sequential trades sits in the
 * denominator once and earns three times. It also assumes the trade you did
 * not take would have paid like the average of the ones you did, which is
 * exactly what a system that stands aside in bad conditions is denying.
 *
 * Cash is a position. So the screen measures the cash calls instead of
 * grading them: the band table at the bottom shows what your own R did at
 * each level of deployment, and lets that answer the question.
 */

const CAP_MONEY = "cd";                       // unique prefix — see the styled-jsx note in CLAUDE.md

/**
 * Gridline values that land on round money.
 *
 * Dividing the maximum into equal fifths gives ticks like ₹1.68 Cr, and
 * `inr()` renders that at zero decimals as "₹2 Cr" — an axis label a third
 * above the line it sits on. Stepping by 1 / 2 / 2.5 / 5 × a power of ten
 * instead means every label is exact at the precision it prints.
 */
/**
 * The index point on or before `day`, by binary search over an ascending list.
 *
 * An exact-date lookup finds nothing on a weekend or a market holiday, and the
 * deployment series runs on calendar days — so about a third of the time the
 * readout silently lost its index reading. Carrying the last close forward is
 * also the truthful answer: on a Sunday the market stands where it closed on
 * Friday.
 */
function lastAtOrBefore(points, day) {
  if (!day || !points?.length) return null;
  let lo = 0, hi = points.length - 1, found = null;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (points[m].d <= day) { found = points[m]; lo = m + 1; }
    else hi = m - 1;
  }
  return found;
}

function niceTicks(max, target = 4) {
  if (!(max > 0)) return [0];
  const mag = Math.pow(10, Math.floor(Math.log10(max / target)));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= max / target) || 10 * mag;
  const out = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Index history — fetched lazily, and entirely optional              */
/* ------------------------------------------------------------------ */

const INDEX_CHOICES = [
  { id: "nifty500", label: "Nifty 500" },
  { id: "nifty50", label: "Nifty 50" },
  { id: "midcap", label: "Midcap 50" },
  { id: "none", label: "None" },
];

function useIndexHistory(index, from, to) {
  const [state, setState] = useState({ points: [], loading: false, error: null });

  useEffect(() => {
    if (index === "none" || !from || !to) {
      setState({ points: [], loading: false, error: null });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));

    fetch(`/api/index-history?index=${index}&from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setState({ points: d.points || [], loading: false, error: d.error || null });
      })
      .catch((e) => alive && setState({ points: [], loading: false, error: e.message }));

    return () => { alive = false; };
  }, [index, from, to]);

  return state;
}

/* ------------------------------------------------------------------ */

export default function CapitalDeployment({ all = [], closed = [], accountSize = 0, flows = [] }) {
  const box = useRef(null);
  const [w, setW] = useState(900);
  const [hov, setHov] = useState(null);
  const [index, setIndex] = useState("nifty500");

  useEffect(() => {
    const on = () => box.current && setW(box.current.clientWidth);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const S = useMemo(
    () => deploymentSeries(all, { openingCapital: accountSize, flows }),
    [all, accountSize, flows]
  );

  const idx = useIndexHistory(index, S?.from, S?.to);
  const outcomes = useMemo(() => deploymentOutcomes(closed, S), [closed, S]);

  if (!S) {
    return (
      <div className="card empty">
        <div className="eyebrow">Capital deployment</div>
        <p>Once you have a trade with an entry date, this shows how much of the
          account was committed on any given day.</p>
        <style jsx>{`
          .empty { padding: 34px 20px; text-align: center; }
          .empty p { font-size: 13px; color: var(--ink3); max-width: 380px; margin: 8px auto 0; }
        `}</style>
      </div>
    );
  }

  /* ---- geometry ---------------------------------------------------- */
  const PL = 54, PR = 46, PT = 12;
  const depH = 176, idxH = idx.points.length ? 66 : 0, GAP = idxH ? 14 : 0;
  const H = PT + depH + GAP + idxH + 26;
  const innerW = Math.max(120, w - PL - PR);

  const t0 = +new Date(S.from), t1 = +new Date(S.to);
  const fx = (d) => PL + (t1 > t0 ? ((+new Date(d) - t0) / (t1 - t0)) * innerW : 0);

  // One rupee axis for capital, deployed and open risk together. Open risk
  // reads as a sliver under the block of committed capital, which is the
  // relationship — the money at stake is a small fraction of the money in
  // play — and a second axis would flatter it into looking comparable.
  const rawTop = Math.max(...S.days.map((x) => Math.max(x.capital, x.deployed)), 1);
  const yTicks = niceTicks(rawTop);
  const topMoney = yTicks[yTicks.length - 1];
  const fy = (v) => PT + depH - (v / topMoney) * depH;

  const path = (key) =>
    S.days.map((x, i) => `${i ? "L" : "M"}${fx(x.d).toFixed(1)} ${fy(x[key]).toFixed(1)}`).join("");
  const areaPath =
    path("deployed") +
    `L${fx(S.days[S.days.length - 1].d).toFixed(1)} ${(PT + depH).toFixed(1)}` +
    `L${fx(S.days[0].d).toFixed(1)} ${(PT + depH).toFixed(1)}Z`;

  // Index panel, scaled to its own visible range so the shape is legible
  // rather than squashed against a zero baseline it never approaches.
  const iPts = idx.points.filter((p) => p.d >= S.from && p.d <= S.to);
  const iLo = iPts.length ? Math.min(...iPts.map((p) => p.c)) : 0;
  const iHi = iPts.length ? Math.max(...iPts.map((p) => p.c)) : 1;
  const iy0 = PT + depH + GAP;
  const fiy = (v) => iy0 + idxH - ((v - iLo) / Math.max(1e-9, iHi - iLo)) * (idxH - 8) - 4;
  const iPath = iPts.map((p, i) => `${i ? "L" : "M"}${fx(p.d).toFixed(1)} ${fiy(p.c).toFixed(1)}`).join("");

  const monthTicks = S.days.filter((x) => x.d.slice(8) === "01");
  const every = Math.max(1, Math.ceil(monthTicks.length / Math.max(4, Math.floor(innerW / 62))));

  const hovDay = hov != null ? S.days[hov] : null;
  /**
   * Last close on or before the hovered day.
   *
   * An exact-date lookup finds nothing on a weekend or a market holiday, and
   * since the deployment series runs on calendar days that silently blanked
   * the index from the readout about a third of the time. Carrying the last
   * close forward is also the true answer: on a Sunday the market stands where
   * it closed on Friday.
   */
  // Not useMemo: everything below here sits after the early return for an
  // empty series, so a hook here would run on some renders and not others —
  // React counts hooks by position, and the first trade a new user logs would
  // flip the count and throw. A binary search over a few hundred closes costs
  // nothing anyway.
  const hovIdx = lastAtOrBefore(iPts, hovDay?.d);

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left - PL;
    const i = Math.round((x / innerW) * (S.days.length - 1));
    setHov(i >= 0 && i < S.days.length ? i : null);
  };

  return (
    <section>
      <div className={`${CAP_MONEY}-head`}>
        <div>
          <div className="eyebrow">Capital deployment</div>
          <div className={`${CAP_MONEY}-sub`}>
            How much of the account was committed on each day, at cost. Measured
            against the capital that existed at the time — not today&rsquo;s balance —
            so an early month isn&rsquo;t marked down for money that hadn&rsquo;t arrived yet.
          </div>
        </div>
        <div className="seg">
          {INDEX_CHOICES.map((c) => (
            <button key={c.id} data-on={index === c.id ? 1 : 0} onClick={() => setIndex(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`${CAP_MONEY}-tiles`}>
        <Stat label="Most committed" value={rupee(S.peak.deployed)}
              sub={`${pct(S.peak.pct, 0)} of capital · ${dmy(S.peak.d)} · ${S.peak.count} position${S.peak.count === 1 ? "" : "s"}`} />
        {/* "on an average day" rather than "of capital", because these are
            means of the daily SHARE, not the shown rupee figure divided by
            anything. Capital moves underneath, so the two do not reconcile by
            division and the wording must not invite it. */}
        <Stat label="Average committed" value={rupee(S.avgDeployed)}
              sub={`${pct(S.avgPct, 0)} of capital on an average day · ${S.dayCount} days`} />
        <Stat label="Typical day" value={rupee(S.medianDeployed)}
              sub={`median — half the days above, half below`} />
        <Stat label="Average cash" value={rupee(S.avgCash)}
              sub={`${pct(100 - S.avgPct, 0)} uncommitted on an average day`} />
      </div>

      <div className="card" ref={box} style={{ padding: "10px 4px 4px" }}>
        <div className={`${CAP_MONEY}-legend`}>
          <span><i className={`${CAP_MONEY}-sw ${CAP_MONEY}-dep`} />Committed</span>
          <span><i className={`${CAP_MONEY}-sw ${CAP_MONEY}-risk`} />Open risk</span>
          <span><i className={`${CAP_MONEY}-sw ${CAP_MONEY}-cap`} />Capital</span>
          {idx.points.length > 0 && (
            <span><i className={`${CAP_MONEY}-sw ${CAP_MONEY}-idx`} />
              {INDEX_CHOICES.find((c) => c.id === index)?.label}</span>
          )}
          {idx.loading && <span className={`${CAP_MONEY}-dim`}>loading index…</span>}
          {idx.error && <span className={`${CAP_MONEY}-dim`}>index unavailable</span>}
        </div>

        <svg width="100%" height={H} onMouseMove={onMove} onMouseLeave={() => setHov(null)}
             style={{ display: "block", touchAction: "none" }}>
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={PL} x2={PL + innerW} y1={fy(v)} y2={fy(v)}
                    stroke="var(--rule)" strokeWidth="1" />
              <text x={PL - 7} y={fy(v) + 3.5} textAnchor="end" className={`${CAP_MONEY}-ax`}>
                {v === 0 ? "0" : rupee(v, { decimals: 1 })}
              </text>
            </g>
          ))}

          <path d={areaPath} fill="var(--long)" opacity="0.13" />
          <path d={path("deployed")} fill="none" stroke="var(--long)" strokeWidth="1.6" />
          <path d={path("capital")} fill="none" stroke="var(--ink3)" strokeWidth="1"
                strokeDasharray="3 3" opacity="0.7" />
          <path d={path("risk")} fill="none" stroke="var(--short)" strokeWidth="1.3" opacity="0.85" />

          {iPts.length > 0 && (
            <>
              <line x1={PL} x2={PL + innerW} y1={iy0 - 5} y2={iy0 - 5}
                    stroke="var(--rule)" strokeWidth="1" />
              <path d={iPath} fill="none" stroke="var(--brass)" strokeWidth="1.4" />
              <text x={PL - 7} y={fiy(iHi) + 3.5} textAnchor="end" className={`${CAP_MONEY}-ax`}>
                {Math.round(iHi).toLocaleString("en-IN")}
              </text>
              <text x={PL - 7} y={fiy(iLo) + 3.5} textAnchor="end" className={`${CAP_MONEY}-ax`}>
                {Math.round(iLo).toLocaleString("en-IN")}
              </text>
            </>
          )}

          {monthTicks.filter((_, i) => i % every === 0).map((x) => (
            <text key={x.d} x={fx(x.d)} y={H - 8} textAnchor="middle" className={`${CAP_MONEY}-ax`}>
              {new Date(x.d).toLocaleDateString("en-IN", { month: "short", year: "2-digit" })}
            </text>
          ))}

          {hovDay && (
            <>
              <line x1={fx(hovDay.d)} x2={fx(hovDay.d)} y1={PT} y2={iy0 + idxH}
                    stroke="var(--ink3)" strokeWidth="1" opacity="0.5" />
              <circle cx={fx(hovDay.d)} cy={fy(hovDay.deployed)} r="3" fill="var(--long)" />
              {hovIdx && <circle cx={fx(hovIdx.d)} cy={fiy(hovIdx.c)} r="2.5" fill="var(--brass)" />}
            </>
          )}
        </svg>

        <div className={`${CAP_MONEY}-read`}>
          {hovDay ? (
            <>
              <b>{dmy(hovDay.d)}</b>
              <span>{rupee(hovDay.deployed)} committed · {pct(hovDay.pct, 0)} of {rupee(hovDay.capital)}</span>
              <span>{hovDay.count} position{hovDay.count === 1 ? "" : "s"}</span>
              <span>{rupee(hovDay.risk)} at risk · {pct(hovDay.riskPct, 2)}</span>
              {hovIdx && <span>{INDEX_CHOICES.find((c) => c.id === index)?.label} {Math.round(hovIdx.c).toLocaleString("en-IN")}</span>}
            </>
          ) : (
            <span className={`${CAP_MONEY}-dim`}>
              {dmy(S.from)} to {dmy(S.to)} · hover for any day.
              Busiest was {S.busiest.count} positions on {dmy(S.busiest.d)}.
            </span>
          )}
        </div>
      </div>

      {/* ---- distribution ------------------------------------------- */}
      <div className={`${CAP_MONEY}-block`}>
        <div className="eyebrow">How often, at what level</div>
        <div className={`${CAP_MONEY}-sub`}>
          Days spent at each share of capital. Counted in calendar days — a position
          held over a weekend is still held. The typical day sat at {pct(S.medianPct, 0)}.
        </div>
        <div className="card" style={{ padding: "12px 14px" }}>
          {S.bands.map((b) => (
            <div key={b.label} className={`${CAP_MONEY}-band`}>
              <div className={`${CAP_MONEY}-blabel`}>{b.label}</div>
              <div className={`${CAP_MONEY}-btrack`}>
                <div style={{ width: `${b.share}%` }} />
              </div>
              <div className={`${CAP_MONEY}-bval`}>
                {b.days} day{b.days === 1 ? "" : "s"}
                <span className={`${CAP_MONEY}-dim`}> · {pct(b.share, 0)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- did it pay? -------------------------------------------- */}
      {outcomes.length > 0 && (
        <div className={`${CAP_MONEY}-block`}>
          <div className="eyebrow">Did a fuller book pay better?</div>
          <div className={`${CAP_MONEY}-sub`}>
            Every closed trade grouped by how committed the account was on the day
            it was <b>entered</b> — the state of the book when you took the decision.
            This is the question the chart above provokes and cannot answer on its own.
          </div>
          <div className="card scroll">
            <table className="t">
              <thead><tr>
                <th>Committed at entry</th>
                <th className="num">Trades</th>
                <th className="num">Win rate</th>
                <th className="num">Expectancy</th>
                <th className="num">Total R</th>
              </tr></thead>
              <tbody>
                {outcomes.map((o) => (
                  <tr key={o.key} style={{ opacity: o.isThin ? 0.55 : 1 }}>
                    <td><b style={{ fontWeight: 500 }}>{o.key}</b></td>
                    <td className="num">{o.n}</td>
                    <td className="num">{pct(o.winRate, 0)}</td>
                    <td className={`num ${o.expectancy >= 0 ? "pos" : "neg"}`} style={{ fontWeight: 500 }}>
                      {rfmt(o.expectancy)}
                    </td>
                    <td className={`num ${o.totalR >= 0 ? "pos" : "neg"}`}>{rfmt(o.totalR, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {outcomes.some((o) => o.isThin) && (
            <div className="hint" style={{ marginTop: 8 }}>
              Faded rows hold fewer than {THIN_DEPLOY_SLICE} trades — questions to watch, not conclusions.
            </div>
          )}
        </div>
      )}

      {/* ---- by month ------------------------------------------------ */}
      <div className={`${CAP_MONEY}-block`}>
        <div className="eyebrow">Month by month</div>
        <div className="card scroll">
          <table className="t">
            <thead><tr>
              <th>Month</th>
              <th className="num">Avg committed</th>
              <th className="num">% of capital</th>
              <th className="num">Most</th>
              <th className="num">Least</th>
              <th className="num">Avg positions</th>
              <th className="num">Most positions</th>
              <th className="num">Avg risk</th>
            </tr></thead>
            <tbody>
              {S.months.map((m) => (
                <tr key={m.key}>
                  <td><b style={{ fontWeight: 500 }}>
                    {new Date(`${m.key}-01`).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
                  </b></td>
                  <td className="num">{rupee(m.avgDeployed)}</td>
                  <td className="num">{pct(m.avgPct, 0)}</td>
                  <td className="num">{rupee(m.maxDeployed)}</td>
                  <td className="num">{rupee(m.minDeployed)}</td>
                  <td className="num">{m.avgCount.toFixed(1)}</td>
                  <td className="num">{m.maxCount}</td>
                  <td className="num">{pct(m.avgRiskPct, 2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><b>All</b></td>
                <td className="num">{rupee(S.avgDeployed)}</td>
                <td className="num">{pct(S.avgPct, 0)}</td>
                <td className="num">{rupee(S.peak.deployed)}</td>
                <td className="num">{rupee(Math.min(...S.days.map((x) => x.deployed)))}</td>
                <td className="num">{S.avgCount.toFixed(1)}</td>
                <td className="num">{S.busiest.count}</td>
                <td className="num">{pct(S.avgRiskPct, 2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className={`${CAP_MONEY}-notes`}>
        <p><b>At cost, not market value.</b> Committed capital is entry price × shares
          still held. The app keeps no price history, so a mark-to-market series
          running backwards through time isn&rsquo;t something this data can support.</p>
        <p><b>Average position size {rupee(S.avgPositionSize)}</b> across {S.positionsCounted} positions,
          measured at entry.</p>
        <p><b>Gaps where positions weren&rsquo;t imported.</b> Broker tax P&amp;L files carry
          closed trades only, so anything held across the edge of an import leaves a
          dip here that never happened in the account.</p>
        <p><b>Open risk</b> is the distance from entry to your stop on what is still
          held, and drops to zero on a position once you acknowledge it as risk-free.</p>
        <p><b>An index is a proxy, not your market.</b> A breakout system can be
          failing while the index grinds up. Breadth would be the honest comparison
          and no free source carries it.</p>
      </div>

      <style jsx global>{`
        .${CAP_MONEY}-head {
          display: flex; align-items: flex-end; justify-content: space-between;
          gap: 14px; flex-wrap: wrap; margin-bottom: 12px;
        }
        .${CAP_MONEY}-sub { font-size: 12px; color: var(--ink2); margin-top: 3px; max-width: 640px; text-wrap: pretty; }
        .${CAP_MONEY}-dim { color: var(--ink3); }
        .${CAP_MONEY}-block { margin-top: 22px; }
        .${CAP_MONEY}-block .eyebrow { margin-bottom: 3px; }
        .${CAP_MONEY}-block .card { margin-top: 10px; }

        .${CAP_MONEY}-tiles {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
          gap: 10px; margin-bottom: 12px;
        }
        .${CAP_MONEY}-stat {
          border: 1px solid var(--rule); background: var(--card);
          border-radius: 3px; padding: 11px 13px;
        }
        .${CAP_MONEY}-stat .l { font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink3); }
        .${CAP_MONEY}-stat .v { font-size: 20px; font-weight: 500; margin-top: 4px; font-variant-numeric: tabular-nums; }
        .${CAP_MONEY}-stat .s { font-size: 11px; color: var(--ink3); margin-top: 3px; }

        .${CAP_MONEY}-legend {
          display: flex; flex-wrap: wrap; gap: 14px; font-size: 11px;
          color: var(--ink2); padding: 0 10px 6px;
        }
        .${CAP_MONEY}-legend span { display: inline-flex; align-items: center; gap: 5px; }
        .${CAP_MONEY}-sw { width: 12px; height: 2px; display: inline-block; border-radius: 1px; }
        .${CAP_MONEY}-dep  { background: var(--long); }
        .${CAP_MONEY}-risk { background: var(--short); }
        .${CAP_MONEY}-cap  { background: var(--ink3); }
        .${CAP_MONEY}-idx  { background: var(--brass); }
        .${CAP_MONEY}-ax { font-size: 10px; fill: var(--ink3); font-variant-numeric: tabular-nums; }

        .${CAP_MONEY}-read {
          display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: baseline;
          font-size: 11.5px; color: var(--ink2); padding: 7px 10px 4px;
          border-top: 1px solid var(--rule); min-height: 30px;
          font-variant-numeric: tabular-nums;
        }
        .${CAP_MONEY}-read b { font-weight: 500; color: var(--ink); }

        .${CAP_MONEY}-band {
          display: grid; grid-template-columns: 86px 1fr 120px;
          align-items: center; gap: 10px; padding: 4px 0;
        }
        .${CAP_MONEY}-blabel { font-size: 11.5px; color: var(--ink2); }
        .${CAP_MONEY}-btrack { height: 9px; background: var(--rule); border-radius: 1px; }
        .${CAP_MONEY}-btrack > div { height: 100%; background: var(--long); opacity: .6; border-radius: 1px; }
        .${CAP_MONEY}-bval { font-size: 11.5px; text-align: right; font-variant-numeric: tabular-nums; }

        /* Two columns so a five-item list doesn't run the width of the page
           as one long thin ribbon — the same pass applied to the other
           footnotes across the app. */
        .${CAP_MONEY}-notes {
          margin-top: 18px; font-size: 11.5px; color: var(--ink3); line-height: 1.65;
          columns: 2; column-gap: 28px; text-wrap: pretty;
        }
        .${CAP_MONEY}-notes p { break-inside: avoid; margin: 0 0 9px; }
        .${CAP_MONEY}-notes b { font-weight: 500; color: var(--ink2); }
        @media (max-width: 720px) { .${CAP_MONEY}-notes { columns: 1; } }
      `}</style>
    </section>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className={`${CAP_MONEY}-stat`}>
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      <div className="s">{sub}</div>
    </div>
  );
}
