"use client";

import { useState } from "react";
import Holdings from "@/components/journal/Holdings";
import { markOpenPositions, acknowledgeBreakeven } from "@/lib/db";
import { measurePaths, needsMeasuring } from "@/lib/measure";
import { useJournal } from "../JournalContext";

export default function HoldingsPage() {
  const {
    open, closed, diary, mergeMarks, say, reloadTrades, saveDiaryEntry, removeChartFromEntry,
    openEditTrade, openExitTrade, removeTrade, profile,
  } = useJournal();
  const [refreshing, setRefreshing] = useState(false);

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
