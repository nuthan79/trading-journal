"use client";

import { useState } from "react";
import Holdings from "@/components/journal/Holdings";
import { markOpenPositions, moveStopToEntry } from "@/lib/db";
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

  // Recording what the trader has already done at their broker, never a stop
  // this app moves on its own. Only ever reached by an explicit click on a
  // named position. The initial stop goes along with the write so the trade's
  // 1R — and every R figure already recorded against it — survives the move.
  const markRiskFree = async ({ id, symbol, entry, initialStop, releasesR }) => {
    try {
      await moveStopToEntry({ id, entry, initialStop });
      await reloadTrades();
      say(`${symbol} recorded at breakeven — ${releasesR.toFixed(2)}R off the dial. `
        + `Check the stop really is at ${entry.toFixed(2)} with your broker.`);
    } catch (e) {
      say(e.message || `Could not record ${symbol} at breakeven.`);
      throw e;
    }
  };

  return (
    <Holdings
      open={open}
      closed={closed}
      onRefresh={refresh}
      refreshing={refreshing}
      onMarkRiskFree={markRiskFree}
      onEditTrade={openEditTrade}
      onExitTrade={openExitTrade}
      onDeleteTrade={removeTrade}
    />
  );
}
