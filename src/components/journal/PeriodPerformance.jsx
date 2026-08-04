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

export default function PeriodPerformance({ closed, openingCapital, flows = [], all = [] }) {
  // Opens on financial years: a monthly table of a long record is dozens of
  // rows deep, and the first thing anyone wants from it is the shape of a
  // year. Months are one click away when the question gets narrower.
  const [grain, setGrain] = useState("year");
  const [basis, setBasis] = useState("exit");
  const byEntry = basis === "entry";

  const rows = useMemo(
    () => byPeriod(closed, grain, { openingCapital, flows, basis, universe: all }),
    [closed, grain, openingCapital, flows, basis, all]
  );

  // Entries made in the period but not yet closed. They carry no R, so an
  // entry-basis row is only ever a partial verdict until they finish.
  const pending = useMemo(
    () => rows.reduce((a, r) => a + Math.max(0, (r.started ?? 0) - (r.settled ?? 0)), 0),
    [rows]
  );

  /**
   * What an average period came to.
   *
   * The table already carries this and makes the reader do the division, which
   * is the sort of arithmetic people carry around in their heads wrongly.
   *
   * Divided by the periods LISTED, not by calendar months elapsed, because
   * `byPeriod` only builds a bucket where trades exist — a month you sat out
   * has no row. Those two are the same number for anyone who traded every
   * month and different for everyone else, so the divisor is printed beside
   * the figures rather than left to be assumed.
   */
  const grainWord = grain === "month" ? "month"
    : grain === "quarter" ? "quarter" : "financial year";

  const totals = useMemo(() => {
    if (!rows.length) return null;
    // Guarded: a period whose trades all lack a stop has no totalR, and one
    // undefined turns the whole sum into NaN — so the footer read "—" while
    // the tile above it reported a real figure from the trades that do have one.
    const num = (v) => (isFinite(v) ? v : 0);
    return {
      trades: rows.reduce((a, r) => a + r.trades, 0),
      pnl: rows.reduce((a, r) => a + num(r.pnl), 0),
      totalR: rows.reduce((a, r) => a + num(r.totalR), 0),
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

  // Math.max poisons to NaN if any input is, which would size every bar at
  // NaN% the moment one period has no stop recorded.
  const maxAbsR = Math.max(...rows.map((r) => Math.abs(r.totalR)).filter(isFinite), 1);

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
            {byEntry
              ? " Grouped by when each trade was entered — how the decisions taken then worked out."
              : " Grouped by when each trade was closed — when the money was actually realised."}
          </div>
        </div>
        <div className="pp-controls">
          <div className="seg">
            <button data-on={basis === "exit" ? 1 : 0} onClick={() => setBasis("exit")}>By exit</button>
            <button data-on={byEntry ? 1 : 0} onClick={() => setBasis("entry")}>By entry</button>
          </div>
          <div className="seg">
            {GRAINS.map((g) => (
              <button key={g.id} data-on={grain === g.id ? 1 : 0} onClick={() => setGrain(g.id)}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {byEntry && (
        <div className="pp-note">
          Return, drawdown and the capital walk are blank here — they describe money
          arriving, and this view is grouped by when trades were started.
          {pending > 0 && (
            <> {pending} {pending === 1 ? "entry is" : "entries are"} still open, so the
            most recent periods only reflect the trades that have finished — which
            skews toward whichever you exit fastest.</>
          )}
        </div>
      )}

      <div className="card scroll">
        <table className="t">
          <thead>
            <tr>
              <th>Period</th>
              <th className="num">{byEntry ? "Closed" : "Trades"}</th>
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
                <td className="num"
                    title={byEntry && r.started > r.settled
                      ? `${r.started - r.settled} entered this period and still open`
                      : undefined}>
                  {byEntry ? <>{r.settled}<span className="pp-dim"> / {r.started}</span></> : r.trades}
                </td>
                <td className={`num ${r.pnl >= 0 ? "pos" : "neg"}`} style={{ fontWeight: 500 }}>
                  {rupee(r.pnl)}
                </td>
                <td className={`num ${r.returnPct >= 0 ? "pos" : "neg"}`}>
                  {r.returnPct == null ? <span className="pp-dim">—</span> : signedPct(r.returnPct)}
                </td>
                <td className={`num ${r.totalR >= 0 ? "pos" : "neg"}`}>{rfmt(r.totalR, 1)}</td>
                <td className={`num ${r.expectancy >= 0 ? "pos" : "neg"}`}>{rfmt(r.expectancy)}</td>
                <td className="num">{pct(r.winRate, 0)}</td>
                <td className="num">{rupee(r.avgValue)}</td>
                <td className="num" title={r.avgRiskPct != null ? `${pct(r.avgRiskPct, 2)} of capital` : undefined}>
                  {rupee(r.avgRisk)}
                  {r.avgRiskPct != null && <span className="pp-dim"> · {pct(r.avgRiskPct, 2)}</span>}
                </td>
                <td className="num">
                  {r.maxDD == null ? <span className="pp-dim">—</span> : `${r.maxDD.toFixed(1)}R`}
                </td>
                <td>
                  <div className="pp-bar" data-side={r.totalR >= 0 ? "pos" : "neg"}>
                    <div style={{
                      width: isFinite(r.totalR)
                        ? `${(Math.abs(r.totalR) / maxAbsR) * 100}%`
                        : 0,
                    }} />
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
                {/* Header has 11 columns: 5 filled above + these 5 + the bar
                    column below. Getting this sum wrong shifts the whole
                    footer row out of line with the body. */}
                <td colSpan={5} className="num pp-dim">
                  {totals.green} of {rows.length} periods green
                </td>
                <td></td>
              </tr>
              {rows.length > 1 && (
                <tr className="pp-avg">
                  <td><b>Per {grainWord}</b></td>
                  <td className="num pp-dim">{(totals.trades / rows.length).toFixed(1)}</td>
                  <td className={`num ${totals.pnl >= 0 ? "pos" : "neg"}`}>
                    {rupee(totals.pnl / rows.length)}
                  </td>
                  <td className="num pp-dim">—</td>
                  <td className={`num ${totals.totalR >= 0 ? "pos" : "neg"}`}>
                    {rfmt(totals.totalR / rows.length)}
                  </td>
                  {/* The divisor, said out loud. A period you didn't trade has
                      no row here, so this is per period traded — which is the
                      same as per calendar month only if you never sat one out. */}
                  <td colSpan={5} className="num pp-dim">
                    across {rows.length} {grainWord}
                    {rows.length === 1 ? "" : grain === "year" ? "s" : "s"} with trades
                  </td>
                  <td></td>
                </tr>
              )}
            </tfoot>
          )}
        </table>
      </div>

      <style jsx>{`
        .pp-head {
          display: flex; align-items: flex-end; justify-content: space-between;
          gap: 14px; flex-wrap: wrap; margin-bottom: 10px;
        }
        .pp-sub { font-size: 12px; color: var(--ink2); margin-top: 3px; max-width: 620px; }
        .pp-dim { color: var(--ink3); font-size: 11px; }
        /* Lighter than the total above it: a derived figure, not a sum. */
        .pp-avg td { border-top: 1px solid var(--rule); }
        .pp-avg b { font-weight: 500; color: var(--ink2); }
        .pp-controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .pp-note {
          font-size: 11.5px; color: var(--ink3); line-height: 1.6;
          border-left: 2px solid var(--brass); padding: 2px 0 2px 10px;
          margin-bottom: 10px; max-width: 700px; text-wrap: pretty;
        }
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
