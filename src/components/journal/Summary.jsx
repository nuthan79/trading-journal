"use client";

import { useMemo } from "react";
import { summaryParts } from "@/lib/dashboard";
import { headline } from "@/lib/calc";
import { rfmt, pct, money, days } from "@/lib/format";
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

function RailTile({ label, value, tone, hint }) {
  return (
    <div className="sum-rail-tile" title={hint || undefined}>
      <div className={`sum-rail-v mono ${tone || ""}`}>{value}</div>
      <div className="sum-rail-l">{label}</div>
    </div>
  );
}

export default function Summary({ closed, banking = [], openingCapital, flows = [] }) {
  const s = useMemo(
    () => summaryParts(closed, { openingCapital, flows, banking }),
    [closed, banking, openingCapital, flows]
  );
  /*
    COMPUTED TWICE, ON PURPOSE. summaryParts() above writes the prose;
    headline() is the single definition of the six figures in the rail, the
    same call over the same inputs HeadlineNumbers makes. Working them out a
    second time here from `s` would be cheaper and is the thing that drifts —
    one rail saying a payoff of 2.10 above a sheet saying 2.08.
  */
  const h = useMemo(
    () => headline(closed, { openingCapital, flows, banking }),
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

  /*
    The rail says what KIND of trading produced the record; the paragraph says
    what it came to. Nothing in it may repeat a figure the paragraph already
    names — trades, months, expectancy, win rate, total R, net P&L, drawdown,
    losing run, green months and quarters — or it is the duplication the
    folded sheet below was introduced to remove. Best and worst trade stay out
    too: the equity chart's footer prints them.

    Two gates, both rules this file already keeps rather than new bars:
    without an R four of the six are dashes, and on a thin sample the
    paragraph is busy saying its own expectancy is not yet a reading — six
    confident figures beside that sentence would undo it.
  */
  const showRail = s.hasR && s.rConfidence !== "thin";

  return (
    <section className={`sum-card${showRail ? " has-rail" : ""}`}>
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

      {showRail && (
        <aside className="sum-rail" aria-label="The shape of it">
          <div className="eyebrow sum-rail-h">The shape of it</div>
          <div className="sum-rail-grid">
            {/*
              Risk per trade leads. Every R in the paragraph beside it is
              unreadable without it — "+1.02R per trade" says nothing until you
              know what an R is worth. Its hover is HeadlineNumbers' word for
              word, and it is the one tile here whose hover changes what the
              number means: when sizing has grown with the account, 1R is not
              one amount of money.
            */}
            <RailTile
              label="Risk per trade"
              value={<>
                <Money v={h.avgRisk} />
                {isFinite(h.avgRiskPct) && (
                  <span className="sum-rail-sub"> · {pct(h.avgRiskPct, 2)}</span>
                )}
              </>}
              hint={h.riskVaries
                ? `Most trades risked between ${money(h.riskLo)} and ${money(h.riskHi)}. ` +
                  `1R has grown with the account, so a +2R early on and a +2R lately ` +
                  `are different amounts of money — total R adds them as though they ` +
                  `were the same.`
                : "The average money put at risk on a trade. Your sizing is consistent, " +
                  "so 1R means much the same throughout your record."} />
            <RailTile label="Profit factor"
              value={isFinite(h.profitFactor) ? h.profitFactor.toFixed(2) : "∞"} />
            <RailTile label="Payoff ratio"
              value={isFinite(h.payoff) ? h.payoff.toFixed(2) : "∞"}
              hint="Average win divided by average loss" />
            <RailTile label="Avg hold" value={days(h.avgHold)} />
            <RailTile label="Avg gain" value={pct(h.avgGainPct)} tone="pos"
              hint="On the winners, as a percentage of position size" />
            <RailTile label="Avg loss" value={pct(h.avgLossPct)} tone="neg"
              hint="On the losers, as a percentage of position size" />
          </div>
        </aside>
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

        /* Below the breakpoint the rail stacks under the paragraph, ruled
           off above rather than beside, three across. It must not vanish on
           a laptop — the figures are no less true at 1200px. */
        .sum-rail {
          border-top: 1px solid var(--rule);
          margin-top: 14px; padding-top: 12px;
        }

        /*
          A min-width query, which this codebase almost never writes: every
          other query on the Dashboard is max-width, which is why the app
          knows how to get smaller and did nothing with a large screen. (The
          only others are Review's thesis grid, at 900px.) 1280 is the width
          at which the card holds the paragraph's full measure AND a readable
          rail: ~930px of measure + 24px gap + 300px of rail + .jwrap's 40px.

          WHICH RULE GOVERNS THE MEASURE. .sum-body's max-width: 92ch, in both
          ranges. The first track is max-content and takes its width from
          that cap, rather than repeating 92ch here — a ch in this template
          resolves in the CARD's font, not the paragraph's 17px, and would cap
          the line about a fifth shorter than the rule above it says.
        */
        @media (min-width: 1280px) {
          .sum-card.has-rail {
            display: grid;
            /* 300, not 260: two columns of a 260px rail give 108px tiles, and
               "₹19.1k · 0.22%" needs 119 — so the one tile here with two parts
               was ellipsised from 1280 to ~1370, which is laptop width. */
            grid-template-columns: minmax(0, max-content) minmax(300px, 1fr);
            column-gap: 24px;
            align-items: start;
          }
          .sum-card.has-rail .sum-head { grid-column: 1 / -1; }
          .sum-rail {
            border-top: 0; margin-top: 0; padding-top: 0;
            border-left: 1px solid var(--rule); padding-left: 24px;
          }
        }
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

        /* The rail's tiles render through RailTile, so their styles must be
           global (see CLAUDE.md), under a prefix of their own. Typography is
           .hn-cell's — mono value, small uppercase label — so the rail and the
           sheet below read as one system; the sizing is not, since .hn-cell
           is built for five to seven across and this is two or three. */
        .sum-rail-h { display: block; margin-bottom: 10px; color: var(--ink3); }
        .sum-rail-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px 20px;
        }
        @media (min-width: 1280px) {
          .sum-rail-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        .sum-rail-tile { min-width: 0; }
        .sum-rail-v {
          font-size: 18px; font-weight: 500; line-height: 1.15;
          letter-spacing: -0.015em; color: var(--ink);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .sum-rail-v.pos { color: var(--long); }
        .sum-rail-v.neg { color: var(--short); }
        .sum-rail-sub { font-size: 0.68em; color: var(--ink3); }
        .sum-rail-l {
          font-family: 'Archivo', sans-serif; font-size: 9px; font-weight: 600;
          letter-spacing: 0.11em; text-transform: uppercase; color: var(--ink3);
          margin-top: 5px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
      `}</style>
    </section>
  );
}
