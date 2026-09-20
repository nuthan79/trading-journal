"use client";

import Dashboard from "@/components/journal/Dashboard";
import { useJournal } from "../JournalContext";

export default function DashboardPage() {
  const { closed, banking, accountSize, diary, flows,
          trades, ownDiaryCount, needStopsCount, assumedStopsCount,
          profile, userId, openNewTrade, demoOn, showDemo } = useJournal();
  return (
    <Dashboard closed={closed} banking={banking} accountSize={accountSize} diary={diary} flows={flows}
               firstWeek={{
                 trades: trades.length, needStops: needStopsCount, assumedStops: assumedStopsCount,
                 diary: ownDiaryCount, onboardedAt: profile?.onboarded_at, userId,
                 onNewTrade: openNewTrade,
                 /* Only when there is no sample on screen already — offering
                    to show what is plainly showing reads as a broken button. */
                 onShowDemo: demoOn ? null : showDemo,
               }} />
  );
}
