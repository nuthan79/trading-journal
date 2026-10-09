/**
 * Large, mid, small or micro cap — as the stock stood when it mattered.
 *
 * SEBI's line, AMFI's list: rank 1–100 by full market cap is large cap,
 * 101–250 mid, 251 onwards small. Small is split at 750 here — 751 onwards is
 * MICRO, which is this journal's word and not SEBI's, because "small cap"
 * otherwise runs from ₹30,000 Cr to a few crore and swing traders live in the
 * tail. Rank 750 is about ₹5,000 Cr in 2025–26 and, unlike a rupee line,
 * keeps its meaning in older years. See scripts/build-mcap.mjs.
 *
 * DATED, BECAUSE WINNERS GRADUATE. A small cap you bought at ₹20,000 Cr that
 * doubled may be a mid cap today. Read the book by today's list and your best
 * small-cap trades are counted as mid-cap wins while the losers slide down
 * into small — every comparison between the two then flatters one and
 * punishes the other. So every trade — closed or still held — is classified
 * by the list in force on the day it was bought, on every screen. The user's
 * call: "stick to the day of entry". Asking without a date gives the latest
 * list, and nothing on screen does.
 *
 * A STOCK LISTED AFTER THE LIST IN FORCE WAS DRAWN takes the first list it
 * appears in. A November IPO is in nobody's list until February; its first
 * ranking is the nearest honest answer, six months of hindsight at most.
 *
 * India only. The US has no official classification, and only today's market
 * caps are free there — exactly the hindsight this file exists to avoid — so
 * a US book has no such column and no such tab.
 */

import { useEffect, useMemo, useState } from "react";
import { activeRegion } from "./regions";
import { rupee } from "./format";

export const CAP_LABELS = { 1: "Large cap", 2: "Mid cap", 3: "Small cap", 4: "Micro cap" };
/* Biggest first: the table reads down the ladder, so "does it get better as
   the companies get smaller" reads straight off it. */
export const CAP_ORDER = [CAP_LABELS[1], CAP_LABELS[2], CAP_LABELS[3], CAP_LABELS[4]];

/**
 * The category for one symbol on one day, from the unpacked file.
 *
 * `date` is a stored YYYY-MM-DD, compared as a string — never through
 * `new Date`, which reads it as UTC midnight. Without a date, the latest list.
 * Before the first list took effect (February 2018), the first list.
 */
export function capOn(data, symbol, date) {
  return placed(data, symbol, date)?.label || "";
}

/** The category, and the list it came from. */
function placed(data, symbol, date) {
  if (!data) return null;
  const codes = data.map[String(symbol || "").toUpperCase()];
  if (!codes) return null;
  const lists = data.lists;
  let i = lists.length - 1;
  if (date) {
    const d = String(date).slice(0, 10);
    i = 0;
    for (let k = 0; k < lists.length; k++) if (lists[k].from <= d) i = k;
  }
  /* Not ranked yet in the list in force — listed since it was drawn. */
  for (let k = i; k < codes.length; k++) {
    if (codes[k] !== "-" && CAP_LABELS[codes[k]]) {
      return { label: CAP_LABELS[codes[k]], code: codes[k], list: k };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  What the words mean in rupees                                      */
/* ------------------------------------------------------------------ */

const cr = (v) => `${rupee(v, { compact: false })} Cr`;
const RANKS = { 1: "ranks 1–100", 2: "ranks 101–250", 3: "ranks 251–750", 4: "rank 751 onwards" };

/**
 * A category in rupees for one list: "₹12,093 Cr to ₹34,758 Cr". The floors
 * are the smallest company of each size in that list, so the range is what
 * that list actually drew — and it moves list to list with the market.
 */
export function capRange(code, floors) {
  if (!floors) return "";
  const { large, mid, small } = floors;
  return code === "1" ? `${cr(large)} and above`
    : code === "2" ? `${cr(mid)} to ${cr(large)}`
    : code === "3" ? `${cr(small)} to ${cr(mid)}`
    : code === "4" ? `below ${cr(small)}`
    : "";
}

const CODE_OF = Object.fromEntries(Object.entries(CAP_LABELS).map(([c, l]) => [l, c]));

/**
 * The hover for one stock's category: the rupee range and the ranks, from the
 * list that placed it — the one in force on `date`, or the stock's first list
 * if it listed since. Which list, and that micro is not SEBI's word, were cut
 * at the user's request as too much for a hover; the column header's own
 * hint still says the second.
 */
export function capHint(data, symbol, date) {
  const p = placed(data, symbol, date);
  if (!p) return "";
  return `${p.label}: ${capRange(p.code, data.lists[p.list].floors)}, ${RANKS[p.code]}.`;
}

/**
 * The hover for a whole category on What works. Its trades were bought under
 * different lists, so the range is the span of THOSE lists' lines — the
 * lowest floor to the highest ceiling among them — and says so. Today's line
 * would describe a category some of these trades were never in.
 */
export function capRangeFor(data, label, trades = []) {
  const code = CODE_OF[label];
  if (!data || !code) return "";
  const used = new Set();
  for (const t of trades) {
    const p = placed(data, t.symbol, t.entry_date);
    if (p && p.code === code) used.add(p.list);
  }
  if (!used.size) return "";
  const idx = [...used].sort((a, b) => a - b);
  /* The range and the ranks, and nothing else — the user cut the sentence
     about how many lists and which half-years as too much for a hover. */
  const f = idx.map((i) => data.lists[i].floors);
  const lo = (k) => Math.min(...f.map((x) => x[k]));
  const hi = (k) => Math.max(...f.map((x) => x[k]));
  const span = code === "1" ? `${cr(lo("large"))} and above`
    : code === "2" ? `${cr(lo("mid"))} to ${cr(hi("large"))}`
    : code === "3" ? `${cr(lo("small"))} to ${cr(hi("mid"))}`
    : `below ${cr(hi("small"))}`;
  return `${label} when you bought these: ${span}, ${RANKS[code]}.`;
}

let cached = null;      // the file, or a promise for it while in flight

/** Fetched at most once per page load. A failure is not cached as empty. */
export function loadMarketCaps() {
  if (cached) return Promise.resolve(cached);
  cached = fetch("/mcap.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data?.map && data?.lists?.length) { cached = data; return data; }
      cached = null;
      return null;
    })
    .catch(() => { cached = null; return null; });
  return cached;
}

const ready = () => (cached && !(cached instanceof Promise) ? cached : null);

/** Whether the open book has this classification at all. */
export const hasMarketCaps = (region = activeRegion()) => region === "IN";

/**
 * The lookup a screen renders through: `(symbol, date?) => "Mid cap" | ""`.
 *
 * `enabled` is whether anything on screen needs it. Off, or in a US book,
 * nothing is fetched and every answer is blank — which is also the answer
 * for the render or two while the file is in flight, so callers must take a
 * blank at any moment. The same function is returned until the file arrives,
 * so rows memoised on it are not rebuilt on every render.
 */
export function useMarketCap(enabled = true) {
  const on = enabled && hasMarketCaps();
  const [data, setData] = useState(ready);

  useEffect(() => {
    if (!on || data) return;
    let alive = true;
    loadMarketCaps().then((d) => { if (alive && d) setData(d); });
    return () => { alive = false; };
  }, [on, data]);

  /* `capOf(symbol, date)` for the cell, with the two hovers hung on it, so a
     screen takes one thing from the hook and every answer comes from the
     same file. */
  return useMemo(() => {
    const capOf = (symbol, date) => (on ? capOn(data, symbol, date) : "");
    capOf.hint = (symbol, date) => (on ? capHint(data, symbol, date) : "");
    capOf.rangeFor = (label, trades) => (on ? capRangeFor(data, label, trades) : "");
    return capOf;
  }, [on, data]);
}
