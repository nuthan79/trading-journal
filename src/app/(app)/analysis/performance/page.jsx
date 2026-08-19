"use client";

import Performance from "@/components/journal/Performance";
import { useJournal } from "../../JournalContext";

export default function PerformancePage() {
  // `all` rather than `closed`: the entry-basis view needs to know about
  // positions started in a period that haven't closed yet, or a recent month
  // looks complete when it's only showing whatever finished first.
  const { closed, S, accountSize, flows, all } = useJournal();
  return <Performance closed={closed} S={S} accountSize={accountSize} flows={flows} all={all} />;
}
