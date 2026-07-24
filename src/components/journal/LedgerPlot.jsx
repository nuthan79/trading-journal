"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { rfmt } from "@/lib/format";

/** Signature plot — cumulative R above, per-trade R bars below. */
export default function LedgerPlot({ rows }) {
  const box = useRef(null);
  const [w, setW] = useState(900);
  const [hov, setHov] = useState(null);

  useEffect(() => {
    const on = () => box.current && setW(box.current.clientWidth);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const H = 300, PL = 46, PR = 14, PT = 16, GAP = 16;
  const curveH = 168, barsH = 74;
  const innerW = Math.max(120, w - PL - PR);

  const pts = useMemo(() => {
    let cum = 0;
    return rows.map((t, i) => { cum += t.r; return { ...t, i, cum }; });
  }, [rows]);

  if (!pts.length) {
    return (
      <div ref={box} className="card empty" style={{ minHeight: 220 }}>
        <div className="eyebrow">The plot</div>
        <p>Once you close your first trade, its R-multiple lands here — the running
          curve on top, every individual outcome as a bar below it.</p>
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

  return (
    <div ref={box} className="card" style={{ padding: "16px 14px 10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
                    padding: "0 6px 8px", flexWrap: "wrap", gap: 10 }}>
        <div className="eyebrow">Cumulative R · every closed trade in sequence</div>
        <div className="mono" style={{ fontSize: 20, color: last.cum >= 0 ? "var(--long)" : "var(--short)" }}>
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
                onMouseEnter={() => setHov(p)} onMouseLeave={() => setHov(null)} />
        ))}

        {hov && (
          <g pointerEvents="none">
            <line x1={x(hov.i)} x2={x(hov.i)} y1={PT} y2={barsTop + barsH}
                  stroke="var(--brass)" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={x(hov.i)} cy={cy(hov.cum)} r="3" fill="var(--brass)" />
          </g>
        )}
      </svg>

      <div style={{ padding: "2px 6px 4px", minHeight: 22, display: "flex",
                    justifyContent: "space-between", fontSize: 11.5, color: "var(--ink2)", gap: 12 }}>
        {hov ? (
          <>
            <span><b className="disp">{hov.symbol}</b>
              <span style={{ color: "var(--ink3)" }}> · {hov.exchange} · {hov.pattern || "no pattern"}</span></span>
            <span className="mono" style={{ color: hov.r >= 0 ? "var(--long)" : "var(--short)" }}>
              {rfmt(hov.r)} <span style={{ color: "var(--ink3)" }}>· running {rfmt(hov.cum)}</span>
            </span>
          </>
        ) : (
          <span style={{ color: "var(--ink3)" }}>{pts.length} closed trades · hover any point</span>
        )}
      </div>
    </div>
  );
}
