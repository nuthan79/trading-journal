"use client";

import { useMemo } from "react";
import { summaryParts } from "@/lib/dashboard";
import { rfmt, pct, rupee } from "@/lib/format";

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
      </div>

      {/*
        Two columns, and the second one exists to occupy the right edge.

        The narrative is capped at 92 characters because past that a line is
        genuinely hard to track, and the card spans the full 1440px — so a
        single paragraph left roughly six hundred pixels of nothing against
        the right border. That read as a fault rather than as a margin, and
        was flagged as one more than once.

        Widening the measure was the obvious answer and the wrong one: it
        trades a layout complaint for a reading one. What actually fixes it is
        putting something at the far edge, because whitespace between two
        blocks is a gutter while the same whitespace after the last block is a
        hole. The column holds what was already here and did not belong in the
        sentence — when the record starts and ends, and how much of it is
        measurable — so nothing was invented to fill it.
      */}
      <div className="sum-cols">
      {s.hasR ? (
        <p className="sum-body">
          {s.trades} closed trades over {s.monthsSpan} months. Expectancy{" "}
          <Fig tone={s.expectancy >= 0 ? "up" : "down"}>{rfmt(s.expectancy)}</Fig>{" "}
          per trade at a {pct(s.winRate)} win rate, for{" "}
          <Fig tone={s.totalR >= 0 ? "up" : "down"}>{rfmt(s.totalR)}</Fig> total.
          {" "}Deepest drawdown <Fig tone="risk">{s.maxDD.toFixed(2)}R</Fig>
          {isFinite(s.maxDDPct) && <> ({pct(s.maxDDPct)} of capital)</>}, worst
          losing run <Fig tone="risk">{s.worstStreak}</Fig> trading day{s.worstStreak === 1 ? "" : "s"}.
          {" "}{s.greenMonths} of {s.totalMonths} months and {s.greenQuarters} of{" "}
          {s.totalQuarters} quarters finished green.
        </p>
      ) : (
        // Nothing here has a stop yet, so there is no risk to divide by and no
        // honest R to quote. What the money did is still worth stating plainly.
        <p className="sum-body">
          {s.trades} closed trades over {s.monthsSpan} months, for{" "}
          <Fig tone={s.netPnl >= 0 ? "up" : "down"}>{rupee(s.netPnl)}</Fig>{" "}
          at a {pct(s.winRateByCount, 0)} win rate.
          {" "}{s.greenMonths} of {s.totalMonths} months and {s.greenQuarters} of{" "}
          {s.totalQuarters} quarters finished green.
          {" "}Expectancy and everything measured in R stay blank until these
          trades have a stop recorded — without one there's no risk to divide by,
          and a guess would quietly rewrite every figure built on it.
        </p>
      )}

        <aside className="sum-meta">
          <div className="sum-meta-row">
            <span>Covering</span>
            <b className="mono">{s.from} → {s.to}</b>
          </div>
          {s.hasR && (
            <div className="sum-meta-row">
              <span>Measured on</span>
              <b className="mono">{s.withR} of {s.trades}</b>
              {s.needStop > 0 && (
                <small>
                  {s.needStop} more {s.needStop === 1 ? "is" : "are"} waiting on a
                  stop — until then {s.needStop === 1 ? "it sits" : "they sit"} out
                  of every R figure here.
                </small>
              )}
            </div>
          )}
        </aside>
      </div>

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
        /*
          Prose left at its readable measure, meta pinned to the right edge.

          The second column is sized to its content rather than given a
          fraction of the row: the slack then lands between the two blocks,
          which is a gutter. Give that column a fraction and the slack
          reappears inside it against the border, which is the thing being
          fixed.
        */
        .sum-cols {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 14px 46px;
          align-items: start;
        }
        .sum-meta {
          border-left: 1px solid var(--rule); padding-left: 20px;
          display: flex; flex-direction: column; gap: 12px;
          max-width: 260px;
        }
        .sum-meta-row span {
          display: block; font-family: 'Archivo', sans-serif; font-size: 9.5px;
          letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink3);
          margin-bottom: 3px;
        }
        .sum-meta-row b { font-size: 13px; font-weight: 600; color: var(--ink2); }
        .sum-meta-row small {
          display: block; font-size: 11px; line-height: 1.55;
          color: var(--ink3); margin-top: 5px;
        }
        /*
          AFTER the .sum-meta rules, not before them.

          Written above, this had identical specificity to the base rule and
          simply lost to it: the column stacked correctly while keeping the
          left border and indent it only has as a divider between two columns.
          Broken on every phone, fine on every desktop, and no error anywhere.
        */
        @media (max-width: 900px) {
          .sum-cols { grid-template-columns: 1fr; }
          .sum-meta {
            border-left: 0; padding-left: 0; max-width: none;
            border-top: 1px solid var(--rule); padding-top: 12px;
          }
        }
        .sum-body {
          margin: 0;
          font-size: 17px;
          line-height: 1.62;
          color: var(--ink);
          text-align: left;
          /* This used to have no cap, on the grounds that .jwrap's 1180px was
             already the readability limit. It was — until .jwrap went to
             1440px for the sake of the Holdings table, at which point this
             paragraph quietly became a 150-character line.
             So it is capped in ch units rather than pixels: the measure is
             stated in characters because characters are what make a line hard
             to
             read, and it then holds whatever the container does next. A fixed
             px cap was tried before and rejected for leaving a dead gap on
             the right — this leaves the same gap, which is the honest cost of
             not making people track a line that far. */
          max-width: 92ch;
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
