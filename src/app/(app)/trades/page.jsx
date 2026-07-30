"use client";

import Trades from "@/components/journal/Trades";
import { useJournal } from "../JournalContext";

export default function TradesPage() {
  const { all, openEditTrade, openExitTrade, removeTrade, openNewTrade } = useJournal();
  return (
    <Trades all={all} onEdit={openEditTrade} onExit={openExitTrade}
            onDelete={removeTrade} onNew={openNewTrade} />
  );
}
