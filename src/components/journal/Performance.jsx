"use client";

import Link from "next/link";
import { rfmt, describeAnnualised } from "@/lib/format";
import Tile from "./Tile";
import PeriodPerformance from "./PeriodPerformance";
import CapitalDeployment from "./CapitalDeployment";
import { annualisedReturn } from "@/lib/calc";

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
  const ann = describeAnnualised(
    annualisedReturn(all.length ? all : closed, { openingCapital: accountSize, flows })
  );

  return (
    <>
      <div className="sec grid5">
        <Tile label={ann.label} value={ann.value} tone={ann.tone} sub={ann.short}
              hint={ann.hint} />
        <Tile label="Total R" value={rfmt(S.totalR, 1)} tone={S.totalR >= 0 ? "pos" : "neg"}
              sub={`${S.n} trades`} />
        <Tile label="Average win" value={rfmt(S.avgWin)} tone="pos"
              sub={`best ${rfmt(S.best)}`} />
        <Tile label="Average loss" value={rfmt(-S.avgLoss)} tone="neg"
              sub={`worst ${rfmt(S.worst)}`} />
        <Tile label="Max drawdown" value={`${S.maxDD.toFixed(1)}R`}
              sub={`longest losing run ${S.worstL} day${S.worstL === 1 ? "" : "s"}`} />
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
