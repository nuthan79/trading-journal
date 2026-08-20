"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { dimensionRows, DIMENSIONS, maxAbsTotalR, isThin, NOT_RECORDED, edgeHref } from "@/lib/edge";
import { mistakeCost, outcomeTagCounts } from "@/lib/analysis";
import { isExecutionError } from "@/lib/constants";
import { rupee, rfmt, pct } from "@/lib/format";

/**
 * Where the edge is — the same trades, cut ten ways.
 *
 * MOVED OUT OF PERFORMANCE, AND THE NAME IS THE REASON. `edge.js` computes this
 * table and always has; meanwhile the tab called Edge was running
 * `expectancy.js` and projecting a curve. The modules and the tabs were saying
 * opposite things. This is the screen with the claim on the word: it reports
 * where an edge actually was, in trades that were actually taken. The projection
 * next door is a question, and it is now called What-if.
 *
 * WHAT PERFORMANCE KEEPS. Totals, period returns and capital deployment — the
 * statement, consulted the way a statement is. This is the argument about it,
 * which is a different act and a less frequent one.
 *
 * THE THREE TABLES BELONG TOGETHER because they are one idea: group the trades
 * by something and see what each group earned. By setup, by execution error, by
 * what the market did. Splitting them across two screens, which is how it was,
 * meant the cost of a mistake sat a long way from the setups it happened in.
 */
export default function Edge({ closed = [], accountSize }) {
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
        <div className="eyebrow">Where the edge is</div>
        <p>This reads your closed trades and tells you which setups actually pay.
          It needs closed trades to read. Log a few and come back.</p>
      </div>
    );
  }

  return (
    <>
      <div className="sec">
        <div className="sechead">
          <div>
            <div className="eyebrow">Where the edge is</div>
            <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3 }}>
              Same trades, cut a different way. Expectancy is the column that matters.
              <b> Click any row</b> to see the trades in it.
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
              <th className="num">Net P&amp;L</th>
              <th className="num">Avg value</th><th className="num">Avg risk</th>
              <th className="num">Return on risk</th>
              <th style={{ width: "16%" }}></th>
            </tr></thead>
            <tbody>
              {groups.map((g) => {
                const wpx = (Math.abs(g.totalR) / maxAbs) * 100;
                return (
                  <tr key={g.key} style={{ opacity: isThin(g) ? 0.55 : 1 }}>
                    {/* The row is the way in, exactly as it is in the mistakes
                        table below. A table that costs a slice out and then
                        offers no route to the trades inside it is where the
                        reader has to go and find them by hand. */}
                    <td>
                      <Link className="mk-link" href={edgeHref(dim, g)}
                            title={`See the ${g.trades} trade${g.trades === 1 ? "" : "s"} in ${g.key}`}
                            style={g.key === NOT_RECORDED
                              ? { fontStyle: "italic", color: "var(--ink3)" }
                              : { fontWeight: 500 }}>
                        {g.key}
                      </Link>
                    </td>
                    <td className="num">{g.n}</td>
                    <td className="num">{pct(g.winRate, 0)}</td>
                    <td className="num pos">{rfmt(g.avgWin)}</td>
                    <td className="num neg">{rfmt(-g.avgLoss)}</td>
                    <td className={`num ${g.expectancy >= 0 ? "pos" : "neg"}`} style={{ fontWeight: 500 }}>
                      {rfmt(g.expectancy)}</td>
                    <td className={`num ${g.totalR >= 0 ? "pos" : "neg"}`}>{rfmt(g.totalR, 1)}</td>
                    {/* Net of charges — grossRealised minus charges, the same
                        figure returnOnRisk beside it is already built from. R
                        answers whether the setup works; this answers what it
                        paid, and they part company whenever risk per trade
                        was not constant. */}
                    <td className={`num ${g.netPnl >= 0 ? "pos" : "neg"}`} style={{ fontWeight: 500 }}>
                      {rupee(g.netPnl)}
                    </td>
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
            Faded rows have fewer than 15 trades — noise, not signal. Read them as questions to watch, not conclusions.
          </div>
        )}
        {/* Only on the rupee cut. Every other dimension here is either
            categorical or already normalised; this is the one whose bands
            drift as the account grows, and saying so is cheaper than letting
            someone read a decade of compounding as a finding about sizing. */}
        {dim === "riskamt" && (
          <div className="hint" style={{ marginTop: 8 }}>
            Rupee risk isn&rsquo;t comparable across a growing account — ₹15k against ₹20L
            is a large bet, the same ₹15k against ₹1.2Cr is a small one. If your capital
            has grown a lot, the low bands hold mostly early trades and the high bands
            mostly recent ones, so some of what you see here is <b>when</b> rather than
            how much. <b>Risk % of capital</b> is the same question with that removed.
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
                Net P&amp;L is what those trades came to, not what the mistake cost you —
                nobody can know what the same trade would have done without it.
                <b> Click a mistake</b> to see the trades behind it.
              </div>
            </div>
          </div>
          <div className="card scroll">
            <table className="t">
              <thead><tr><th>Mistake</th><th className="num">Times</th>
                <th className="num">Win rate</th><th className="num">Expectancy</th>
                <th className="num">Total R</th><th className="num">Net P&amp;L</th></tr></thead>
              <tbody>
                {mistakeRows.map((m) => (
                  <tr key={m.tag}>
                    {/* The row is the way in. Costing a tag out and then
                        offering no route to the trades behind it is where this
                        table used to stop. */}
                    <td>
                      <Link className="mk-link"
                            href={`/trades?mistake=${encodeURIComponent(m.tag)}`}
                            title={`See the ${m.count} trade${m.count === 1 ? "" : "s"} tagged "${m.tag}"`}>
                        {m.tag}
                      </Link>
                    </td>
                    <td className="num">{m.count}</td>
                    <td className="num">{pct(m.winRate, 0)}</td>
                    <td className={`num ${m.avgR >= 0 ? "pos" : "neg"}`}>{rfmt(m.avgR)}</td>
                    <td className={`num ${m.totalR >= 0 ? "pos" : "neg"}`}>{rfmt(m.totalR, 1)}</td>
                    <td className={`num ${m.netPnl >= 0 ? "pos" : "neg"}`} style={{ fontWeight: 500 }}>
                      {rupee(m.netPnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Same tags, different question. Mindset asks WHEN these happen —
              which state they cluster in — and this asks what they cost. Worth
              pointing at, and worth keeping to two screens: a third table of
              the same tags would mean the split had stopped meaning anything. */}
          <div className="hint" style={{ marginTop: 8 }}>
            <Link href="/analysis/mindset">Mindset</Link> groups the same tags by the
            state you were in when the trade was taken.
          </div>
        </div>
      )}

      {outcomeRows.length > 0 && (
        <div className="sec">
          <div className="sechead">
            <div>
              <div className="eyebrow">What didn&rsquo;t work</div>
              <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3 }}>
                Not mistakes — valid setups that simply didn&rsquo;t pay off, the cost of doing business
                in a breakout system. Kept separate so they don&rsquo;t bury the execution errors above.
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

      {/* global: the anchor is rendered by next/link rather than by this
          component's own JSX, so a scoped block would not reach it. Prefixed
          to keep it from leaking onto other links. */}
      <style jsx global>{`
        .mk-link {
          color: inherit; text-decoration: none;
          border-bottom: 1px dotted var(--ink3);
        }
        .mk-link:hover { color: var(--brass); border-bottom-color: var(--brass); }
      `}</style>
    </>
  );
}
