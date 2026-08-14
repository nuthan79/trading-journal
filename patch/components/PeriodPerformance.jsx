"use client";

import { useState, useMemo } from "react";
import { byPeriod } from "@/lib/calc";
import { rupee, rfmt, pct, signedPct } from "@/lib/format";

/**
 * Performance by period — month, financial-year quarter, financial year.
 *
 * Quarters follow the Indian financial year (Apr–Mar), so FY26 Q1 is
 * Apr–Jun 2025. That's the boundary your tax reconciliation uses, which makes
 * it the useful one even though calendar quarters are the habit elsewhere.
 *
 * Each row carries both views: R for judging the system, rupees for judging
 * the account. Return % is measured against the capital in play during that
 * period rather than today's balance, so an early period isn't flattered by
 * money you added later.
 */

const GRAINS = [
  { id: "month", label: "Monthly" },
  { id: "quarter", label: "Quarterly" },
  { id: "year", label: "Financial year" },
];

export default function PeriodPerformance({ closed, openingCapital, flows = [] }) {
  const [grain, setGrain] = useState("quarter");

  const rows = useMemo(
    () => byPeriod(closed, grain, { openingCapital, flows }),
    [closed, grain, openingCapital, flows]
  );

  const totals = useMemo(() => {
    if (!rows.length) return null;
    return {
      trades: rows.reduce((a, r) => a + r.trades, 0),
      pnl: rows.reduce((a, r) => a + r.pnl, 0),
      totalR: rows.reduce((a, r) => a + r.totalR, 0),
      green: rows.filter((r) => r.pnl > 0).length,
    };
  }, [rows]);

  if (!closed.length) {
    return (
      <div className="pp-empty">
        <div className="eyebrow">Performance by period</div>
        <p>Close a few trades and the monthly, quarterly and yearly breakdowns appear here.</p>
      </div>
    );
  }

  const maxAbsR = Math.max(...rows.map((r) => Math.abs(r.totalR)), 1);

  return (
    <section>
      <div className="pp-head">
        <div>
          <div className="eyebrow">Performance by period</div>
          <div className="pp-sub">
            {grain === "month"
              ? "Calendar months."
              : grain === "quarter"
              ? "Financial-year quarters — Q1 is April to June."
              : "Financial years, April to March."}
          </div>
        </div>
        <div className="seg">
          {GRAINS.map((g) => (
            <button key={g.id} data-on={grain === g.id ? 1 : 0} onClick={() => setGrain(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card scroll">
        <table className="t">
          <thead>
            <tr>
              <th>Period</th>
              <th className="num">Trades</th>
              <th className="num">Net P&amp;L</th>
              <th className="num">Return</th>
              <th className="num">Total R</th>
              <th className="num">Expectancy</th>
              <th className="num">Win rate</th>
              <th className="num">Avg value</th>
              <th className="num">Avg risk</th>
              <th className="num">Max DD</th>
              <th style={{ width: "13%" }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td><b style={{ fontWeight: 600 }}>{r.key}</b></td>
                <td className="num">{r.trades}</td>
                <td className={`num ${r.pnl >= 0 ? "pos" : "neg"}`} style={{ fontWeight: 500 }}>
                  {rupee(r.pnl)}
                </td>
                <td className={`num ${r.returnPct >= 0 ? "pos" : "neg"}`}>
                  {signedPct(r.returnPct)}
                </td>
                <td className={`num ${r.totalR >= 0 ? "pos" : "neg"}`}>{rfmt(r.totalR, 1)}</td>
                <td className={`num ${r.expectancy >= 0 ? "pos" : "neg"}`}>{rfmt(r.expectancy)}</td>
                <td className="num">{pct(r.winRate, 0)}</td>
                <td className="num">{rupee(r.avgValue)}</td>
                <td className="num" title={`${pct(r.avgRiskPct, 2)} of capital`}>
                  {rupee(r.avgRisk)}
                  <span className="pp-dim"> · {pct(r.avgRiskPct, 2)}</span>
                </td>
                <td className="num">{r.maxDD.toFixed(1)}R</td>
                <td>
                  <div className="pp-bar" data-side={r.totalR >= 0 ? "pos" : "neg"}>
                    <div style={{ width: `${(Math.abs(r.totalR) / maxAbsR) * 100}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          {totals && (
            <tfoot>
              <tr>
                <td><b>All</b></td>
                <td className="num">{totals.trades}</td>
                <td className={`num ${totals.pnl >= 0 ? "pos" : "neg"}`} style={{ fontWeight: 500 }}>
                  {rupee(totals.pnl)}
                </td>
                <td className="num pp-dim">—</td>
                <td className={`num ${totals.totalR >= 0 ? "pos" : "neg"}`}>
                  {rfmt(totals.totalR, 1)}
                </td>
                <td colSpan={5} className="num pp-dim">
                  {totals.green} of {rows.length} periods green
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <style jsx>{`
        .pp-head {
          display: flex; align-items: flex-end; justify-content: space-between;
          gap: 14px; flex-wrap: wrap; margin-bottom: 10px;
        }
        .pp-sub { font-size: 12px; color: var(--ink2); margin-top: 3px; }
        .pp-dim { color: var(--ink3); font-size: 11px; }
        .pp-bar { display: flex; height: 7px; }
        .pp-bar[data-side="neg"] { justify-content: flex-end; }
        .pp-bar > div { border-radius: 1px; opacity: 0.75; }
        .pp-bar[data-side="pos"] > div { background: var(--long); }
        .pp-bar[data-side="neg"] > div { background: var(--short); }
        .pp-empty {
          border: 1px solid var(--rule); background: var(--card);
          border-radius: 3px; padding: 34px 20px; text-align: center;
        }
        .pp-empty p { font-size: 13px; color: var(--ink3); max-width: 340px; margin: 8px auto 0; }
        tfoot td { border-top: 1px solid var(--ink3); border-bottom: 0; }
      `}</style>
    </section>
  );
}
