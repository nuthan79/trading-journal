"use client";

import Mindset from "@/components/journal/Mindset";
import { useJournal } from "../JournalContext";

export default function MindsetPage() {
  // `closed` only: a feeling recorded on an open position has no outcome to be
  // set against yet, and averaging an unrealised R into it would make the whole
  // page move on a quote refresh.
  const { closed } = useJournal();
  return <Mindset closed={closed} />;
}
