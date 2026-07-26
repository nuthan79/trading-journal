"use client";

import Dashboard from "@/components/journal/Dashboard";
import { useJournal } from "./JournalContext";

export default function DashboardPage() {
  const { S, closed, open, accountSize, diary, flows, mergeMarks } = useJournal();
  return (
    <Dashboard S={S} closed={closed} open={open} accountSize={accountSize} diary={diary}
               flows={flows} onMarked={mergeMarks} />
  );
}
