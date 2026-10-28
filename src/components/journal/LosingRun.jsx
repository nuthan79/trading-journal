"use client";

import { useMemo } from "react";
import { losingRun, LOSING_RUN_ALERT } from "@/lib/bottleneck";
import { dmy } from "@/lib/format";

/**
 * The run of losing entries the book is on right now.
 *
 * THE CARD LIVES ON PROCESS, where the rest of "how has the recent trading
 * gone" lives. It left Holdings on 25 Sep 2026: seven is one trader's number,
 * and Holdings states facts about what is held. Holdings carries only
 * LosingRunLine below — one line pointing here, read where the next trade is
 * decided. Both come from this file, so the threshold, the count and the
 * hover cannot drift apart.
 *
 * WHY SEVEN. Measured on a 1,176-trade book winning about half its trades at
 * +1.1R average: a run reaching seven happened 13 times, and the ten trades
 * that followed averaged −19.6R against a usual +11.2R. Shuffling the same
 * trades 2,000 times produced something that bad 0.4% of the time, so it is
 * not the arithmetic of streaks — losses cluster because regimes do. Four
 * fires more often and says less (−9.5R); past seven the sample thins.
 *
 * TWO FACTS AND AN INSTRUCTION, and nothing else on the face of it. The first
 * version explained how the run was counted, conceded that runs happen, and
 * only then said what to do — three sentences deep, which is two more than a
 * warning gets read at. Method and caveat live in the hover.
 *
 * THE CAVEAT IS NOT DECORATIVE, which is why it survives at all. A long run
 * has two readings: "the market has turned" is useful, and "my system is
 * broken" destroys an edge that was only having a bad month. The hover has to
 * steer to the first.
 */
const METHOD = "Counted by the day you took each trade. A day where anything won "
  + "ends the run, so this is the shortest count the dates allow. A run this "
  + "long turns up in any book eventually — it says the market has turned, "
  + "not that your setup stopped working.";

export default function LosingRun({ closed = [] }) {
  const run = useMemo(() => losingRun(closed), [closed]);
  if (run.n < LOSING_RUN_ALERT) return null;

  return (
    <div className="lr" id="losing-run">
      <b title={METHOD}>
        {run.n} losing entries in a row
      </b>
      <p>
        The market isn&apos;t taking your setups. Cut risk per trade, or stand aside
        until one works.
      </p>
      {run.lastWin && (
        <p className="lr-last">
          Last winner <b>{run.lastWin.symbol}</b> · {dmy(run.lastWin.date)}
        </p>
      )}

      <style jsx>{`
        /* The other cards beside this one offer a fix. This is a condition to
           read, so it takes its own colour and no button. */
        .lr {
          border: 1px solid var(--short); border-left-width: 3px;
          background: var(--card); border-radius: 3px;
          padding: 14px 16px; margin-bottom: 14px;
        }
        /* Holdings links here; land below the sticky topbar, not under it. */
        .lr { scroll-margin-top: calc(var(--topbar-h) + 12px); }
        .lr > b { cursor: help; }
        .lr p { margin: 4px 0 0; font-size: 13px; color: var(--ink); }
        .lr-last { color: var(--ink3); font-size: 12px; }
      `}</style>
    </div>
  );
}

/**
 * HOLDINGS' VERSION: ONE LINE AND A WAY TO THE CARD.
 *
 * Holdings is where the next trade gets decided, so a long run should be in
 * sight there — but as a pointer, not the verdict restated. The count, the last
 * winner and the instruction fit on one line; the reasoning and the last ten
 * trades behind it stay on Process. Gone the moment the run ends, like the card.
 *
 * On trial since 29 Oct 2026: the card itself was on Holdings once and taken
 * off the same day, and this may go the same way.
 */
export function LosingRunLine({ closed = [] }) {
  const run = useMemo(() => losingRun(closed), [closed]);
  if (run.n < LOSING_RUN_ALERT) return null;

  return (
    <div className="lrl">
      <b title={METHOD}>{run.n} losing entries in a row</b>
      {run.lastWin && (
        <> — last winner <b>{run.lastWin.symbol}</b>, {dmy(run.lastWin.date)}</>
      )}. Cut risk or stand aside.{" "}
      <a href="/analysis/review#losing-run" className="lrl-go">See Process →</a>

      <style jsx>{`
        .lrl {
          border-left: 3px solid var(--short); background: var(--card);
          border-radius: 0 3px 3px 0; padding: 9px 14px; margin-bottom: 14px;
          font-size: 13px; color: var(--ink);
        }
        .lrl > b:first-child { color: var(--short); cursor: help; }
        .lrl-go { color: var(--brass); text-decoration: none;
                  border-bottom: 1px dotted currentColor; white-space: nowrap; }
        .lrl-go:hover { color: var(--ink); }
      `}</style>
    </div>
  );
}
