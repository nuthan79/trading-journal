"use client";

import { apiFetch, savePaths } from "./db";
import { tradePath } from "./path";
/* The same test the route applies, imported rather than restated — this
   screen counting a trade as measurable while the route refuses it is how a
   button offers work that silently never happens. */
import { tickerFor, barsKeyFor, BARS_PER_REQUEST } from "./bars";
import { hasRealStop } from "./stops";

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

/**
 * MUST MATCH `MAX_SYMBOLS` in /api/bars, which slices off anything past it.
 *
 * Sending more does not fail — the extra symbols are dropped in silence and
 * come back as trades that never measure however many times the button is
 * pressed. This was 25 for one commit after the route dropped to 12, which is
 * exactly the failure the previous version of this comment described.
 */
const SYMBOLS_PER_CALL = BARS_PER_REQUEST;

const DAY = 86400000;
const iso = (d) => String(d || "").slice(0, 10);
const shift = (d, n) => new Date(new Date(d).getTime() + n * DAY).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

/** The last session a measurement should reach: the exit if there is one,
 *  otherwise now. */
export const measureTo = (t) => (t.status === "closed" ? iso(t.exit_date) : today());

/**
 * Which trades can be measured, and which are deliberately skipped.
 *
 * `path_to` is the test, not `mfe_r`: a trade that was measured and never
 * became risk-free has a null in every other column, and keying on those
 * would re-measure it on every visit forever.
 *
 * BUT PRESENT IS NOT THE SAME AS COMPLETE, and the first version missed it. A
 * position measured while open carries a `path_to` from that day; when it
 * later closes, the columns still describe the part of the trade that had
 * happened by then, and a plain "has path_to" test would call that finished
 * forever. So the test is whether the measurement REACHES the trade's end.
 *
 * Three days of tolerance on that, because a trade whose final session left no
 * bar — a halt, a suspension — would otherwise be re-read on every visit for
 * the rest of its life and never get any further.
 */
export function needsMeasuring(trades, { includeOpen = false } = {}) {
  return (trades || []).filter((t) => {
    if (!t.symbol || !t.entry_date) return false;
    /* NSE and BSE both, refused only where the symbol is a bare scrip code
       that never resolved to a ticker — see the note in bars.js. */
    if (!tickerFor(t.symbol, t.exchange)) return false;
    if (!hasRealStop(t)) return false;   // no 1R to measure a path against

    if (t.status === "closed") {
      if (!t.exit_date || !(iso(t.entry_date) < iso(t.exit_date))) return false;
      return !t.path_to || t.path_to < shift(iso(t.exit_date), -3);
    }

    if (!includeOpen) return false;
    if (!(iso(t.entry_date) < today())) return false;
    /**
     * Weekly, not daily, for an open position.
     *
     * The two things the badges rest on settle early and then stop moving —
     * whether it ran 3R in its first five sessions is decided by day five, and
     * whether it ever closed past 1.5R only ever becomes more true. Re-reading
     * every symbol every day would spend the rate limit to learn almost
     * nothing; where a position stands RIGHT NOW comes from the mark that
     * Refresh already fetches.
     */
    return !t.path_to || t.path_to < shift(today(), -7);
  });
}

/**
 * @param trades      every trade; the eligible ones are picked here
 * @param onProgress  ({ done, total, phase }) — for a button that says what
 *                    it is doing rather than spinning
 * @returns { measured, skipped, symbols, stopped }
 */
export async function measurePaths(trades, onProgress, opts = {}) {
  const todo = needsMeasuring(trades, opts);
  if (!todo.length) return { measured: 0, skipped: 0, symbols: 0, stopped: null };

  /* Earliest entry to latest end, per listing — one window that covers every
     trade in that symbol however many there are, open ones running to today. */
  const bySymbol = new Map();
  for (const t of todo) {
    const key = barsKeyFor(t.symbol, t.exchange);
    const cur = bySymbol.get(key);
    const from = String(t.entry_date).slice(0, 10);
    const to = measureTo(t);
    if (!cur) bySymbol.set(key, { symbol: t.symbol, exchange: t.exchange, from, to, trades: [t] });
    else {
      if (from < cur.from) cur.from = from;
      if (to > cur.to) cur.to = to;
      cur.trades.push(t);
    }
  }

  const groups = [...bySymbol.values()];
  let measured = 0, skipped = 0, stopped = null;
  /* Counted by cause, not just totalled — "112 could not be read" was true
     and told nobody anything. */
  const reasons = new Map();

  for (let i = 0; i < groups.length; i += SYMBOLS_PER_CALL) {
    const batch = groups.slice(i, i + SYMBOLS_PER_CALL);
    onProgress?.({ done: i, total: groups.length, phase: "reading" });

    let payload;
    try {
      const res = await apiFetch("/api/bars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          want: batch.map(({ symbol, exchange, from, to }) => ({ symbol, exchange, from, to })),
        }),
      });

      /**
       * apiFetch HANDS BACK THE RESPONSE, NOT THE BODY.
       *
       * This treated it as the parsed payload, so `payload.bars` was undefined
       * on every call and every symbol came back "could not be read" — with no
       * error, because nothing threw. A hundred and twelve trades failed
       * identically and the message blamed the data.
       *
       * Every other apiFetch caller in the app parses and checks the status;
       * this one now does both, and a refusal the server explained in words
       * reaches the reader in those words instead of as a silent zero.
       */
      payload = await res.json().catch(() => null);
      if (!res.ok || !payload) {
        stopped = payload?.error
          || `The price history service answered ${res.status}.`;
        break;
      }
      if (payload.error) { stopped = payload.error; break; }
    } catch (err) {
      /* Offline, or the request never completed. Everything already saved
         stays saved, and the caller is told why it stopped rather than being
         handed a half-finished number with no explanation. */
      stopped = err?.message || "Price history is unavailable just now.";
      break;
    }

    const bars = payload.bars || {};
    /* Why the server could not read each one, AND WHICH ONE.
       
       The symbol used to be dropped here and only the reason counted, so a
       failed pass said "1 could not be read — 1 HTTP 404" and left the reader
       guessing which of a hundred and twenty trades it meant. A 404 is
       actionable — it is almost always a delisted or renamed ticker, and the
       fix is to correct that one symbol — but only if you know which one. */
    let throttled = 0;
    for (const s of payload.skipped || []) {
      if (!s?.why) continue;
      if (!reasons.has(s.why)) reasons.set(s.why, new Set());
      /* The key is SYMBOL:EXCHANGE; the symbol is the half worth showing. */
      reasons.get(s.why).add(String(s.key || "").split(":")[0] || "?");
      if (/429/.test(s.why)) throttled++;
    }

    /**
     * STOP WHEN A WHOLE BATCH COMES BACK THROTTLED.
     *
     * Carrying on through the remaining batches does not just fail — it
     * deepens the block, so the next attempt starts worse than this one did.
     * A single symbol refused among eleven that worked is noise and is not
     * this; every symbol refused is the upstream saying wait.
     *
     * Everything measured before this point is already saved, so stopping
     * costs nothing but the rest of this pass.
     */
    if (throttled >= batch.length && Object.keys(bars).length === 0) {
      stopped = "The price source is rate-limiting this deployment. " +
        "Everything read so far is saved — leave it a few minutes and press again.";
      break;
    }
    const patches = [];

    for (const g of batch) {
      const series = bars[barsKeyFor(g.symbol, g.exchange)];
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
  return {
    measured, skipped, symbols: groups.length, stopped,
    reasons: [...reasons.entries()]
      .sort((a, b) => b[1].size - a[1].size)
      .map(([why, syms]) => ({ why, n: syms.size, symbols: [...syms] })),
  };
}
