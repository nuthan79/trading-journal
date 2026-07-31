"use client";

import { useState } from "react";
import Holdings from "@/components/journal/Holdings";
import { markOpenPositions } from "@/lib/db";
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


  return (
    <Holdings
      open={open}
      closed={closed}
      onRefresh={refresh}
      refreshing={refreshing}
      onEditTrade={openEditTrade}
      onExitTrade={openExitTrade}
      onDeleteTrade={removeTrade}
    />
  );
}
