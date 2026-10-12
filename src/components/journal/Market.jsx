"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useBreadth, hasBreadth } from "@/lib/breadth";
import { BREADTH_GROUPS, GROUP_LABELS, share } from "@/lib/breadthCalc";
import { MONTHS } from "@/lib/format";

/**
 * How many stocks are taking part — the market's breadth, after each close.
 *
 * ONE TABLE AND ONE LINE. The table is today: for each market-cap tier, the
 * share above its 20-, 50- and 200-day averages, where prices sit in their
 * 52-week range, and the day's advances against declines. The line is the
 * regime: the share of the Top 750 above their 50-day average over the past
 * year, with 40% and 60% drawn — the same bands Breadth at entry cuts your
 * own trades by, which is where the screen points last.
 *
 * End of day, from NSE's bhavcopy, and it says so at the top. Live breadth
 * needs a licensed feed; lib/breadth.js holds the seam for it.
 */

/** "Fri 9 Oct 2026" — the close this screen describes, said in full. */
const longDate = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd} ${d} ${MONTHS[m - 1]} ${y}`;
};

const GROUP_HINTS = {
  top: "Large, mid and small caps together — ranks 1 to 750 in AMFI's list in force that day",
  large: "AMFI ranks 1–100", mid: "AMFI ranks 101–250", small: "AMFI ranks 251–750",
  micro: "Rank 751 onwards — thousands of thinly traded names, kept apart so they do not outvote the rest",
};

/** A share as a tint: green above half, rust below, stronger the further out. */
const heat = (pct) => {
  if (pct == null) return undefined;
  const t = Math.min(1, Math.abs(pct - 50) / 50);
  const tone = pct >= 50 ? "var(--long)" : "var(--short)";
  return { background: `color-mix(in srgb, ${tone} ${Math.round(t * 55)}%, transparent)` };
};

function Split({ parts, title }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  if (!total) return <span className="mk-dim">—</span>;
  return (
    <div className="mk-split" title={title}>
      {parts.map((p) => p.n > 0 && (
        <span key={p.k} className={`mk-seg mk-${p.k}`} style={{ flexGrow: p.n }}>
          {p.n / total >= 0.12 ? p.n : ""}
        </span>
      ))}
    </div>
  );
}

function Chart({ chart }) {
  const [hover, setHover] = useState(null);
  const pts = useMemo(() => (chart?.dates || []).map((d, i) => [d, chart.top[i]]).filter(([, v]) => v != null), [chart]);
  if (pts.length < 2) return null;

  const W = 1000, H = 240, L = 34, R = 10, T = 10, B = 26;
  const x = (i) => L + (i / (pts.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / 100) * (H - T - B);
  const line = pts.map(([, v], i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");

  /* A label at the first trading day of every other month. */
  const ticks = [];
  pts.forEach(([d], i) => {
    const m = d.slice(0, 7);
    if (i && m !== pts[i - 1][0].slice(0, 7) && Number(m.slice(5)) % 2 === 1) ticks.push([i, d]);
  });

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((fx - L) / (W - L - R)) * (pts.length - 1));
    setHover(i >= 0 && i < pts.length ? i : null);
  };

  return (
    <div className="mk-chart">
      <svg viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}
           role="img" aria-label="Share of the Top 750 above their 50-day average, past year">
        <rect x={L} y={y(100)} width={W - L - R} height={y(60) - y(100)} className="mk-band-hi" />
        <rect x={L} y={y(40)} width={W - L - R} height={y(0) - y(40)} className="mk-band-lo" />
        {[0, 20, 40, 60, 80, 100].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 40 || v === 60 ? "mk-rule" : "mk-grid"} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" className="mk-ax">{v}%</text>
          </g>
        ))}
        {ticks.map(([i, d]) => (
          <text key={d} x={x(i)} y={H - 8} textAnchor="middle" className="mk-ax">
            {MONTHS[Number(d.slice(5, 7)) - 1]} {d.slice(2, 4)}
          </text>
        ))}
        <path d={line} className="mk-line" />
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="mk-cross" />
            <circle cx={x(hover)} cy={y(pts[hover][1])} r="4" className="mk-dot" />
          </g>
        )}
        <circle cx={x(pts.length - 1)} cy={y(pts.at(-1)[1])} r="4" className="mk-dot" />
      </svg>
      <div className="mk-read">
        {hover != null
          ? <><b>{pts[hover][1]}%</b> above the 50-day on {longDate(pts[hover][0])}</>
          : <><b>{pts.at(-1)[1]}%</b> now · above 60% is a broad advance, under 40% a market
            where most breakouts fail</>}
      </div>
    </div>
  );
}

export default function Market() {
  const { data } = useBreadth(true);

  if (!hasBreadth()) {
    return (
      <div className="sec card empty">
        <div className="eyebrow">Market breadth</div>
        <p>Breadth covers India's NSE for now — switch to the India book to see it.</p>
      </div>
    );
  }
  if (!data) {
    return <div className="sec"><div className="eyebrow">Market breadth</div><p className="hint">Loading…</p></div>;
  }

  const c = data.latest;
  return (
    <>
      <div className="sec">
        <div className="sechead">
          <div>
            <div className="eyebrow">Market breadth</div>
            <div className="mk-sub">
              After the close on <b>{longDate(data.through)}</b> · NSE end-of-day figures, updated each evening
            </div>
          </div>
        </div>
        <div className="card scroll">
          <table className="t mk-t">
            <thead><tr>
              <th>Group</th>
              <th className="num" title="Stocks counted in this group on the day">Stocks</th>
              <th className="num" title="Share above their 20-day average of closes — the short-term trend">Above 20-day</th>
              <th className="num" title="Share above their 50-day average — the measure traders read the regime by">Above 50-day</th>
              <th className="num" title="Share above their 200-day average — the long-term trend">Above 200-day</th>
              <th title="Where each price sits in its 52-week range, in thirds: low, mid, high">52-week range</th>
              <th title="Stocks that closed up, against those that closed down, on the day">Advances · declines</th>
            </tr></thead>
            <tbody>
              {BREADTH_GROUPS.map((g) => {
                const r = c[g];
                const p20 = share(r.a20, r.n20), p50 = share(r.a50, r.n50), p200 = share(r.a200, r.n200);
                return (
                  <tr key={g} data-top={g === "top" ? 1 : 0}>
                    <td title={GROUP_HINTS[g]}>{GROUP_LABELS[g]}</td>
                    <td className="num mk-dim">{r.n.toLocaleString("en-IN")}</td>
                    <td className="num mk-heat" style={heat(p20)}>{p20 == null ? "—" : `${Math.round(p20)}%`}</td>
                    <td className="num mk-heat" style={heat(p50)}>{p50 == null ? "—" : `${Math.round(p50)}%`}</td>
                    <td className="num mk-heat" style={heat(p200)}>{p200 == null ? "—" : `${Math.round(p200)}%`}</td>
                    <td>
                      <Split parts={[{ k: "lo", n: r.lo }, { k: "mid", n: r.mid }, { k: "hi", n: r.hi }]}
                             title={`${r.lo} in the low third of their 52-week range, ${r.mid} mid, ${r.hi} high`} />
                    </td>
                    <td>
                      <Split parts={[{ k: "adv", n: r.adv }, { k: "unch", n: r.unch }, { k: "dec", n: r.dec }]}
                             title={`${r.adv} closed up, ${r.dec} down, ${r.unch} unchanged`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sec">
        <div className="eyebrow">The regime<span className="term">Top 750 above their 50-day average, past year</span></div>
        <Chart chart={data.chart} />
        <div className="mk-go">
          How have your own trades done in each regime?{" "}
          <Link href="/analysis/edge?dim=breadth">See Breadth at entry on What works</Link>
        </div>
      </div>

      <style jsx global>{`
        .mk-sub { font-size: 12px; color: var(--ink2); margin-top: 3px; }
        .mk-dim { color: var(--ink3); }
        .mk-t td, .mk-t th { white-space: nowrap; }
        .mk-t tr[data-top="1"] td { font-weight: 600; }
        .mk-t td:first-child { cursor: help; }
        .mk-heat { font-variant-numeric: tabular-nums; min-width: 92px; }
        .mk-split { display: flex; min-width: 150px; height: 20px; border-radius: 2px; overflow: hidden; }
        .mk-seg { display: flex; align-items: center; justify-content: center; font-size: 11px;
                  color: var(--ink); font-variant-numeric: tabular-nums; }
        .mk-lo, .mk-dec { background: color-mix(in srgb, var(--short) 45%, transparent); }
        .mk-mid { background: color-mix(in srgb, var(--brass) 40%, transparent); }
        .mk-hi, .mk-adv { background: color-mix(in srgb, var(--long) 45%, transparent); }
        .mk-unch { background: var(--grid); }
        .mk-chart { margin-top: 10px; background: var(--card); border: 1px solid var(--rule);
                    border-radius: 3px; padding: 12px 14px 10px; }
        .mk-chart svg { width: 100%; height: auto; display: block; }
        .mk-band-hi { fill: color-mix(in srgb, var(--long) 8%, transparent); }
        .mk-band-lo { fill: color-mix(in srgb, var(--short) 8%, transparent); }
        .mk-grid { stroke: var(--grid); stroke-width: 1; }
        .mk-rule { stroke: var(--ink3); stroke-width: 1; stroke-dasharray: 4 4; }
        .mk-ax { fill: var(--ink3); font-size: 11px; }
        .mk-line { fill: none; stroke: var(--ink); stroke-width: 1.6; }
        .mk-cross { stroke: var(--ink3); stroke-width: 1; }
        .mk-dot { fill: var(--ink); }
        .mk-read { font-size: 12px; color: var(--ink2); margin-top: 6px; }
        .mk-go { font-size: 12px; color: var(--ink2); margin-top: 10px; }
        .mk-go a { color: var(--ink); text-decoration: underline; }
      `}</style>
    </>
  );
}
