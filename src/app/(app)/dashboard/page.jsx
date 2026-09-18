"use client";

import Dashboard from "@/components/journal/Dashboard";
import { useJournal } from "../JournalContext";

export default function DashboardPage() {
  const { closed, banking, accountSize, diary, flows,
          trades, ownDiaryCount, needStopsCount, assumedStopsCount,
          profile, userId, openNewTrade } = useJournal();
  return (
    <Dashboard closed={closed} banking={banking} accountSize={accountSize} diary={diary} flows={flows}
               firstWeek={{
                 trades: trades.length, needStops: needStopsCount, assumedStops: assumedStopsCount,
                 diary: ownDiaryCount, onboardedAt: profile?.onboarded_at, userId,
                 onNewTrade: openNewTrade,
               }} />
  );
}
