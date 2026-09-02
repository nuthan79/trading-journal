"use client";

import { redirect } from "next/navigation";
import ChartDrill from "@/components/journal/ChartDrill";
import { SHOW_CHART_DRILL } from "@/lib/flags";
import { useJournal } from "../../JournalContext";

/**
 * REDIRECTED, NOT BLANKED, WHILE THE FLAG IS OFF.
 *
 * This returned null, which put the Analysis sub-tabs on screen with nothing
 * underneath them — a bookmark or a browser-history entry landing on an empty
 * frame with no explanation and no indication anything had gone wrong. The
 * commit that hid the wall claimed a hidden feature is gated in two places so
 * that "no stale piece of state can route somebody into a screen with no way
 * back", and then this route did exactly that.
 *
 * Sending them to Edge means the route simply does not exist while the flag is
 * off, which is the truth of it.
 */
export default function DrillPage() {
  const { all, diary } = useJournal();
  if (!SHOW_CHART_DRILL) redirect("/analysis/edge");
  return <div className="sec"><ChartDrill trades={all} diary={diary} /></div>;
}
