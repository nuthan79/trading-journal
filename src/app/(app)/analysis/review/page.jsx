"use client";

import Review from "@/components/journal/Review";
import { useJournal } from "../../JournalContext";

export default function ReviewPage() {
  const { closed, all, diary, S } = useJournal();
  return <Review closed={closed} all={all} diary={diary} stats={S} />;
}
