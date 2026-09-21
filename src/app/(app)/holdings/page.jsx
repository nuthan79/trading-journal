"use client";

import { useEffect, useMemo, useState } from "react";
import Holdings from "@/components/journal/Holdings";
import { markOpenPositions, acknowledgeBreakeven, resolveSoldSnapshots,
         listSplits, applySplitAdjustments } from "@/lib/db";
import { splitPlan, symbolsOf } from "@/lib/splits";
import { measurePaths, needsMeasuring } from "@/lib/measure";
import { useJournal } from "../JournalContext";

export default function HoldingsPage() {
  const {
    open, closed, diary, mergeMarks, say, reloadTrades, saveDiaryEntry, removeChartFromEntry,
    openEditTrade, openExitTrade, removeTrade, profile, all,
  } = useJournal();
  const [refreshing, setRefreshing] = useState(false);

  /**
   * SPLITS AND BONUS ISSUES, asked about once per visit.
   *
   * The whole book, not only what is held: a trade that opened before a split
   * and closed after it has a P&L in two different currencies of share, and
   * that one is already in the record. One request for every symbol, cached
   * upstream for six hours — a corporate action is announced weeks ahead.
   */
  const [splits, setSplits] = useState({});
  useEffect(() => {
    let live = true;
    const keys = symbolsOf(all);
    if (!keys.length) return;
    listSplits(keys).then((got) => { if (live) setSplits(got); });
    return () => { live = false; };
  }, [all]);

  const splitsDuePlan = useMemo(() => splitPlan(all, splits), [all, splits]);

  const fixSplits = async (plan) => {
    try {
      const done = await applySplitAdjustments(plan);
      await reloadTrades();
      say(`${done} position${done === 1 ? "" : "s"} restated for the split.`);
    } catch (e) {
      say(e.message || "Could not adjust those positions.");
      await reloadTrades();
    }
  };

  /* Holdings sold after they were imported — see lib/snapshots.js. The card
     on Holdings builds the plan and asks first; this carries it out. */
  const fixSoldSnapshots = async (plan) => {
    try {
      const done = await resolveSoldSnapshots(plan);
      await reloadTrades();
      say([
        done.removed && `${done.removed} sold holding${done.removed === 1 ? "" : "s"} removed`,
        done.shrunk && `${done.shrunk} trimmed to what is still held`,
        done.diaryMoved && `${done.diaryMoved} diary entr${done.diaryMoved === 1 ? "y" : "ies"} moved to the closed trade`,
      ].filter(Boolean).join(" · ") + ".");
    } catch (e) {
      say(e.message || "Could not fix those holdings.");
      await reloadTrades();
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { marked, error } = await markOpenPositions(open);
      if (marked.length) mergeMarks(marked);
      // Quotes are best-effort — the journal is fully usable without a mark,
      // so a dead source is worth saying once rather than blocking the page.
      say(error ? error : `${marked.length} position${marked.length === 1 ? "" : "s"} marked.`);

      /**
       * The badges ride along with the price refresh rather than getting a
       * button of their own.
       *
       * Refresh is already the action that means "go and look at the market",
       * and reading a week of closes for the handful of symbols on this screen
       * costs one request beside the one just made. Attached here it also
       * cannot surprise anybody: nothing reaches the network on this page
       * without the user asking it to.
       *
       * Deliberately last, and deliberately silent. A mark that arrived is
       * worth more than a badge that did not, so this must never be able to
       * turn a successful refresh into an error message — `measurePaths`
       * already swallows a rate limit into `stopped`, and the badges simply
       * stay as they were until the next press.
       */
      if (needsMeasuring(open, { includeOpen: true }).length) {
        const { measured } = await measurePaths(open, null, { includeOpen: true });
        if (measured > 0) await reloadTrades();
      }
    } finally {
      setRefreshing(false);
    }
  };


  // Recording that the reminder was read, and nothing else. The stop this
  // trade carries is the one the trader typed, and it stays that way.
  const ackBreakeven = async ({ id, symbol }) => {
    try {
      await acknowledgeBreakeven(id);
      await reloadTrades();
      say(`${symbol} reminder cleared — check the stop really is at breakeven with your broker.`);
    } catch (e) {
      say(e.message || `Could not clear the reminder on ${symbol}.`);
      throw e;
    }
  };

  return (
    <Holdings
      onFixSoldSnapshots={fixSoldSnapshots}
      splitPlan={splitsDuePlan}
      onFixSplits={fixSplits}
journalName={profile?.journal_name}
            open={open}
      closed={closed}
      diary={diary}
      onRefresh={refresh}
      onAttachChart={saveDiaryEntry}
      onRemoveChart={removeChartFromEntry}
      refreshing={refreshing}
      onAckBreakeven={ackBreakeven}
      onEditTrade={openEditTrade}
      onExitTrade={openExitTrade}
      onDeleteTrade={removeTrade}
    />
  );
}
