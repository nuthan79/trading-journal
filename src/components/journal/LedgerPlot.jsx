"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { rfmt, dmy, pct } from "@/lib/format";

const iso = (d) => d.toISOString().slice(0, 10);

/**
 * The window the curve covers, by when each trade CLOSED.
 *
 * Exit date, not entry: a trade contributes its R on the day it finished, and
 * that is the day its step appears. Filtering on entry would put a position
 * opened in March and closed in November inside a "last 30 days" window whose
 * curve never moves.
 */
const RANGES = [
  { id: "1m", label: "1M", days: 30 },
  { id: "3m", label: "3M", days: 91 },
  { id: "6m", label: "6M", days: 182 },
  { id: "1y", label: "1Y", days: 365 },
  { id: "fy", label: "FY" },
  { id: "all", label: "All" },
  { id: "custom", label: "Custom" },
];

/** Indian financial year — April to March, the app's default periodisation. */
function fyStart(now = new Date()) {
  const y = now.getFullYear();
  return `${now.getMonth() >= 3 ? y : y - 1}-04-01`;
}

function windowFor(id, custom) {
  if (id === "all") return null;
  if (id === "custom") {
    return custom.from || custom.to
      ? { from: custom.from || "0000-01-01", to: custom.to || "9999-12-31" }
      : null;
  }
  if (id === "fy") return { from: fyStart(), to: "9999-12-31" };
  const r = RANGES.find((x) => x.id === id);
  const from = new Date();
  from.setDate(from.getDate() - (r?.days || 30));
  return { from: iso(from), to: "9999-12-31" };
}

/** Signature plot — cumulative R above, per-trade R bars below. */
export default function LedgerPlot({ rows }) {
  const box = useRef(null);
  const [w, setW] = useState(900);
  // The hovered trade is held by id and looked up in whatever is currently
  // plotted, rather than kept as a copy of the point. Keeping the object let
  // it outlive its window: pick a trade, narrow the range, and the footer went
  // on describing a trade no longer on the chart while the crosshair drew
  // itself at an index that had ceased to exist.
  const [hovId, setHovId] = useState(null);
  const [range, setRange] = useState("all");
  const [custom, setCustom] = useState({ from: "", to: "" });

  useEffect(() => {
    const on = () => box.current && setW(box.current.clientWidth);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const H = 300, PL = 46, PR = 14, PT = 16, GAP = 16;
  const curveH = 168, barsH = 74;
  const innerW = Math.max(120, w - PL - PR);

  // Only trades with a computable R can be plotted. Without the filter a
  // single stop-less trade turns the running total into NaN from that point
  // on, and the whole curve silently disappears while the axes stay drawn.
  const win = useMemo(() => windowFor(range, custom), [range, custom]);

  /**
   * Rebased to zero at the start of the window, not sliced out of the lifetime
   * curve. Asked "how did the last ninety days go", nobody wants an answer that
   * begins at +147R — the shape is the same either way, but only one of them
   * puts the period's own total on the axis.
   *
   * The lifetime running total is kept on each point regardless, because on
   * hover it is still the more interesting of the two numbers.
   */
  const { pts, lifetime } = useMemo(() => {
    let life = 0;
    const all = rows
      .filter((t) => isFinite(t.r))
      .map((t) => { life += t.r; return { ...t, life }; });

    const inWin = win
      ? all.filter((t) => {
          const d = (t.exit_date || t.entry_date || "").slice(0, 10);
          return d && d >= win.from && d <= win.to;
        })
      : all;

    let cum = 0;
    return {
      lifetime: life,
      pts: inWin.map((t, i) => { cum += t.r; return { ...t, i, cum }; }),
    };
  }, [rows, win]);

  // Enough to say what the window holds without hovering it point by point.
  const summary = useMemo(() => {
    if (!pts.length) return null;
    const wins = pts.filter((p) => p.r > 0).length;
    const best = pts.reduce((a, p) => (p.r > a.r ? p : a), pts[0]);
    const worst = pts.reduce((a, p) => (p.r < a.r ? p : a), pts[0]);
    return {
      n: pts.length,
      winRate: (wins / pts.length) * 100,
      best, worst,
      from: pts[0].exit_date || pts[0].entry_date,
      to: pts[pts.length - 1].exit_date || pts[pts.length - 1].entry_date,
      symbols: new Set(pts.map((p) => p.symbol)).size,
    };
  }, [pts]);

  /**
   * Global, not scoped, and every selector prefixed `lp-`.
   *
   * The range bar is built as its own JSX root above — a variable, so that
   * both the empty branch and the plotted one can render it — and a scoped
   * <style jsx> never reaches elements outside the tree it sits in. The bar
   * came out unstyled: display:block where it asked for flex, and date inputs
   * at the app's default full width, which pushed the total onto its own line.
   *
   * The prefix is what keeps `global` honest. Same trick the rest of the app
   * uses wherever markup is rendered through a helper.
   */
  const styles = (
    <style jsx global>{`
      .lp-head {
        display: flex; justify-content: space-between; align-items: center;
        padding: 0 6px 8px; flex-wrap: wrap; gap: 10px;
      }
      .lp-total { font-size: 20px; margin-left: auto; }
      .lp-range { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .lp-dates { display: flex; align-items: center; gap: 6px; }
      .lp-dates .in { padding: 4px 7px; font-size: 12px; width: auto; min-width: 0; }
      .lp-to { font-size: 11px; color: var(--ink3); }

      .lp-foot {
        display: grid; grid-template-columns: 1fr auto 1fr;
        align-items: baseline; gap: 12px;
        padding: 2px 6px 4px; min-height: 22px;
        font-size: 11.5px; color: var(--ink2);
      }
      .lp-c { text-align: center; white-space: nowrap; }
      .lp-r { text-align: right; }
      .lp-l, .lp-r { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lp-dim { color: var(--ink3); }

      /* The date keeps the middle; the ends give way first, since one is a
         symbol the crosshair also points at and the other a number the
         header already carries. */
      @media (max-width: 620px) {
        .lp-foot { grid-template-columns: 1fr auto; }
        .lp-r { display: none; }
      }
    `}</style>
  );

  const rangeBar = (
    <div className="lp-range">
      <div className="seg">
        {RANGES.map((r) => (
          <button key={r.id} data-on={range === r.id ? 1 : 0}
                  onClick={() => setRange(r.id)}>{r.label}</button>
        ))}
      </div>
      {range === "custom" && (
        <span className="lp-dates">
          <input type="date" className="in" value={custom.from}
                 max={custom.to || undefined}
                 onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          <span className="lp-to">to</span>
          <input type="date" className="in" value={custom.to}
                 min={custom.from || undefined}
                 onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
        </span>
      )}
    </div>
  );

  if (!pts.length) {
    const waiting = rows.length;
    // A window with nothing in it is a different problem from a journal with
    // nothing in it, and telling someone to add stops when they have simply
    // picked a quiet fortnight sends them off to fix the wrong thing.
    const emptyWindow = win && waiting > 0;
    return (
      <div ref={box} className="card" style={{ padding: "16px 14px 10px" }}>
        <div className="lp-head">
          <div className="eyebrow">Cumulative R</div>
          {rangeBar}
        </div>
        <div className="empty" style={{ minHeight: 150, border: 0, padding: "34px 10px" }}>
          <p>
            {emptyWindow
              ? "Nothing closed in this window. Widen it, or pick another."
              : waiting
              ? `This plots R, and R needs a stop to measure against. Add one to your
                 ${waiting} closed trade${waiting === 1 ? "" : "s"} and the running curve
                 appears here, with every individual outcome as a bar below it.`
              : `Once you close your first trade, its R-multiple lands here — the running
                 curve on top, every individual outcome as a bar below it.`}
          </p>
        </div>
        {styles}
      </div>
    );
  }

  const cums = pts.map((p) => p.cum);
  const cMax = Math.max(0, ...cums), cMin = Math.min(0, ...cums);
  const cPad = Math.max(1, (cMax - cMin) * 0.12);
  const yTop = cMax + cPad, yBot = cMin - cPad;
  const cy = (v) => PT + curveH - ((v - yBot) / (yTop - yBot)) * curveH;

  const rAbs = Math.max(1, ...pts.map((p) => Math.abs(p.r)));
  const barsTop = PT + curveH + GAP;
  const zeroY = barsTop + barsH / 2;
  const by = (v) => zeroY - (v / rAbs) * (barsH / 2);

  const step = innerW / Math.max(1, pts.length - (pts.length > 1 ? 1 : 0));
  const x = (i) => PL + (pts.length === 1 ? innerW / 2 : i * step);
  const bw = Math.max(1.5, Math.min(14, (innerW / pts.length) * 0.62));

  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${cy(p.cum).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${cy(0).toFixed(1)} L${x(0).toFixed(1)},${cy(0).toFixed(1)} Z`;

  const ticks = [];
  const tStep = Math.max(1, Math.ceil((yTop - yBot) / 5));
  for (let v = Math.ceil(yBot / tStep) * tStep; v <= yTop; v += tStep) ticks.push(v);

  const last = pts[pts.length - 1];
  const hov = pts.find((p) => p.id === hovId) || null;

  return (
    <div ref={box} className="card" style={{ padding: "16px 14px 10px" }}>
      <div className="lp-head">
        <div className="eyebrow">
          Cumulative R · {win ? "this window, from zero" : "every closed trade in sequence"}
        </div>
        {rangeBar}
        <div className="mono lp-total"
             style={{ color: last.cum >= 0 ? "var(--long)" : "var(--short)" }}>
          {rfmt(last.cum)}
        </div>
      </div>

      <svg viewBox={`0 0 ${w} ${H}`} width="100%" height={H} style={{ display: "block", overflow: "visible" }}>
        {ticks.map((v) => (
          <g key={`t${v}`}>
            <line x1={PL} x2={w - PR} y1={cy(v)} y2={cy(v)}
                  stroke={v === 0 ? "var(--ink3)" : "var(--grid)"}
                  strokeWidth={v === 0 ? 1 : 0.5} strokeDasharray={v === 0 ? "" : "2 4"} />
            <text x={PL - 8} y={cy(v) + 3.5} textAnchor="end" className="mono"
                  fontSize="9.5" fill="var(--ink3)">{v > 0 ? `+${v}` : v}</text>
          </g>
        ))}

        <path d={area} fill={last.cum >= 0 ? "var(--long)" : "var(--short)"} opacity="0.07" />
        <path d={line} fill="none" stroke={last.cum >= 0 ? "var(--long)" : "var(--short)"}
              strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(pts.length - 1)} cy={cy(last.cum)} r="3.5"
                fill="var(--card)" stroke={last.cum >= 0 ? "var(--long)" : "var(--short)"} strokeWidth="1.75" />

        <line x1={PL} x2={w - PR} y1={zeroY} y2={zeroY} stroke="var(--ink3)" strokeWidth="1" />
        <text x={PL - 8} y={zeroY + 3.5} textAnchor="end" className="mono"
              fontSize="9.5" fill="var(--ink3)">0R</text>

        {pts.map((p) => {
          const h = Math.abs(by(p.r) - zeroY);
          return (
            <rect key={p.id} x={x(p.i) - bw / 2} y={p.r >= 0 ? zeroY - h : zeroY}
                  width={bw} height={Math.max(1, h)}
                  fill={p.r >= 0 ? "var(--long)" : "var(--short)"}
                  opacity={hov && hov.id !== p.id ? 0.3 : 0.9} />
          );
        })}

        {pts.map((p) => (
          <rect key={`h${p.id}`} x={x(p.i) - step / 2} y={PT} width={Math.max(step, 6)}
                height={curveH + GAP + barsH} fill="transparent" style={{ cursor: "crosshair" }}
                onMouseEnter={() => setHovId(p.id)} onMouseLeave={() => setHovId(null)} />
        ))}

        {hov && (
          <g pointerEvents="none">
            <line x1={x(hov.i)} x2={x(hov.i)} y1={PT} y2={barsTop + barsH}
                  stroke="var(--brass)" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={x(hov.i)} cy={cy(hov.cum)} r="3" fill="var(--brass)" />
          </g>
        )}
      </svg>

      {/* Three columns rather than space-between, so the date sits in the
          middle of the card and not merely between two labels of unequal
          length — which moves it every time the symbol changes. */}
      <div className="lp-foot">
        {hov ? (
          <>
            <span className="lp-l">
              <b className="disp">{hov.symbol}</b>
              <span className="lp-dim"> · {hov.exchange} · {hov.pattern || "no pattern"}</span>
            </span>
            {/* The exit date: the day this R landed and the curve stepped. */}
            <span className="lp-c mono">{dmy(hov.exit_date || hov.entry_date)}</span>
            <span className="lp-r mono"
                  style={{ color: hov.r >= 0 ? "var(--long)" : "var(--short)" }}>
              {rfmt(hov.r)}
              <span className="lp-dim"> · running {rfmt(win ? hov.cum : hov.life)}</span>
            </span>
          </>
        ) : summary ? (
          <>
            <span className="lp-l lp-dim">
              {summary.n} closed · {summary.symbols} symbol{summary.symbols === 1 ? "" : "s"}
              {" · "}{pct(summary.winRate, 0)} won
            </span>
            <span className="lp-c lp-dim mono">
              {dmy(summary.from)} – {dmy(summary.to)}
            </span>
            <span className="lp-r lp-dim">
              {/* One decimal, not two. This line is a glance at the window,
                  and the extra digit was the difference between reading the
                  worst trade and reading an ellipsis. */}
              best <b className="disp">{summary.best.symbol}</b> {rfmt(summary.best.r, 1)}
              {" · worst "}<b className="disp">{summary.worst.symbol}</b> {rfmt(summary.worst.r, 1)}
            </span>
          </>
        ) : null}
      </div>

      {styles}
    </div>
  );
}
