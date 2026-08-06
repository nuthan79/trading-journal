"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  deploymentSeries, deploymentOutcomes, THIN_DEPLOY_SLICE, DEPLOY_BANDS,
} from "@/lib/deployment";
import { rupee, rfmt, pct, dmy } from "@/lib/format";
import { apiFetch } from "@/lib/db";

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
 * each level of deployment, and lets that answer the question. It is why the
 * monthly bars are shaded in one hue rather than red-through-green — see
 * SHADES below.
 */

const CAP_MONEY = "cd";                       // unique prefix — see the styled-jsx note in CLAUDE.md

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

/**
 * A deployment band written in rupees, at a given capital.
 *
 * A translation of the percentages beside it, not a claim about history — the
 * account was smaller once, and these are not the amounts that were committed
 * back then. The caption says so; without that this quietly becomes a lie
 * about the past.
 */
function bandMoney(band, capital) {
  if (!(capital > 0)) return "";
  const at = (p) => rupee((p / 100) * capital, { decimals: 1 });
  if (band.min <= 0) return `below ${at(band.max)}`;
  if (!isFinite(band.max)) return `above ${at(band.min)}`;
  return `${at(band.min)} – ${at(band.max)}`;
}

const monthName = (key) =>
  new Date(`${key}-01`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });

/**
 * Bar shading, pale to deep by how full the book was that month.
 *
 * ONE HUE, not red-through-green. A red-to-green ramp is the obvious way to
 * draw this and it would say something this screen refuses to say — that a
 * lightly deployed month is a bad month. Cash is a position; a quiet February
 * spent standing aside is not a failure, and colouring it like one puts back
 * the judgement that was deliberately taken out. One hue carries the same
 * magnitude with no verdict attached.
 *
 * Stops are var(--long) lightened toward the card, so the ramp belongs to the
 * same palette as every other mark here.
 *
 * One stop per band. A shorter ramp squeezed two bands onto one shade at each
 * end, so 10–25% and 25–40% came out identical and the bars lost exactly the
 * distinction they are drawn to show.
 */
const SHADES = [
  "#DCEAE6", "#BAD7D0", "#98C5BA", "#75B2A5", "#539F8F", "#318D79", "#0F7A63",
];

const shadeFor = (pctOfCapital) => {
  const i = DEPLOY_BANDS.findIndex((b) => pctOfCapital < b.max);
  return SHADES[i < 0 ? SHADES.length - 1 : Math.min(i, SHADES.length - 1)];
};

/**
 * The fewest decimals that print this tick exactly.
 *
 * A fixed decimal count cannot be right for a whole axis: at one place ₹1.25
 * Cr prints as "₹1.3 Cr", a label ₹5L above its own gridline, and at two every
 * lakh tick grows a pointless "₹25.00 L". Asking each tick what it needs gives
 * ₹25 L, ₹50 L, ₹75 L, ₹1 Cr, ₹1.25 Cr — every one of them exact.
 */
function axisMoney(v) {
  if (v === 0) return "0";
  const unit = Math.abs(v) >= 1e7 ? 1e7 : 1e5;
  for (let d = 0; d <= 2; d++) {
    if (Math.abs(Number((v / unit).toFixed(d)) * unit - v) < unit * 1e-6) {
      return rupee(v, { decimals: d });
    }
  }
  return rupee(v, { decimals: 2 });
}

/**
 * Gridline values that land on round numbers and always CLEAR the maximum.
 *
 * Two things this has to get right, both of which it got wrong first time.
 *
 * Round: dividing the maximum into equal fifths gives ticks like ₹1.68 Cr,
 * and `inr()` renders that at zero decimals as "₹2 Cr" — a label a third above
 * the line it sits on. Stepping by 1 / 2 / 2.5 / 5 × a power of ten means
 * every label is exact at the precision it prints.
 *
 * Clear: the last tick has to be at or above `max`, because the caller scales
 * the panel to it. Stopping at the last tick BELOW the maximum let the series
 * climb past the top of the plot — the capital line was drawing itself up into
 * the legend, and the monthly position axis stopped short of its own line.
 *
 * `integer` drops the 2.5 step, since half a position is not a thing.
 */
function niceTicks(max, { target = 4, integer = false } = {}) {
  if (!(max > 0)) return [0];
  const mag = Math.pow(10, Math.floor(Math.log10(max / target)));
  const steps = (integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]).map((m) => m * mag);

  // The step whose tick count lands nearest `target`. Taking the first step
  // at or above max/target instead is what left ~40% of the panel empty on a
  // chart whose maximum sat just over a round number.
  let step = steps[steps.length - 1];
  let best = Infinity;
  for (const s of steps) {
    if (integer && s < 1) continue;
    const n = Math.ceil(max / s);
    if (n < 2) continue;
    const score = Math.abs(n - target);
    if (score < best) { best = score; step = s; }
  }

  const out = [];
  for (let v = 0; ; v += step) {
    out.push(v);
    if (v >= max - step * 1e-9) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Index history — fetched lazily, and entirely optional              */
/* ------------------------------------------------------------------ */

// Mirrors INDICES in quotes.js, plus "none". See the note there on why
// MidSmallcap 400 is absent and its two halves are listed instead.
const INDEX_CHOICES = [
  { id: "nifty500", label: "Nifty 500" },
  { id: "nifty50", label: "Nifty 50" },
  { id: "midcap150", label: "Midcap 150" },
  { id: "smallcap250", label: "Smallcap 250" },
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

    // apiFetch, not fetch. The Supabase session lives in localStorage rather
    // than a cookie, so nothing rides along on its own and a bare fetch gets
    // 401 every time — which this failed soft on, so the panel just never
    // appeared. See the note on apiFetch in db.js.
    apiFetch(`/api/index-history?index=${index}&from=${from}&to=${to}`)
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
  // Two right margins. The monthly panel carries a right-hand axis for its
  // position line and needs room for the labels; the daily one has no right
  // axis any more, so the wide gutter it used to need is just a hole. The two
  // panels are different aggregations in separate cards, so nothing depends on
  // their plot areas lining up.
  const PL = 54, PR = 46, PR_DAY = 14, PT = 12;
  const depH = 176, idxH = idx.points.length ? 66 : 0, GAP = idxH ? 14 : 0;
  const H = PT + depH + GAP + idxH + 26;
  const innerW  = Math.max(120, w - PL - PR);      // monthly panel
  const dInnerW = Math.max(120, w - PL - PR_DAY);   // daily panel

  const t0 = +new Date(S.from), t1 = +new Date(S.to);
  const fx = (d) => PL + (t1 > t0 ? ((+new Date(d) - t0) / (t1 - t0)) * dInnerW : 0);

  // One rupee axis for capital, deployed and open risk together. Open risk
  // reads as a sliver under the block of committed capital, which is the
  // relationship — the money at stake is a small fraction of the money in
  // play — and a second axis would flatter it into looking comparable.
  const rawTop = Math.max(...S.days.map((x) => Math.max(x.capital, x.deployed)), 1);
  const yTicks = niceTicks(rawTop);
  const topMoney = yTicks[yTicks.length - 1];
  const fy = (v) => PT + depH - (v / topMoney) * depH;

  /* ---- monthly panel ------------------------------------------------ */
  const MPT = 12, mDepH = 168, MH = MPT + mDepH + 52;
  const bandW = innerW / Math.max(1, S.months.length);
  const barW = Math.max(4, Math.min(30, bandW - 8));

  const mTicks = niceTicks(Math.max(...S.months.map((m) => m.avgDeployed), 1));
  const mTop = mTicks[mTicks.length - 1];
  const mfy = (v) => MPT + mDepH - (v / mTop) * mDepH;

  const mCountTicks = niceTicks(Math.max(...S.months.map((m) => m.avgCount), 1), { integer: true });
  const mCountTop = mCountTicks[mCountTicks.length - 1];
  const mfyc = (v) => MPT + mDepH - (v / mCountTop) * mDepH;

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
  const every = Math.max(1, Math.ceil(monthTicks.length / Math.max(4, Math.floor(dInnerW / 62))));

  // The capital the band table translates its percentages at — the latest
  // reading, which is what "today" means to whoever is looking at the screen.
  const capitalNow = S.current.capital;

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
    const i = Math.round((x / dInnerW) * (S.days.length - 1));
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
              <line x1={PL} x2={PL + dInnerW} y1={fy(v)} y2={fy(v)}
                    stroke="var(--rule)" strokeWidth="1" />
              <text x={PL - 7} y={fy(v) + 3.5} textAnchor="end" className={`${CAP_MONEY}-ax`}>
                {axisMoney(v)}
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
              <line x1={PL} x2={PL + dInnerW} y1={iy0 - 5} y2={iy0 - 5}
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

      {/* The shape of the book rather than the size of it — how many names,
          how big each one, where it stands today. Sits here rather than beside
          the money tiles at the top because it reads as the preamble to the
          monthly bars, whose second series is this same position count. */}
      <div className={`${CAP_MONEY}-tiles ${CAP_MONEY}-tiles-mid`}>
        <Stat label="Most positions at once" value={S.busiest.count}
              sub={`first on ${dmy(S.busiest.d)}`} />
        <Stat label="Typical open book" value={S.avgCount.toFixed(1)}
              sub="positions on an average day" />
        <Stat label="Average position" value={rupee(S.avgPositionSize)}
              sub={`at entry, across ${S.positionsCounted} positions`} />
        <Stat label="Today" value={rupee(S.current.deployed)}
              sub={`${pct(S.current.pct, 0)} of capital · ${S.current.count} position${S.current.count === 1 ? "" : "s"}`} />
      </div>

      {/* ---- month by month ----------------------------------------- */}
      {S.months.length > 1 && (
        <div className={`${CAP_MONEY}-block`}>
          <div className="eyebrow">Month by month</div>
          <div className={`${CAP_MONEY}-sub`}>
            Each bar is that month&rsquo;s average committed capital, shaded by how
            full the book was. The line is the average number of positions held.
          </div>
          <div className="card" style={{ padding: "10px 4px 4px" }}>
            <div className={`${CAP_MONEY}-legend`}>
              {/* A ramp, not a solid swatch — the bars are shaded across it, and
                  one flat colour here would misdescribe them. */}
              <span><i className={`${CAP_MONEY}-sw ${CAP_MONEY}-ramp`} />Average committed
                <span className={`${CAP_MONEY}-dim`}>&nbsp;· darker is fuller</span></span>
              <span><i className={`${CAP_MONEY}-sw ${CAP_MONEY}-pos`} />Average positions
                <span className={`${CAP_MONEY}-dim`}>&nbsp;· right axis</span></span>
            </div>
            <svg width="100%" height={MH} style={{ display: "block" }}>
              {mTicks.map((v, i) => (
                <g key={i}>
                  <line x1={PL} x2={PL + innerW} y1={mfy(v)} y2={mfy(v)}
                        stroke="var(--rule)" strokeWidth="1" />
                  <text x={PL - 7} y={mfy(v) + 3.5} textAnchor="end" className={`${CAP_MONEY}-ax`}>
                    {axisMoney(v)}
                  </text>
                </g>
              ))}
              {mCountTicks.map((v) => (
                <text key={`mc${v}`} x={PL + innerW + 7} y={mfyc(v) + 3.5}
                      textAnchor="start" className={`${CAP_MONEY}-axc`}>{v}</text>
              ))}

              {S.months.map((m, i) => {
                const x = PL + i * bandW + (bandW - barW) / 2;
                const y = mfy(m.avgDeployed);
                return (
                  <rect key={m.key} x={x} y={y} width={barW}
                        height={Math.max(0, MPT + mDepH - y)} rx="1"
                        fill={shadeFor(m.avgPct)}>
                    <title>
                      {monthName(m.key)} — {rupee(m.avgDeployed)} average, {pct(m.avgPct, 0)} of
                      capital, {m.avgCount.toFixed(1)} positions
                    </title>
                  </rect>
                );
              })}

              <path d={S.months.map((m, i) =>
                      `${i ? "L" : "M"}${(PL + i * bandW + bandW / 2).toFixed(1)} ${mfyc(m.avgCount).toFixed(1)}`
                    ).join("")}
                    fill="none" stroke="var(--steel)" strokeWidth="1.6" />
              {S.months.map((m, i) => (
                <circle key={`d${m.key}`} cx={PL + i * bandW + bandW / 2}
                        cy={mfyc(m.avgCount)} r="2.6"
                        fill="var(--card)" stroke="var(--steel)" strokeWidth="1.4" />
              ))}

              {S.months.map((m, i) => (
                <text key={`l${m.key}`}
                      x={PL + i * bandW + bandW / 2} y={MPT + mDepH + 14}
                      textAnchor="end" className={`${CAP_MONEY}-ax`}
                      transform={`rotate(-45 ${PL + i * bandW + bandW / 2} ${MPT + mDepH + 14})`}>
                  {monthName(m.key)}
                </text>
              ))}
            </svg>
          </div>
        </div>
      )}

      {/* ---- did it pay? -------------------------------------------- */}
      {outcomes.length > 0 && (
        <div className={`${CAP_MONEY}-block`}>
          <div className="eyebrow">Did a fuller book pay better?</div>
          <div className={`${CAP_MONEY}-sub`}>
            Every closed trade grouped by how committed the account was on the day
            it was <b>entered</b> — the state of the book when you took the decision.
            This is the question the chart above provokes and cannot answer on its own.
            The rupee figures translate each band at your capital today
            ({rupee(capitalNow)}) so the percentages are easier to picture — they are
            a ruler, not what was committed at the time, since the account was
            smaller earlier on.
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
                    <td>
                      <b style={{ fontWeight: 500 }}>{o.key}</b>
                      {/* What the band came to in money — the amounts actually
                          committed on those entry days, so this reads as a real
                          span rather than a conversion at a capital figure the
                          account may never have had. */}
                      {/* The band's OWN edges in money, at today's capital.
                          The first version printed the smallest and largest
                          amounts actually committed in the band, which was
                          accurate and unreadable: a percentage is a boundary
                          and an observed extreme is a sample, so the two lines
                          were different kinds of thing. It showed — "10–25%"
                          opening at ₹12.7 L looks simply wrong, and the spans
                          overlapped instead of nesting.

                          One decimal, not the default two: this is scanned
                          down a column, and "₹13.74 L" spends precision nobody
                          reads on the shape everybody does. */}
                      <span className={`${CAP_MONEY}-money`}>{bandMoney(o, capitalNow)}</span>
                    </td>
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

      <div className={`${CAP_MONEY}-notes`}>
        <p><b>At cost, not market value.</b> Committed capital is entry price × shares
          still held. The app keeps no price history, so a mark-to-market series
          running backwards through time isn&rsquo;t something this data can support.</p>
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
        /* Sits between two charts rather than under a heading, so it needs the
           breathing room above that a section heading would otherwise give it. */
        .${CAP_MONEY}-tiles-mid { margin-top: 22px; }
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
        .${CAP_MONEY}-pos  { background: var(--steel); }
        .${CAP_MONEY}-ramp {
          height: 8px; width: 26px; border-radius: 1px;
          background: linear-gradient(90deg, #DCEAE6, #98C5BA, #539F8F, #0F7A63);
        }
        .${CAP_MONEY}-money {
          display: block; font-size: 11px; color: var(--ink3);
          margin-top: 2px; font-variant-numeric: tabular-nums;
        }
        .${CAP_MONEY}-ax { font-size: 10px; fill: var(--ink3); font-variant-numeric: tabular-nums; }
        .${CAP_MONEY}-axc { font-size: 10px; fill: var(--steel); font-variant-numeric: tabular-nums; }

        .${CAP_MONEY}-read {
          display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: baseline;
          font-size: 11.5px; color: var(--ink2); padding: 7px 10px 4px;
          border-top: 1px solid var(--rule); min-height: 30px;
          font-variant-numeric: tabular-nums;
        }
        .${CAP_MONEY}-read b { font-weight: 500; color: var(--ink); }

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
