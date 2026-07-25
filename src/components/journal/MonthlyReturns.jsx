"use client";

import { useMemo, useState } from "react";
import { monthlyGrid, cellStyle } from "@/lib/dashboard";
import { rfmt, pct } from "@/lib/format";

/**
 * Monthly returns as a heatmap.
 *
 * Colour carries the magnitude so the shape of the year reads before any
 * individual number does — which stretch carried the account, where the flat
 * patches were. Empty months are drawn rather than skipped, because a month
 * with no trades is a fact about how you traded, not missing data.
 */

export default function MonthlyReturns({ closed }) {
  const grid = useMemo(() => monthlyGrid(closed), [closed]);
  const [hover, setHover] = useState(null);

  if (!grid) {
    return (
      <section className="mr-card mr-empty">
        <div className="eyebrow">Monthly returns in R</div>
        <p>Close a trade and its month appears here.</p>
        <style jsx>{`
          .mr-card { border:1px solid var(--rule); background:var(--card);
                     border-radius:3px; padding:30px 20px; text-align:center; }
          p { font-size:13px; color:var(--ink3); margin:8px 0 0; }
        `}</style>
      </section>
    );
  }

  const { years, best, worst, maxAbs, monthLabels } = grid;
  const monthName = (m) => monthLabels[m];

  return (
    <section className="mr-card">
      <div className="mr-head">
        <span className="eyebrow">Monthly returns in R</span>
        <span className="mr-key mono">green = profitable month</span>
      </div>

      <div className="mr-scroll">
        <div className="mr-grid">
          {/* header row */}
          <div className="mr-corner" />
          {monthLabels.map((m) => (
            <div key={m} className="mr-colhead">{m.toUpperCase()}</div>
          ))}
          <div className="mr-colhead mr-yearcol">YEAR</div>

          {years.map((y) => (
            <div key={y.year} className="mr-row" style={{ display: "contents" }}>
              <div className="mr-rowhead mono">{y.year}</div>

              {y.months.map((c) => {
                const st = cellStyle(c, maxAbs);
                const on = hover && hover.year === c.year && hover.month === c.month;
                return (
                  <div
                    key={`${c.year}-${c.month}`}
                    className="mr-cell mono"
                    style={{ ...st, outline: on ? "1.5px solid var(--brass)" : "none" }}
                    onMouseEnter={() => c.hasData && setHover(c)}
                    onMouseLeave={() => setHover(null)}
                  >
                    {c.hasData ? c.r.toFixed(1) : ""}
                  </div>
                );
              })}

              <div className={`mr-total mono ${y.total >= 0 ? "pos" : "neg"}`}>
                {y.total.toFixed(1)}R
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="mr-foot">
        {hover ? (
          <>
            <b>{monthName(hover.month)} {hover.year}</b> — {rfmt(hover.r)} across{" "}
            {hover.trades} trade{hover.trades === 1 ? "" : "s"}, {pct(hover.winRate, 0)} win rate.
          </>
        ) : (
          <>
            Best month {monthName(best.month)} {best.year} at {rfmt(best.r)}. Worst{" "}
            {monthName(worst.month)} {worst.year} at {rfmt(worst.r)}. Hover a cell for
            trade count and win rate. Months are bucketed by exit date, so a trade lands
            in the month it was closed.
          </>
        )}
      </p>

      <style jsx>{`
        .mr-card {
          border: 1px solid var(--rule);
          background: var(--card);
          border-radius: 3px;
          padding: 16px 20px 15px;
        }
        .mr-head {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 14px; border-bottom: 1px solid var(--rule);
          padding-bottom: 9px; margin-bottom: 14px;
        }
        .mr-key { font-size: 11px; color: var(--ink3); }

        .mr-scroll { overflow-x: auto; }
        .mr-grid {
          display: grid;
          grid-template-columns: 46px repeat(12, minmax(52px, 1fr)) 74px;
          gap: 4px;
          min-width: 720px;
        }
        .mr-colhead {
          font-family: 'Archivo', sans-serif;
          font-size: 9.5px; font-weight: 600; letter-spacing: 0.11em;
          color: var(--ink3); text-align: center; padding-bottom: 2px;
        }
        .mr-yearcol { padding-left: 8px; }
        .mr-corner { }
        .mr-rowhead {
          font-size: 13px; font-weight: 600; color: var(--ink);
          display: flex; align-items: center; justify-content: flex-end;
          padding-right: 8px;
        }
        .mr-cell {
          height: 42px; border-radius: 4px;
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 500;
          font-variant-numeric: tabular-nums;
          transition: outline-color 0.1s;
        }
        .mr-total {
          display: flex; align-items: center; justify-content: flex-end;
          font-size: 14px; font-weight: 600;
          padding-left: 8px;
          border-left: 1px solid var(--rule);
          margin-left: 4px;
        }
        .mr-total.pos { color: var(--long); }
        .mr-total.neg { color: var(--short); }

        .mr-foot {
          font-size: 12.5px; color: var(--ink2);
          margin: 13px 0 0; line-height: 1.6; max-width: 76ch; min-height: 40px;
        }
      `}</style>
    </section>
  );
}
