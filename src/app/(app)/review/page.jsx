"use client";

import Review from "@/components/journal/Review";
import { useJournal } from "../JournalContext";

export default function ReviewPage() {
  const { closed, all, S } = useJournal();
  return <Review closed={closed} all={all} stats={S} />;
}
