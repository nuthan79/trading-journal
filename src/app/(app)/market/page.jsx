"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Market from "@/components/journal/Market";
import { SHOW_MARKET_BREADTH } from "@/lib/flags";

/* Market breadth — about the market, not the journal, so it reads nothing
   from useJournal(). See components/journal/Market.jsx. Hidden behind
   SHOW_MARKET_BREADTH; a bookmark to it lands on the dashboard meanwhile. */
export default function MarketPage() {
  const router = useRouter();
  useEffect(() => { if (!SHOW_MARKET_BREADTH) router.replace("/dashboard"); }, [router]);
  return SHOW_MARKET_BREADTH ? <Market /> : null;
}
