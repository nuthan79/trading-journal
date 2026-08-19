"use client";

import Edge from "@/components/journal/Edge";
import { useJournal } from "../../JournalContext";

export default function EdgePage() {
  // `closed` rather than `all`: expectancy is a statement about finished
  // trades. An open position has an unrealised R that moves every time a quote
  // refreshes, and averaging that into a win rate would make the whole screen
  // change on a price tick.
  const { closed, accountSize, profile } = useJournal();
  return (
    <Edge
      closed={closed}
      accountSize={accountSize}
      defaultRiskPct={profile?.default_risk_pct}
    />
  );
}
