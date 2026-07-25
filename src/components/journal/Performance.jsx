"use client";

import { useMemo, useState } from "react";
import { dimensionRows, DIMENSIONS, maxAbsTotalR, isThin } from "@/lib/edge";
import { mistakeCost, outcomeTagCounts } from "@/lib/analysis";
import { isExecutionError } from "@/lib/constants";
import { rupee, rfmt, pct } from "@/lib/format";
import Tile from "./Tile";
import PeriodPerformance from "./PeriodPerformance";

export default function Performance({ closed, S, accountSize, flows }) {
  const [dim, setDim] = useState("pattern");
  const D = DIMENSIONS.find((d) => d.id === dim) || DIMENSIONS[0];

  const groups = useMemo(
    () => dimensionRows(closed, dim, { accountSize }),
    [closed, dim, accountSize]
  );
  const maxAbs = useMemo(() => maxAbsTotalR(groups), [groups]);

  const mistakeRows = useMemo(() => mistakeCost(closed, isExecutionError), [closed]);
  const outcomeRows = useMemo(() => outcomeTagCounts(closed, isExecutionError), [closed]);

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
              <th className="num">Avg value</th><th className="num">Avg risk</th>
              <th className="num">Return on risk</th>
              <th style={{ width: "16%" }}></th>
            </tr></thead>
            <tbody>
              {groups.map((g) => {
                const wpx = (Math.abs(g.totalR) / maxAbs) * 100;
                return (
                  <tr key={g.key} style={{ opacity: isThin(g) ? 0.55 : 1 }}>
                    <td><b style={{ fontWeight: 500 }}>{g.key}</b></td>
                    <td className="num">{g.n}</td>
                    <td className="num">{pct(g.winRate, 0)}</td>
                    <td className="num pos">{rfmt(g.avgWin)}</td>
                    <td className="num neg">{rfmt(-g.avgLoss)}</td>
                    <td className={`num ${g.expectancy >= 0 ? "pos" : "neg"}`} style={{ fontWeight: 500 }}>
                      {rfmt(g.expectancy)}</td>
                    <td className={`num ${g.totalR >= 0 ? "pos" : "neg"}`}>{rfmt(g.totalR, 1)}</td>
                    <td className="num">{rupee(g.avgValue)}</td>
                    <td className="num" title={`${pct(g.avgRiskPct, 2)} of capital`}>{rupee(g.avgRisk)}</td>
                    <td className="num">{isFinite(g.returnOnRisk) ? `${g.returnOnRisk.toFixed(2)}×` : "—"}</td>
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
        {groups.some((g) => isThin(g)) && (
          <div className="hint" style={{ marginTop: 8 }}>
            Faded rows have fewer than 10 trades — noise, not signal. Read them as questions to watch, not conclusions.
          </div>
        )}
      </div>

      {mistakeRows.length > 0 && (
        <div className="sec">
          <div className="sechead">
            <div>
              <div className="eyebrow">What the mistakes cost</div>
              <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3 }}>
                Only counts trades where you tagged an execution error yourself.
              </div>
            </div>
          </div>
          <div className="card scroll">
            <table className="t">
              <thead><tr><th>Mistake</th><th className="num">Times</th>
                <th className="num">Win rate</th><th className="num">Expectancy</th><th className="num">Total R</th></tr></thead>
              <tbody>
                {mistakeRows.map((m) => (
                  <tr key={m.tag}>
                    <td>{m.tag}</td>
                    <td className="num">{m.count}</td>
                    <td className="num">{pct(m.winRate, 0)}</td>
                    <td className={`num ${m.avgR >= 0 ? "pos" : "neg"}`}>{rfmt(m.avgR)}</td>
                    <td className={`num ${m.totalR >= 0 ? "pos" : "neg"}`}>{rfmt(m.totalR, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {outcomeRows.length > 0 && (
        <div className="sec">
          <div className="sechead">
            <div>
              <div className="eyebrow">What didn't work</div>
              <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3 }}>
                Not mistakes — valid setups that simply didn't pay off, the cost of doing business
                in a breakout system. Kept separate so they don't bury the execution errors above.
              </div>
            </div>
          </div>
          <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 22 }}>
            {outcomeRows.map((o) => (
              <div key={o.tag}>
                <div className="mono" style={{ fontSize: 19, fontWeight: 500 }}>{o.count}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 2 }}>
                  {o.tag} · {pct(o.share, 0)} of trades
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
