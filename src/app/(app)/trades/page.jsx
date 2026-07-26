"use client";

import Trades from "@/components/journal/Trades";
import { useJournal } from "../JournalContext";

export default function TradesPage() {
  const { all, openEditTrade, removeTrade, openNewTrade } = useJournal();
  return <Trades all={all} onEdit={openEditTrade} onDelete={removeTrade} onNew={openNewTrade} />;
}
