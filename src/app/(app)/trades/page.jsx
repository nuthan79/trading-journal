"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Trades from "@/components/journal/Trades";
import { useJournal } from "../JournalContext";

/**
 * The mistake filter arrives in the URL rather than in component state.
 *
 * "What the mistakes cost" on Performance says a tag cost you a certain
 * amount and, until now, gave you no way to reach the trades behind it. It
 * links here instead of holding a shared filter somewhere, which means the
 * back button returns you to the table you clicked from and the narrowed
 * list can be bookmarked — worth having for the one review someone comes
 * back to.
 */
function TradesInner() {
  const router = useRouter();
  const params = useSearchParams();
  const mistake = params.get("mistake") || "";
  const missing = params.get("missing") || "";

  const { all, diary, saveDiaryEntry, removeChartFromEntry,
          openEditTrade, openExitTrade, removeTrade, openNewTrade } = useJournal();

  return (
    <Trades
      all={all}
      diary={diary}
      mistake={mistake}
      missing={missing}
      onClearFilter={() => router.push("/trades")}
      onAttachChart={saveDiaryEntry}
      onRemoveChart={removeChartFromEntry}
      onEdit={openEditTrade}
      onExit={openExitTrade}
      onDelete={removeTrade}
      onNew={openNewTrade}
    />
  );
}

export default function TradesPage() {
  // useSearchParams needs a Suspense boundary or the whole route opts out of
  // static rendering at build time.
  return (
    <Suspense fallback={null}>
      <TradesInner />
    </Suspense>
  );
}
