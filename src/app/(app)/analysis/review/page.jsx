"use client";

import Review from "@/components/journal/Review";
import { useJournal } from "../../JournalContext";

export default function ReviewPage() {
  const { closed, all, diary, S, reloadTrades } = useJournal();
  return (
    <Review
      closed={closed}
      all={all}
      diary={diary}
      stats={S}
      /* Reading the price path writes to the trades, and the findings below
         are computed from them — so the screen has to see the new columns
         without a cold reload losing where the reader was. */
      onMeasured={reloadTrades}
    />
  );
}
