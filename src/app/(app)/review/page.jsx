"use client";

import Review from "@/components/journal/Review";
import { useJournal } from "../JournalContext";

export default function ReviewPage() {
  const { closed, S } = useJournal();
  return <Review closed={closed} stats={S} />;
}
