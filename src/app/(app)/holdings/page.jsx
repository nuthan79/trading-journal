"use client";

import { useState } from "react";
import Holdings from "@/components/journal/Holdings";
import { markOpenPositions, acknowledgeBreakeven } from "@/lib/db";
import { useJournal } from "../JournalContext";

export default function HoldingsPage() {
  const {
    open, closed, mergeMarks, say, reloadTrades,
    openEditTrade, openExitTrade, removeTrade,
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
      open={open}
      closed={closed}
      onRefresh={refresh}
      refreshing={refreshing}
      onAckBreakeven={ackBreakeven}
      onEditTrade={openEditTrade}
      onExitTrade={openExitTrade}
      onDeleteTrade={removeTrade}
    />
  );
}
