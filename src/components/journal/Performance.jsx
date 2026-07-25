"use client";

import { useMemo, useState } from "react";
import { stats } from "@/lib/calc";
import { rfmt, pct } from "@/lib/format";
import Tile from "./Tile";
import PeriodPerformance from "./PeriodPerformance";

const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));

function band(v, edges, labels) {
  if (!isFinite(v)) return "Not recorded";
  for (let i = 0; i < edges.length; i++) if (v < edges[i]) return labels[i];
  return labels[labels.length - 1];
}

const DIMENSIONS = [
  { id: "pattern", label: "Base pattern", get: (t) => t.pattern || "Not recorded" },
  { id: "dist", label: "Extension at entry",
    get: (t) => band(t.distPivot, [0, 2, 5], ["Below pivot", "0–2% above", "2–5% above", "Over 5% above"]) },
  { id: "vol", label: "Breakout volume",
    get: (t) => band(num(t.vol_pct_avg), [100, 150, 250, 400],
      ["Below average", "100–150%", "150–250%", "250–400%", "Over 400%"]) },
  { id: "stage", label: "Weinstein stage",
    get: (t) => (t.weinstein_stage ? `Stage ${t.weinstein_stage}` : "Not recorded") },
  { id: "rs", label: "RS rank",
    get: (t) => band(num(t.rs_rank), [70, 80, 90], ["Under 70", "70–79", "80–89", "90+"]) },
  { id: "exit", label: "Exit reason", get: (t) => t.exit_reason || "Not recorded" },
  { id: "hold", label: "Holding period",
    get: (t) => band(t.heldDays, [5, 15, 40], ["Under 5 days", "5–15 days", "15–40 days", "Over 40 days"]) },
  { id: "month", label: "Month", get: (t) => (t.exit_date || t.entry_date || "").slice(0, 7) || "—" },
];

export default function Performance({ closed, S, accountSize, flows }) {
  const [dim, setDim] = useState("pattern");
  const D = DIMENSIONS.find((d) => d.id === dim);

  const groups = useMemo(() => {
    const m = new Map();
    closed.forEach((t) => {
      const k = D.get(t);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    });
    return [...m.entries()]
      .map(([k, rows]) => ({ k, ...stats(rows) }))
      .sort((a, b) => b.totalR - a.totalR);
  }, [closed, D]);

  const mistakeCost = useMemo(() => {
    const m = new Map();
    closed.forEach((t) => (t.mistakes || []).forEach((x) => {
      if (!m.has(x)) m.set(x, []);
      m.get(x).push(t);
    }));
    return [...m.entries()].map(([k, rows]) => ({ k, ...stats(rows) }))
      .sort((a, b) => a.totalR - b.totalR);
  }, [closed]);

  if (!closed.length) {
    return (
      <div className="sec card empty">
        <div className="eyebrow">Performance sheet</div>
        <p>This page reads your closed trades and tells you which setups actually pay.
          It needs closed trades to read. Log a few and come back.</p>
      </div>
    );
  }

  return (
    <>
      <div className="sec grid4">
        <Tile label="Total R" value={rfmt(S.totalR, 1)} tone={S.totalR >= 0 ? "pos" : "neg"}
              sub={`${S.n} trades`} />
        <Tile label="Average win" value={rfmt(S.avgWin)} tone="pos"
              sub={`best ${rfmt(S.best)}`} />
        <Tile label="Average loss" value={rfmt(-S.avgLoss)} tone="neg"
              sub={`worst ${rfmt(S.worst)}`} />
        <Tile label="Max drawdown" value={`${S.maxDD.toFixed(1)}R`}
              sub={`longest losing run ${S.worstL}`} />
      </div>

      <div className="sec">
        <PeriodPerformance closed={closed} openingCapital={accountSize} flows={flows} />
      </div>

      <div className="sec">
        <div className="sechead">
          <div>
            <div className="eyebrow">Where the edge is</div>
            <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3 }}>
              Same trades, cut a different way. Expectancy is the column that matters.
            </div>
          </div>
        </div>
        <div className="seg" style={{ marginBottom: 12 }}>
          {DIMENSIONS.map((d) => (
            <button key={d.id} data-on={dim === d.id ? 1 : 0} onClick={() => setDim(d.id)}>{d.label}</button>
          ))}
        </div>
        <div className="card scroll">
          <table className="t">
            <thead><tr>
              <th>{D.label}</th>
              <th className="num">Trades</th><th className="num">Win rate</th>
              <th className="num">Avg win</th><th className="num">Avg loss</th>
              <th className="num">Expectancy</th><th className="num">Total R</th>
              <th style={{ width: "22%" }}></th>
            </tr></thead>
            <tbody>
              {groups.map((g) => {
                const maxAbs = Math.max(...groups.map((x) => Math.abs(x.totalR)), 1);
                const wpx = (Math.abs(g.totalR) / maxAbs) * 100;
                return (
                  <tr key={g.k}>
                    <td><b style={{ fontWeight: 500 }}>{g.k}</b></td>
                    <td className="num">{g.n}</td>
                    <td className="num">{pct(g.winRate, 0)}</td>
                    <td className="num pos">{rfmt(g.avgWin)}</td>
                    <td className="num neg">{rfmt(-g.avgLoss)}</td>
                    <td className={`num ${g.expectancy >= 0 ? "pos" : "neg"}`} style={{ fontWeight: 500 }}>
                      {rfmt(g.expectancy)}</td>
                    <td className={`num ${g.totalR >= 0 ? "pos" : "neg"}`}>{rfmt(g.totalR, 1)}</td>
                    <td>
                      <div style={{ display: "flex", justifyContent: g.totalR >= 0 ? "flex-start" : "flex-end" }}>
                        <div style={{ width: `${wpx}%`, height: 7, borderRadius: 1,
                                      background: g.totalR >= 0 ? "var(--long)" : "var(--short)", opacity: 0.75 }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {groups.some((g) => g.n < 10) && (
          <div className="hint" style={{ marginTop: 8 }}>
            Rows with fewer than about 10 trades are noise, not signal. Read them as questions to watch, not conclusions.
          </div>
        )}
      </div>

      {mistakeCost.length > 0 && (
        <div className="sec">
          <div className="sechead">
            <div>
              <div className="eyebrow">What the mistakes cost</div>
              <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3 }}>
                Only counts trades where you tagged the mistake yourself.
              </div>
            </div>
          </div>
          <div className="card scroll">
            <table className="t">
              <thead><tr><th>Mistake</th><th className="num">Times</th>
                <th className="num">Win rate</th><th className="num">Expectancy</th><th className="num">Total R</th></tr></thead>
              <tbody>
                {mistakeCost.map((m) => (
                  <tr key={m.k}>
                    <td>{m.k}</td>
                    <td className="num">{m.n}</td>
                    <td className="num">{pct(m.winRate, 0)}</td>
                    <td className={`num ${m.expectancy >= 0 ? "pos" : "neg"}`}>{rfmt(m.expectancy)}</td>
                    <td className={`num ${m.totalR >= 0 ? "pos" : "neg"}`}>{rfmt(m.totalR, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
