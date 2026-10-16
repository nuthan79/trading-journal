"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./db";
import { classifyRegime, REGIME_INDEX } from "./market";
import { activeRegion } from "./regions";

/**
 * The open book's regime index — daily closes, averages and a regime per day —
 * for any screen that reads the market beside the journal.
 *
 * ONE LOADER, SHARED. It lived inside the Process review; the diary's day
 * strip needs the same history, and a second copy of the fetch would have
 * been a second cache and a second way to read "the index that day".
 *
 * KEPT FOR THE SESSION, keyed by index. Three years of closes is several
 * seconds cold, and fetching it on every visit made the Process strip read
 * "Loading market regime…" long enough to look broken. The history only
 * changes once a day, and a regime defined by 50- and 200-day averages cannot
 * be moved by a stale afternoon close.
 */
const CACHE = new Map();

export function useRegimeHistory(enabled = true) {
  const indexName = REGIME_INDEX[activeRegion()] || "NIFTY500";
  const [market, setMarket] = useState(() => {
    const hit = CACHE.get(indexName);
    return { indexName, loading: !hit, error: null, classified: hit || [] };
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const cached = CACHE.get(indexName);
    if (cached) { setMarket({ indexName, loading: false, error: null, classified: cached }); return undefined; }
    setMarket({ indexName, loading: true, error: null, classified: [] });
    (async () => {
      try {
        const res = await apiFetch(`/api/market?index=${indexName}&range=3y`);
        const json = await res.json();
        if (!alive) return;
        const classified = classifyRegime(json.history || []);
        if (classified.length) CACHE.set(indexName, classified);
        setMarket({ indexName, loading: false, error: classified.length ? null : (json.error || null), classified });
      } catch (err) {
        if (alive) setMarket({ indexName, loading: false, error: err.message, classified: [] });
      }
    })();
    return () => { alive = false; };
  }, [indexName, enabled]);

  return market;
}
