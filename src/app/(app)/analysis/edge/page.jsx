"use client";

import Edge from "@/components/journal/Edge";
import { useJournal } from "../../JournalContext";

export default function EdgePage() {
  // `closed` only. Every table here reports what a group of trades earned, and
  // an open position has not earned anything yet — folding an unrealised R into
  // "what this setup pays" would make the answer move on a quote refresh.
  const { closed, accountSize } = useJournal();
  return <Edge closed={closed} accountSize={accountSize} />;
}
