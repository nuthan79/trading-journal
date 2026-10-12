/**
 * Market breadth in the browser — the file, a hook, and the live seam.
 *
 * END OF DAY TODAY, LIVE LATER, ONE SCREEN. public/breadth.json is rebuilt
 * from NSE's bhavcopy after each close (scripts/build-breadth.mjs). Live
 * breadth needs live prices for ~750 stocks, and real-time NSE prices shown
 * to other people need a licensed vendor — so it waits for a paid feed, the
 * same step the quotes plan already has. When it arrives, `liveCounts` below
 * is the whole of the change: the builder has already written each stock's
 * levels to public/breadth-levels.json, and the feed only has to supply
 * prices. The counting is `countBreadth` either way, so the two cannot
 * disagree about what "above the 50-day" means.
 *
 * India only: the groups are AMFI's market-cap tiers and the source is NSE.
 */

import { useEffect, useMemo, useState } from "react";
import { activeRegion } from "./regions";
import { breadthBefore, bandOf, countBreadth } from "./breadthCalc";
import { SHOW_LIVE_BREADTH } from "./flags";

export const hasBreadth = (region = activeRegion()) => region === "IN";

let cached = null;      // the file, or a promise for it while in flight

/** Fetched at most once per page load. A failure is not cached as empty. */
export function loadBreadth() {
  if (cached) return Promise.resolve(cached);
  cached = fetch("/breadth.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (Array.isArray(d?.days) && d.days.length) { cached = d; return d; }
      cached = null;
      return null;
    })
    .catch(() => { cached = null; return null; });
  return cached;
}

const ready = () => (cached && !(cached instanceof Promise) ? cached : null);

/**
 * `{ data, at(date) }` — the file, and the breadth a trader could have known
 * when buying on `date` (the close before it; see breadthCalc). `data` is null
 * until the file arrives, or always in a book that has no breadth.
 */
export function useBreadth(enabled = true) {
  const on = enabled && hasBreadth();
  const [data, setData] = useState(ready);

  useEffect(() => {
    if (!on || data) return;
    let alive = true;
    loadBreadth().then((d) => { if (alive && d) setData(d); });
    return () => { alive = false; };
  }, [on, data]);

  return useMemo(() => {
    const d = on ? data : null;
    const at = (date) => (d ? breadthBefore(d.days, date) : null);
    return { data: d, at, bandAt: (date) => bandOf(at(date)?.pct) };
  }, [on, data]);
}

/**
 * Today's counts from a live feed: the stored levels judged at live prices.
 * `prices` maps symbol → price. Not called anywhere while SHOW_LIVE_BREADTH
 * is off — it is here so the screen's shape is already the live one.
 */
export function liveCounts(levels, prices) {
  if (!SHOW_LIVE_BREADTH) return null;
  return countBreadth(levels?.stocks || [], (st) => prices?.[st.s]);
}
