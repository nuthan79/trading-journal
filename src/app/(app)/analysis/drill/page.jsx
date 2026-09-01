"use client";

import ChartDrill from "@/components/journal/ChartDrill";
import { SHOW_CHART_DRILL } from "@/lib/flags";
import { useJournal } from "../../JournalContext";

export default function DrillPage() {
  const { all, diary } = useJournal();
  if (!SHOW_CHART_DRILL) return null;
  return <div className="sec"><ChartDrill trades={all} diary={diary} /></div>;
}
