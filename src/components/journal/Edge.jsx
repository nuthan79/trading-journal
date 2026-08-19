"use client";

import { useMemo } from "react";
import Link from "next/link";
import ExpectancyCalculator from "@/components/ExpectancyCalculator";
import { edgePrefill, MIN_SAMPLE, THIN_SAMPLE } from "@/lib/edgePrefill";
import { pct } from "@/lib/format";

/**
 * The expectancy calculator, filled in from trades that actually happened.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE PUBLIC PAGE. Nothing structural — it is
 * the same component with a `prefill` prop, deliberately, so the two cannot
 * drift apart on what "average win" means. What changes is the standing of the
 * numbers: on /expectancy-calculator every figure is remembered, and memory is
 * generous about win rates and worst of all about average loss, because the
 * trades where a stop got moved are exactly the ones that do not come to mind.
 * Here they are measured, and the whole value of the screen is that the
 * expectancy is not flattering.
 *
 * SO THE HONESTY WORK IS ALL IN THE FRAMING. Three things can quietly make
 * these numbers a lie, and each gets said out loud rather than papered over:
 * a sample too small to mean anything, trades excluded for carrying an
 * importer's invented stop, and a journal that has not lost yet.
 */
export default function Edge({ closed = [], accountSize, defaultRiskPct }) {
  const p = useMemo(
    () => edgePrefill(closed, { accountSize, defaultRiskPct }),
    [closed, accountSize, defaultRiskPct]
  );

  if (!p.ready) {
    return (
      <div className="sec card empty">
        <div className="eyebrow">Your edge</div>
        <p>
          This screen measures your expectancy — what an average trade is worth in R —
          and works out what it compounds to. It needs at least {MIN_SAMPLE} closed
          trades with a stop you set yourself; you have {p.sampleSize}.
        </p>
        {p.assumedCount > 0 ? (
          <p>
            {p.assumedCount} closed {p.assumedCount === 1 ? "trade is" : "trades are"}{" "}
            sitting out because the stop was assumed at import rather than recorded.
            Correcting {p.assumedCount === 1 ? "it" : "them"} in the{" "}
            <Link href="/stops">stops queue</Link> brings{" "}
            {p.assumedCount === 1 ? "it" : "them"} in.
          </p>
        ) : null}
        <p>
          In the meantime the{" "}
          <Link href="/expectancy-calculator">public calculator</Link> takes the same
          numbers typed by hand.
        </p>
      </div>
    );
  }

  const { values, sampleSize, assumedCount, noRCount, months, thin, noLosses } = p;

  return (
    <>
      <div className="sec">
        <div className="sechead">
          <div className="eyebrow">Your edge</div>
          <span className="edge-src">
            measured from {sampleSize} closed {sampleSize === 1 ? "trade" : "trades"} over{" "}
            {months < 1.5 ? "under a month" : `${Math.round(months)} months`}
          </span>
        </div>

        {/* Every reason these figures might mislead, before the figures. A
            caveat printed underneath a confident number is read after the
            number has already been believed. */}
        {thin ? (
          <p className="edge-note">
            <b>Small sample.</b> {sampleSize} trades is enough to compute an expectancy
            and not enough to trust its precision — one outsized winner still moves it
            noticeably. Somewhere past {THIN_SAMPLE} it starts settling down. Read the
            sign and the rough size, not the second decimal.
          </p>
        ) : null}

        {assumedCount > 0 ? (
          <p className="edge-note">
            <b>{assumedCount} {assumedCount === 1 ? "trade is" : "trades are"} excluded.</b>{" "}
            The stop was assumed at import rather than recorded, so the R would be
            arithmetic against a number nobody chose. Correct{" "}
            {assumedCount === 1 ? "it" : "them"} in the{" "}
            <Link href="/stops">stops queue</Link> and{" "}
            {assumedCount === 1 ? "it joins" : "they join"} everything below.
          </p>
        ) : null}

        {noRCount > 0 ? (
          <p className="edge-note">
            <b>{noRCount} more {noRCount === 1 ? "trade has" : "trades have"} no
            computable R</b> — usually a missing stop or exit price. {noRCount === 1
              ? "It is" : "They are"} counted in your P&amp;L but cannot be part of an
            R measurement.
          </p>
        ) : null}

        {noLosses ? (
          <p className="edge-note">
            <b>No losing trades yet.</b> Average loss is set to 1R below as a
            placeholder, because the real figure does not exist — with no losses the
            break-even win rate would compute as zero and the profit factor as
            infinite. Every number that depends on it is provisional until you take
            one.
          </p>
        ) : null}
      </div>

      {/*
        Remounted when the measured inputs change.

        The calculator seeds its own editable state from `prefill` once, which
        is correct — it must not yank a slider out from under someone
        mid-thought. But it also means that if the underlying trades change
        (a stop corrected, a position closed) a mounted instance would keep
        showing the old numbers forever. Keying on the values themselves makes
        it start again from the new measurement.
      */}
      <div className="sec">
        <ExpectancyCalculator
          key={JSON.stringify(values)}
          prefill={values}
          sampleSize={sampleSize}
        />
      </div>

      <p className="edge-foot">
        Win rate, average win and average loss come from the same calculation as the
        Performance sheet. Risk per trade is the median of what your positions
        actually carried — {pct(values.riskPct, 1)} — rather than the default in your
        settings, because the projection is about what you did, not what you meant to.
      </p>
    </>
  );
}
