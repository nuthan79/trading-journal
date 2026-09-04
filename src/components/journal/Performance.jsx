"use client";

import Link from "next/link";
import { rfmt, pct, describeAnnualised } from "@/lib/format";
import Tile from "./Tile";
import PeriodPerformance from "./PeriodPerformance";
import CapitalDeployment from "./CapitalDeployment";
import { annualisedReturn, returnQuality, equityCurve, realisedR, underwater } from "@/lib/calc";

/**
 * The statement: how much, over what period, on what capital.
 *
 * The three breakdown tables that used to live below — where the edge is, what
 * the mistakes cost, what didn't work — moved to Analysis → Edge. They are one
 * idea (group the trades by something and see what each group earned) and this
 * is another (totals and periods, consulted the way a statement is). Keeping
 * both here made this the longest screen in the app and buried the argument
 * inside the reference table.
 */
export default function Performance({ closed, banking = [], S, accountSize, flows, all = [] }) {
  if (!closed.length) {
    return (
      <div className="sec card empty">
        <div className="eyebrow">Performance sheet</div>
        {/* No longer promises to say which setups pay — that is Analysis → Edge
            now, and an empty state advertising a table this screen no longer
            has is how somebody ends up looking for it here forever. */}
        <p>This page totals your closed trades by period and shows what capital was
          working. It needs closed trades to read. Log a few and come back.</p>
      </div>
    );
  }

  /**
   * FIRST, AND DELIBERATELY.
   *
   * The four tiles beside it are all in R, and the people who ask for this
   * number by name are exactly the ones who do not read R — so a statement
   * that opens with "Total R" and keeps the annual return in a table footer
   * is answering everyone except them.
   *
   * Every position, open ones included: this asks what the account is worth,
   * not what the finished trading produced. Same call and same words as the
   * Dashboard, so the two screens cannot disagree about one book.
   */
  const annual = annualisedReturn(all.length ? all : closed,
    { openingCapital: accountSize, flows });
  const ann = describeAnnualised(annual);

  /**
   * WHAT THE RATE COST, AND WHAT IT WAS EARNED ON.
   *
   * A rate alone says where the account ended up. These two say whether it
   * was bought with a big hole, and whether the denominator under it is the
   * money that was actually at work — which for anyone running above their
   * nominal capital it is not.
   *
   * `banking` for the curve, matching every other money figure on the screen;
   * `all` for deployment, since an open position is committing capital right
   * now.
   */
  const money = banking.length ? banking : closed;
  const eq = equityCurve(money, { openingCapital: accountSize, flows });
  /**
   * Cumulative R over every sell, so the tile and the All row below it agree.
   *
   * They did not: the tile read finished positions (+354.3R over 81) while
   * the table read every sell (+357.3R over 85), under the same two words on
   * one screen. Total R is cumulative realised R — the same family as net
   * P&L — and the drawdown is the worst fall along that same running total.
   * Average win and average loss stay on finished positions beside them,
   * because those ask what a trade turns out like and a part-sold one has no
   * answer yet.
   */
  const R = realisedR(money);
  /* Duration, to sit under the depth. Same curve, so the two describe one
     drawdown rather than two. */
  const uw = underwater(money, { openingCapital: accountSize, flows });
  /* Deployment is not needed here any more: the tile that used it moved to
     the Capital Deployment card, which owns that denominator. */
  const q = returnQuality({ rate: annual.rate, maxDDPct: eq.maxDDPct });

  return (
    <>
      <div className="sec grid6">
        <Tile label={ann.label} value={ann.value} tone={ann.tone} sub={ann.short}
              hint={ann.hint} />
        {/* Between the two figures it divides — the rate above it and the
            drawdown at the end of the row. "Return on capital employed" used
            to sit beside this one and has moved to Capital Deployment, where
            the average committed figure it divides by is two tiles away and
            the arithmetic can be checked by eye. */}
        <Tile label="Return per drawdown"
              value={isFinite(q.perDrawdown) ? q.perDrawdown.toFixed(2) : "—"}
              tone={q.perDrawdown >= 0.5 ? "pos" : q.perDrawdown < 0 ? "neg" : ""}
              sub={isFinite(q.perDrawdown)
                ? `per 1% given back, worst ${pct(q.maxDDPct, 1)}`
                : "needs a drawdown to measure against"}
              hint={"How much annual return each 1% of drawdown bought. Around 0.5 is "
                + "respectable over a full cycle. The drawdown is measured on closed-trade "
                + "equity, so a position that fell and recovered before you sold it does "
                + "not appear in it — the real ride was rougher than this."} />
        <Tile label="Total R" value={rfmt(R.totalR, 1)} tone={R.totalR >= 0 ? "pos" : "neg"}
              sub={R.n === S.n ? `${R.n} trades` : `${R.n} trades · ${R.n - S.n} still part-sold`}
              hint={R.n === S.n ? undefined
                : `${S.n} finished and ${R.n - S.n} sold down but still running. Every sell `
                  + "counts here, which is why this matches the All row below. Average win "
                  + "and average loss beside it count finished positions only — a position "
                  + "you are still holding has no verdict yet."} />
        <Tile label="Average win" value={rfmt(S.avgWin)} tone="pos"
              sub={`best ${rfmt(S.best)}`} />
        <Tile label="Average loss" value={rfmt(-S.avgLoss)} tone="neg"
              sub={`worst ${rfmt(S.worst)}`} />
        {/*
          DEPTH AND DURATION IN ONE TILE.

          The fall is along the SAME running total as Total R, or the two
          would describe different curves. The subtitle is now how LONG the
          account spent below its high-water mark, which is the half of a
          drawdown people actually live through — a 7R fall is a number,
          four months below your best is what makes somebody stop.

          The current stretch wins the subtitle when there is one, because
          the drawdown a trader needs to see is the one they are in. The
          longest survived moves to the hover beside it, which is what gives
          the current one a scale.

          "Longest losing run" was here and is not the same thing at all: it
          counts consecutive losing days, and an account can sit under water
          for months while winning more days than it loses. It keeps its place
          in the hover rather than being dropped.
        */}
        <Tile label="Max drawdown" value={`${R.maxDD.toFixed(1)}R`}
              sub={uw.current
                ? `${uw.current.days}d under water now`
                : uw.longest
                ? `worst spell ${uw.longest.days}d under water`
                : `longest losing run ${S.worstL} day${S.worstL === 1 ? "" : "s"}`}
              hint={[
                uw.current
                  ? `Below your high-water mark for ${uw.current.days} days, ${pct(uw.current.depthPct, 1)} down from it.`
                  : uw.longest ? "Back at your high-water mark." : null,
                uw.longest && uw.current && uw.longest !== uw.current
                  ? `The longest spell you have come back from was ${uw.longest.days} days.`
                  : uw.longest && !uw.current
                  ? `Measured on ${uw.episodes.length} spell${uw.episodes.length === 1 ? "" : "s"} below a previous high.`
                  : null,
                isFinite(uw.typicalRecovery)
                  ? `Typical recovery: ${uw.typicalRecovery} days.` : null,
                `Longest run of consecutive losing days: ${S.worstL}.`,
                "Measured on closed-trade equity, so a position that fell and recovered "
                  + "before you sold it never put the curve under water — the real spell "
                  + "was longer than this.",
              ].filter(Boolean).join(" ")} />
      </div>

      <div className="sec">
        {/* `banking`, not `closed`: a period reports the money that arrived in
            it, and a sell out of a position still running arrived. */}
        <PeriodPerformance closed={banking.length ? banking : closed}
                           openingCapital={accountSize} flows={flows} all={all} />
      </div>

      {/* Sits directly under the period table on purpose: deployment only means
          something next to the returns it produced. `all`, not `closed` —
          an open position is committing capital right now. */}
      <div className="sec">
        <CapitalDeployment all={all} accountSize={accountSize} flows={flows} />
      </div>

      {/* The three breakdown tables that used to sit here — where the edge is,
          what the mistakes cost, what didn't work — moved to Analysis → Edge.
          They are one idea (group the trades and see what each group earned)
          and this screen is another (how much, over what period, on what
          capital). A pointer, because somebody arriving here for "which setups
          pay" should not have to guess that it moved. */}
      <p className="perf-more">
        Which setups actually pay, what the mistakes cost, and what simply didn&rsquo;t
        work now live in <Link href="/analysis/edge">Analysis → Edge</Link>.
      </p>

      {/* Global because the anchor is rendered by next/link, not by this
          component — a scoped block styles the paragraph and leaves the link
          inside it browser-blue. Prefixed so it cannot leak. */}
      <style jsx global>{`
        .perf-more {
          font-size: 12.5px; line-height: 1.7; color: var(--ink3);
          margin: 26px 0 0; max-width: var(--note-w);
        }
        .perf-more a {
          color: var(--ink2); text-decoration: none;
          border-bottom: 1px dotted var(--ink3);
        }
        .perf-more a:hover { color: var(--brass); border-bottom-color: var(--brass); }
      `}</style>
    </>
  );
}
