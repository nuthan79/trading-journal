"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Trades from "@/components/journal/Trades";
import { saveStops, acknowledgeDuplicate } from "@/lib/db";
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

  /*
    A bucket from "Where the edge is". `dim` names the dimension; a categorical
    row sends `key`, a banded row sends the numeric `lo`/`hi` it was cut at
    plus the `band` label purely so this screen can name what it is showing.

    The numbers travel rather than the band label because six of the ten
    dimensions are cut into ADAPTIVE quantile bands — reproducing them here
    would mean recomputing quantiles over a different set of trades, since this
    screen lists open positions too, and the row would send you to trades it
    never counted.
  */
  /* Memoised on the query string itself: rebuilding this object every render
     would give Trades' row filter a new dependency each time and make it
     recompute over the whole journal for nothing. */
  const edgeKey = params.toString();
  const edge = useMemo(() => (params.get("dim")
    ? {
        dim: params.get("dim"),
        key: params.get("key") ?? undefined,
        lo: params.get("lo") ?? undefined,
        hi: params.get("hi") ?? undefined,
        band: params.get("band") ?? undefined,
      }
    : null), [edgeKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  const { all, diary, saveDiaryEntry, removeChartFromEntry,
          openEditTrade, openExitTrade, removeTrade, openNewTrade,
          reloadTrades, say, filters, saveView, removeView, profile } = useJournal();

  /*
    Recording that the pair was looked at, and nothing else. Neither row is
    touched — no date, no quantity, no P&L — because whichever of them was
    wrong is a correction only the trader can make, and this is the note
    saying they made it or decided none was needed.
  */
  const ackDuplicate = async (id) => {
    try {
      await acknowledgeDuplicate(id);
      await reloadTrades();
      say("Flag cleared.");
    } catch (e) {
      say(e.message || "Could not clear the flag.");
      throw e;
    }
  };

  return (
    <Trades
      all={all}
      diary={diary}
      filters={filters}
      journalName={profile?.journal_name}
      onSaveView={saveView}
      onDeleteView={removeView}
      mistake={mistake}
      missing={missing}
      edge={edge}
      onClearFilter={() => router.push("/trades")}
      onAcknowledgeDuplicate={ackDuplicate}
      onAttachChart={saveDiaryEntry}
      onRemoveChart={removeChartFromEntry}
      /**
       * Typing a stop straight into the row.
       *
       * The full form is still there for pattern, chart, reason and emotion —
       * those need a chart open beside you. A stop usually does not, so
       * making it cost a modal was the wrong price for the commonest edit on
       * this screen.
       *
       * Marked RECORDED, because typing a number is somebody answering. The
       * one-click "the guess was right" that the stops queue deliberately
       * does not have is still absent here: there is no control that commits
       * a value nobody typed.
       */
      onSaveStop={async (id, stop) => {
        await saveStops([{ id, stop_loss: stop, stop_source: "recorded" }]);
        await reloadTrades();
        say("Stop saved.");
      }}
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
