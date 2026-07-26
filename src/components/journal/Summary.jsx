"use client";

import { useMemo } from "react";
import { summaryParts } from "@/lib/dashboard";
import { rfmt, pct } from "@/lib/format";

/**
 * The whole record in one paragraph.
 *
 * Highlighting is split two ways on purpose: the return figures in accent,
 * the risk figures in red. Colouring everything green whenever it's positive
 * turns the paragraph into a scoreboard — the drawdown and the losing run are
 * the numbers you most need to keep looking at, especially in a good stretch.
 */

const Fig = ({ children, tone }) => (
  <span className={`sum-fig ${tone || ""}`}>{children}</span>
);

export default function Summary({ closed, openingCapital, flows = [] }) {
  const s = useMemo(
    () => summaryParts(closed, { openingCapital, flows }),
    [closed, openingCapital, flows]
  );

  if (!s) {
    return (
      <section className="sum-card">
        <div className="sum-head"><span className="eyebrow">Summary</span></div>
        <p className="sum-body sum-empty">
          Close your first trade and the record starts here.
        </p>
        <style jsx>{`
          .sum-card { border:1px solid var(--rule); background:var(--card);
                      border-radius:3px; padding:16px 20px 18px; }
          .sum-head { border-bottom:1px solid var(--rule); padding-bottom:9px; margin-bottom:12px; }
          .sum-body { margin:0; font-size:15px; color:var(--ink3); }
        `}</style>
      </section>
    );
  }

  return (
    <section className="sum-card">
      <div className="sum-head">
        <span className="eyebrow">Summary</span>
        <span className="sum-range mono">{s.from} → {s.to}</span>
      </div>

      <p className="sum-body">
        {s.trades} closed trades over {s.monthsSpan} months. Expectancy{" "}
        <Fig tone={s.expectancy >= 0 ? "up" : "down"}>{rfmt(s.expectancy)}</Fig>{" "}
        per trade at a {pct(s.winRate)} win rate, for{" "}
        <Fig tone={s.totalR >= 0 ? "up" : "down"}>{rfmt(s.totalR)}</Fig> total.
        {" "}Deepest drawdown <Fig tone="risk">{s.maxDD.toFixed(2)}R</Fig>
        {isFinite(s.maxDDPct) && <> ({pct(s.maxDDPct)} of capital)</>}, worst
        losing run <Fig tone="risk">{s.worstStreak}</Fig> trades.
        {" "}{s.greenMonths} of {s.totalMonths} months and {s.greenQuarters} of{" "}
        {s.totalQuarters} quarters finished green.
      </p>

      <style jsx>{`
        .sum-card {
          border: 1px solid var(--rule);
          background: var(--card);
          border-radius: 3px;
          padding: 16px 20px 18px;
        }
        .sum-head {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 14px; border-bottom: 1px solid var(--rule);
          padding-bottom: 9px; margin-bottom: 13px;
        }
        .sum-range { font-size: 11px; color: var(--ink3); letter-spacing: 0.02em; }
        .sum-body {
          margin: 0;
          font-size: 17px;
          line-height: 1.62;
          color: var(--ink);
          text-align: left;
          /* No max-width here — the card itself is already bounded by
             .jwrap's 1180px container, same as every other dashboard
             section, so that's the readability limit. A tighter fixed
             cap left a dead gap on the right at desktop widths. */
          /* Keeps the last line from orphaning a word or two */
          text-wrap: pretty;
        }
        @media (max-width: 720px) { .sum-body { font-size: 15px; } }
      `}</style>

      <style jsx global>{`
        /* Figures stay in the body font.
           Setting them in Spline Sans Mono looked deliberate in isolation but
           read badly inline: a mono face at the same font-size carries a
           larger x-height and a wider advance, so each figure sat heavier
           than the words around it and the spacing looked uneven. Archivo's
           own tabular numerals give aligned digits without breaking the
           line's rhythm. */
        .sum-fig {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .sum-fig.up   { color: #4A5AA0; }
        .sum-fig.down { color: var(--short); }
        .sum-fig.risk { color: #B5442A; }
      `}</style>
    </section>
  );
}
