"use client";

import { useEffect, useMemo, useState } from "react";
import Holdings from "@/components/journal/Holdings";
import { markOpenPositions, acknowledgeBreakeven, resolveSoldSnapshots,
         listSplits, listClosesOn, applySplitAdjustments } from "@/lib/db";
import { splitPlan, symbolsOf, verifySplitPlan, priceKeysFor } from "@/lib/splits";
import { loadSplitCache, saveSplitCache, staleKeys, splitsFromCache,
         mergeIntoCache } from "@/lib/splitCache";
import { measurePaths, needsMeasuring } from "@/lib/measure";
import { useJournal } from "../JournalContext";

export default function HoldingsPage() {
  const {
    open, closed, diary, mergeMarks, say, reloadTrades, saveDiaryEntry, removeChartFromEntry,
    openEditTrade, openExitTrade, removeTrade, profile, all,
  } = useJournal();
  const [refreshing, setRefreshing] = useState(false);

  /**
   * SPLITS AND BONUS ISSUES, asked about once per visit.
   *
   * The whole book, not only what is held: a trade that opened before a split
   * and closed after it has a P&L in two different currencies of share, and
   * that one is already in the record. One request for every symbol, cached
   * upstream for six hours — a corporate action is announced weeks ahead.
   */
  const [splits, setSplits] = useState({});
  useEffect(() => {
    let live = true;
    /* WHAT YOU HOLD, AND NOTHING ELSE. A sold position's figures are settled
       and a split cannot make banked money more or less; checking the rest of
       the book was 292 symbols against 10, for rows nobody is reading. */
    const keys = symbolsOf(open);
    if (!keys.length) return;

    /* What is already known — shown at once, so a book checked yesterday
       draws its card without waiting for anything. Everything the cache holds
       is used, including answers about stocks now sold: knowing is free, it
       is ASKING that costs. */
    const cache = loadSplitCache();
    setSplits(splitsFromCache(keys, cache));

    /**
     * ONLY WHAT IS STILL HELD, ROUTINELY.
     *
     * Ten symbols against two hundred and ninety-two on this book: a sold
     * position's figures are settled, and a split cannot make money that has
     * already been banked more or less. Where it CAN still matter is a trade
     * that opened before a split and closed after it — its P&L is then in two
     * different sizes of share — so the sweep over sold stocks is a button
     * below the table rather than something paid for on every visit.
     */
    const ask = staleKeys(keys, keys, cache);
    if (!ask.length) return;

    /* After the page is interactive. The marks on the table are what somebody
       is waiting for; this is a background question about an event announced
       weeks in advance, and it must never compete with them. */
    const idle = typeof requestIdleCallback === "function"
      ? requestIdleCallback(run, { timeout: 4000 })
      : setTimeout(run, 1200);

    function run() {
      listSplits(ask).then((got) => {
        if (!live) return;
        const next = mergeIntoCache(cache, ask, got);
        saveSplitCache(next);
        setSplits(splitsFromCache(keys, next));
      });
    }

    return () => {
      live = false;
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(idle);
      else clearTimeout(idle);
    };
  }, [open]);

  /**
   * The candidates, and then the proof.
   *
   * The dates say a split happened while these were held; only the price on
   * the day they were bought says whether the row is still in old shares.
   * Adjusting one that a broker already adjusted multiplies the quantity and
   * divides the price by the same number — the P&L is unchanged, so the one
   * figure anybody would check it with is the one that cannot tell.
   */
  const candidates = useMemo(() => splitPlan(open, splits), [open, splits]);
  const [closes, setCloses] = useState({});
  useEffect(() => {
    let live = true;
    const keys = priceKeysFor(candidates);
    if (!keys.length) { setCloses({}); return; }
    listClosesOn(keys).then((got) => { if (live) setCloses(got); });
    return () => { live = false; };
  }, [candidates]);

  const checked = useMemo(() => verifySplitPlan(candidates, closes), [candidates, closes]);
  /* Only what the market confirms is offered. The rest is reported on the
     card, and left exactly as it is. */
  const splitsDuePlan = useMemo(() => checked.filter((p) => p.verdict === "pre-split"), [checked]);
  const splitsUnsure = useMemo(() => checked.filter((p) => p.verdict !== "pre-split"), [checked]);

  const fixSplits = async (plan) => {
    try {
      const done = await applySplitAdjustments(plan);
      await reloadTrades();
      say(`${done} position${done === 1 ? "" : "s"} restated for the split.`);
    } catch (e) {
      say(e.message || "Could not adjust those positions.");
      await reloadTrades();
    }
  };

  /* Holdings sold after they were imported — see lib/snapshots.js. The card
     on Holdings builds the plan and asks first; this carries it out. */
  const fixSoldSnapshots = async (plan) => {
    try {
      const done = await resolveSoldSnapshots(plan);
      await reloadTrades();
      say([
        done.removed && `${done.removed} sold holding${done.removed === 1 ? "" : "s"} removed`,
        done.shrunk && `${done.shrunk} trimmed to what is still held`,
        done.diaryMoved && `${done.diaryMoved} diary entr${done.diaryMoved === 1 ? "y" : "ies"} moved to the closed trade`,
      ].filter(Boolean).join(" · ") + ".");
    } catch (e) {
      say(e.message || "Could not fix those holdings.");
      await reloadTrades();
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { marked, error } = await markOpenPositions(open);
      if (marked.length) mergeMarks(marked);
      // Quotes are best-effort — the journal is fully usable without a mark,
      // so a dead source is worth saying once rather than blocking the page.
      say(error ? error : `${marked.length} position${marked.length === 1 ? "" : "s"} marked.`);

      /**
       * The badges ride along with the price refresh rather than getting a
       * button of their own.
       *
       * Refresh is already the action that means "go and look at the market",
       * and reading a week of closes for the handful of symbols on this screen
       * costs one request beside the one just made. Attached here it also
       * cannot surprise anybody: nothing reaches the network on this page
       * without the user asking it to.
       *
       * Deliberately last, and deliberately silent. A mark that arrived is
       * worth more than a badge that did not, so this must never be able to
       * turn a successful refresh into an error message — `measurePaths`
       * already swallows a rate limit into `stopped`, and the badges simply
       * stay as they were until the next press.
       */
      if (needsMeasuring(open, { includeOpen: true }).length) {
        const { measured } = await measurePaths(open, null, { includeOpen: true });
        if (measured > 0) await reloadTrades();
      }
    } finally {
      setRefreshing(false);
    }
  };


  // Recording that the reminder was read, and nothing else. The stop this
  // trade carries is the one the trader typed, and it stays that way.
  const ackBreakeven = async ({ id, symbol }) => {
    try {
      await acknowledgeBreakeven(id);
      await reloadTrades();
      say(`${symbol} reminder cleared — check the stop really is at breakeven with your broker.`);
    } catch (e) {
      say(e.message || `Could not clear the reminder on ${symbol}.`);
      throw e;
    }
  };

  return (
    <Holdings
      onFixSoldSnapshots={fixSoldSnapshots}
      splitPlan={splitsDuePlan}
      splitsUnsure={splitsUnsure}
      onFixSplits={fixSplits}
journalName={profile?.journal_name}
            open={open}
      closed={closed}
      diary={diary}
      onRefresh={refresh}
      onAttachChart={saveDiaryEntry}
      onRemoveChart={removeChartFromEntry}
      refreshing={refreshing}
      onAckBreakeven={ackBreakeven}
      onEditTrade={openEditTrade}
      onExitTrade={openExitTrade}
      onDeleteTrade={removeTrade}
    />
  );
}
