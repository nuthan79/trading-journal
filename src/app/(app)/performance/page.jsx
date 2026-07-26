"use client";

import Performance from "@/components/journal/Performance";
import { useJournal } from "../JournalContext";

export default function PerformancePage() {
  const { closed, S, accountSize, flows } = useJournal();
  return <Performance closed={closed} S={S} accountSize={accountSize} flows={flows} />;
}
