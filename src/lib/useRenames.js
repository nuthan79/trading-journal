import { useEffect, useMemo, useState } from "react";
import { activeRegion } from "./regions";
import { renamedTo } from "./renames";

/**
 * `(symbol, exchange) => { to, since } | null` for the screen that renders it.
 *
 * public/renames.json is fetched once per page load, in an Indian book only —
 * the US file carries no ISIN to follow, so a US book never asks. Blank until
 * it arrives and blank if it fails: a missing mark costs nothing, which is the
 * same bargain the market-cap column makes.
 */
let cached = null;

function load() {
  if (cached) return Promise.resolve(cached);
  cached = fetch("/renames.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { cached = d?.renames ? d.renames : null; return cached; })
    .catch(() => { cached = null; return null; });
  return cached;
}

export function useRenames() {
  const on = activeRegion() === "IN";
  const [data, setData] = useState(() => (cached && !(cached instanceof Promise) ? cached : null));

  useEffect(() => {
    if (!on || data) return;
    let alive = true;
    load().then((d) => { if (alive && d) setData(d); });
    return () => { alive = false; };
  }, [on, data]);

  return useMemo(() => (symbol, exchange) => (on ? renamedTo(data, symbol, exchange) : null),
    [on, data]);
}
