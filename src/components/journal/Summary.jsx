"use client";

import { useMemo } from "react";
import { summaryParts } from "@/lib/dashboard";
import { rfmt, pct, money } from "@/lib/format";
import Money from "@/components/Money";

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

export default function Summary({ closed, banking = [], openingCapital, flows = [] }) {
  const s = useMemo(
    () => summaryParts(closed, { openingCapital, flows, banking }),
    [closed, banking, openingCapital, flows]
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
        <span className="sum-right">
          {/* Where R first appears on the first screen anybody sees, and the
              only word in this paragraph a newcomer cannot be expected to know. */}
          {s.hasR && (
            <a className="sum-learn" href="/learn/what-is-an-r-multiple"
               target="_blank" rel="noopener">What is R?</a>
          )}
          <span className="sum-range mono">{s.from} → {s.to}</span>
        </span>
      </div>

      {s.hasR ? (
        <p className="sum-body">
          {s.trades} closed trades over {s.monthsSpan} months. Expectancy{" "}
          {/* Muted while the sample is thin. The accent tone is what makes a
              figure read as a finding, and on five trades expectancy is not
              one — it is arithmetic on a sample a single trade can swing. The
              sentence after the paragraph says so in words; this stops the
              number looking settled before anyone reaches it. */}
          <Fig tone={s.rConfidence === "thin" ? "muted"
                     : s.expectancy >= 0 ? "up" : "down"}>{rfmt(s.expectancy)}</Fig>{" "}
          per trade at a {pct(s.winRate)} win rate, for{" "}
          <Fig tone={s.totalR >= 0 ? "up" : "down"}>{rfmt(s.totalR)}</Fig> total
          {/* The rupees, which this paragraph never said — and now the one
              headline figure the folded tiles below would otherwise hide. */}
          {isFinite(s.netPnl) && (
            <>, <Fig tone={s.netPnl >= 0 ? "up" : "down"}><Money v={s.netPnl} /></Fig> after charges</>
          )}.
          {" "}Deepest drawdown <Fig tone="risk">{s.maxDD.toFixed(2)}R</Fig>
          {isFinite(s.maxDDPct) && <> ({pct(s.maxDDPct)} of capital)</>}, worst
          losing run <Fig tone="risk">{s.worstStreak}</Fig> trading day{s.worstStreak === 1 ? "" : "s"}.
          {" "}{s.greenMonths} of {s.totalMonths} months and {s.greenQuarters} of{" "}
          {s.totalQuarters} quarters finished green.
          {s.needStop > 0 && (
            <> Measured across the {s.withR} with a stop recorded;{" "}
            <Fig tone="risk">{s.needStop}</Fig> more are waiting on one.</>
          )}
          {/* Said last, and only while it is true. A book of thirty or more
              gets the paragraph it always had; a book of five gets told that
              the figure above is not yet a number about its trading. */}
          {s.rConfidence === "thin" && (
            <> Expectancy on {s.withR} trade{s.withR === 1 ? "" : "s"} is not yet
            a reading on your trading — one trade moves it further than most
            systems earn in a year. It settles somewhere around thirty.</>
          )}
          {s.rConfidence === "early" && (
            <> On {s.withR} trades these are worth watching rather than acting
            on; expectancy steadies around thirty.</>
          )}
        </p>
      ) : (
        // Nothing here has a stop yet, so there is no risk to divide by and no
        // honest R to quote. What the money did is still worth stating plainly.
        <p className="sum-body">
          {s.trades} closed trades over {s.monthsSpan} months, for{" "}
          <Fig tone={s.netPnl >= 0 ? "up" : "down"}><Money v={s.netPnl} /></Fig>{" "}
          at a {pct(s.winRateByCount, 0)} win rate.
          {" "}{s.greenMonths} of {s.totalMonths} months and {s.greenQuarters} of{" "}
          {s.totalQuarters} quarters finished green.
          {" "}Expectancy and everything measured in R stay blank until these
          trades have a stop recorded — without one there's no risk to divide by,
          and a guess would quietly rewrite every figure built on it.
        </p>
      )}

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
        .sum-right { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
        .sum-learn { font-size: 12px; color: var(--brass); text-decoration: underline;
                     text-underline-offset: 2px; }
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
        /* Thin sample: still bold, so the figure is readable and findable,
           but carrying none of the accent that makes the others read as
           settled. Hiding it would be worse — it is their number. */
        .sum-fig.muted { color: var(--ink2); font-weight: 600; }
      `}</style>
    </section>
  );
}
