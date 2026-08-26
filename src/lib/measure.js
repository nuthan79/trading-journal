"use client";

import { apiFetch, savePaths } from "./db";
import { tradePath } from "./path";

/**
 * Reading the price path for trades that have never had one read.
 *
 * WHY IT RUNS RETROSPECTIVELY RATHER THAN NIGHTLY. The obvious design is a
 * cron that records what every holding did each day, and it has one fatal
 * property: it can only ever learn about trades taken after it was switched
 * on. Yahoo will return a date range in a single request, so the same
 * measurement can be taken backwards over a book that already exists — a
 * journal with four hundred closed trades gets the whole analysis this week
 * instead of accumulating it over the next two years.
 *
 * ONE PASS PER SYMBOL, NOT PER TRADE. Somebody who traded the same stock
 * eleven times needs one request covering the earliest entry to the latest
 * exit, not eleven overlapping ones. On a real book that is the difference
 * between forty requests and four hundred, which on an unofficial endpoint
 * that rate-limits is the difference between working and not.
 *
 * AND IT IS DESIGNED TO BE INTERRUPTED. Every batch saves before the next one
 * starts, so a 429 halfway through leaves the first half measured and stored
 * rather than throwing the lot away. Running it again picks up what is left.
 */

/** The route's own ceiling. Sending more just means it silently drops the
 *  tail, which would look like symbols that mysteriously never measure. */
const SYMBOLS_PER_CALL = 25;

/**
 * Which trades can be measured, and which are deliberately skipped.
 *
 * `path_to` is the test, not `mfe_r`: a trade that was measured and never
 * became risk-free has a null in every other column, and keying on those
 * would re-measure it on every visit forever.
 */
export function needsMeasuring(trades) {
  return (trades || []).filter((t) =>
    t.status === "closed" &&
    !t.path_to &&
    t.exchange === "NSE" &&          // a BSE scrip code is not a Yahoo ticker
    t.stop_source !== "assumed" &&   // R against a stop nobody set is not R
    t.symbol && t.entry_date && t.exit_date &&
    t.entry_date < t.exit_date       // nothing to read on a same-day trade
  );
}

/**
 * @param trades      every trade; the eligible ones are picked here
 * @param onProgress  ({ done, total, phase }) — for a button that says what
 *                    it is doing rather than spinning
 * @returns { measured, skipped, symbols, stopped }
 */
export async function measurePaths(trades, onProgress) {
  const todo = needsMeasuring(trades);
  if (!todo.length) return { measured: 0, skipped: 0, symbols: 0, stopped: null };

  /* Earliest entry to latest exit, per listing — one window that covers every
     trade in that symbol however many there are. */
  const bySymbol = new Map();
  for (const t of todo) {
    const key = `${t.symbol}:${t.exchange}`;
    const cur = bySymbol.get(key);
    const from = String(t.entry_date).slice(0, 10);
    const to = String(t.exit_date).slice(0, 10);
    if (!cur) bySymbol.set(key, { symbol: t.symbol, exchange: t.exchange, from, to, trades: [t] });
    else {
      if (from < cur.from) cur.from = from;
      if (to > cur.to) cur.to = to;
      cur.trades.push(t);
    }
  }

  const groups = [...bySymbol.values()];
  let measured = 0, skipped = 0, stopped = null;

  for (let i = 0; i < groups.length; i += SYMBOLS_PER_CALL) {
    const batch = groups.slice(i, i + SYMBOLS_PER_CALL);
    onProgress?.({ done: i, total: groups.length, phase: "reading" });

    let payload;
    try {
      payload = await apiFetch("/api/bars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          want: batch.map(({ symbol, exchange, from, to }) => ({ symbol, exchange, from, to })),
        }),
      });
    } catch (err) {
      /* Almost always the rate limit. Everything already saved stays saved,
         and the caller is told why it stopped rather than being handed a
         half-finished number with no explanation. */
      stopped = err?.message || "Price history is unavailable just now.";
      break;
    }

    const bars = payload?.bars || {};
    const patches = [];

    for (const g of batch) {
      const series = bars[`${g.symbol}:${g.exchange}`];
      if (!series || !series.length) { skipped += g.trades.length; continue; }

      for (const t of g.trades) {
        const p = tradePath(t, series);
        if (!p) { skipped++; continue; }
        patches.push({
          id: t.id,
          mfe_r: p.mfeR,
          mae_r: p.maeR,
          mfe_days: p.daysToMfe,
          became_free_on: p.becameFreeOn,
          is_power: p.isPower,
          gapped_breakeven: p.gappedThroughBreakeven,
          /* The last session actually read. On a closed trade this is the
             exit; it is also the flag that says "measured" at all. */
          path_to: p.to,
        });
      }
    }

    if (patches.length) {
      onProgress?.({ done: i, total: groups.length, phase: "saving" });
      try {
        await savePaths(patches);
        measured += patches.length;
      } catch (err) {
        stopped = err?.message || "Could not save what was measured.";
        break;
      }
    }
  }

  onProgress?.({ done: groups.length, total: groups.length, phase: "done" });
  return { measured, skipped, symbols: groups.length, stopped };
}
