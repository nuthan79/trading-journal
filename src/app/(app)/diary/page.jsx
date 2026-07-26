"use client";

import Diary from "@/components/journal/Diary";
import { useJournal } from "../JournalContext";

export default function DiaryPage() {
  const { diary, all, saveDiaryEntry, removeDiaryEntry, say } = useJournal();
  return <Diary diary={diary} trades={all} onSave={saveDiaryEntry} onDelete={removeDiaryEntry} say={say} />;
}
