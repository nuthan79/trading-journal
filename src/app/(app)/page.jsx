"use client";

import Dashboard from "@/components/journal/Dashboard";
import { useJournal } from "./JournalContext";

export default function DashboardPage() {
  const { closed, accountSize, diary, flows } = useJournal();
  return (
    <Dashboard closed={closed} accountSize={accountSize} diary={diary} flows={flows} />
  );
}
