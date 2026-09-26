"use client";

import Report from "@/components/journal/Report";
import { useJournal } from "../../JournalContext";

export default function ReportPage() {
  /* Closed only, like What works: a report reads what the record DID, and an
     open position has not done anything yet. */
  const { closed, accountSize } = useJournal();
  return <Report closed={closed} accountSize={accountSize} />;
}
