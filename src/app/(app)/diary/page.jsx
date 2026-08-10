"use client";

import Diary from "@/components/journal/Diary";
import { useJournal } from "../JournalContext";

export default function DiaryPage() {
  const { diary, all, saveDiaryEntry, removeDiaryEntry, removeChartFromEntry, say } = useJournal();
  return (
    <Diary
      diary={diary}
      trades={all}
      onSave={saveDiaryEntry}
      onDelete={removeDiaryEntry}
      // Removing the CHART is not removing the entry — an entry carrying a
      // note keeps it and loses only the image. onDelete above is the other
      // thing, and the diary offers both because both are real intentions.
      onRemoveChart={removeChartFromEntry}
      say={say}
    />
  );
}
