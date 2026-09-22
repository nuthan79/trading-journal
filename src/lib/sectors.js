/**
 * What business a stock is in.
 *
 * A swing book is usually a bet on a few themes at once without saying so —
 * four capital goods names bought in the same fortnight is one idea with four
 * tickers on it, and nothing on the screen said that until this column. So
 * this exists to be READ DOWN a table rather than looked up one stock at a
 * time; that is what decides everything below.
 *
 * TWO LEVELS, NOT FOUR. India's scheme has Macro-Economic Sector / Sector /
 * Industry / Basic Industry and the US has its own; the middle two are the
 * ones that group a book usefully. "Energy" puts a refiner and a solar EPC
 * together, and "Refineries & Marketing" splits names nobody would trade
 * differently.
 *
 * ONE FILE PER BOOK, and never blended. A sector name means whatever its own
 * market's classification says it means: "Oil Gas & Consumable Fuels" is NSE's
 * and "Energy" is Nasdaq's, for the same company. Mapping one onto the other
 * would invent a joint taxonomy neither exchange publishes, and the column
 * would then be wrong in a way nothing on screen could show. A region is a
 * separate book here too — see regions.js.
 *
 * NOTHING IS FETCHED UNTIL A COLUMN ASKS. Both columns are off by default and
 * the file is loaded on the first render that has one showing, once per book
 * per session. Somebody who never turns them on never pays for them, which is
 * the same bargain the split check makes.
 *
 * A STOCK THAT IS NOT IN THE FILE HAS NO SECTOR, and the column shows a dash.
 * ETFs genuinely have none, a listing can be too new for the classification,
 * and about 130 NSE-only names are carried by no published list at all. A dash
 * is the honest answer; the alternative is a guess from the company name.
 *
 * The files are built by scripts/build-sectors.mjs — see it for where the
 * classifications come from and why.
 */

import { useCallback, useEffect, useState } from "react";
import { activeRegion, DEFAULT_REGION } from "./regions";

/* Same shape and same reasoning as the symbol files in SymbolSearch: the
   default book keeps the plain name it has always had, everything else is
   suffixed. */
const FILES = { IN: "/sectors.json", US: "/sectors.us.json" };

export const sectorFileFor = (region) => FILES[region] || FILES[DEFAULT_REGION];

/** Nothing to show, in the one shape every caller destructures. */
const NONE = { sector: "", industry: "" };

/* region → the unpacked file, or a promise for it while it is in flight. One
   fetch per book per page load; the browser's own cache covers reloads. */
const cache = new Map();

/**
 * The names are stored once and each stock points at them by index — see
 * `pack` in the builder. Unpacking to a plain Map of objects here costs one
 * pass over five thousand rows and makes every lookup afterwards a Map hit
 * with no array indexing at the call site.
 */
function unpack(raw) {
  const sectors = raw?.sectors || [];
  const industries = raw?.industries || [];
  const out = new Map();
  for (const [sym, pair] of Object.entries(raw?.map || {})) {
    out.set(sym, {
      sector: sectors[pair?.[0]] || "",
      industry: industries[pair?.[1]] || "",
    });
  }
  return out;
}

/**
 * The book's classifications, fetched at most once.
 *
 * A failure resolves to an empty map rather than rejecting: the file not being
 * there is exactly the state a book has before the builder is first run, and
 * the table should show dashes rather than break. It is NOT cached as empty —
 * a flaky network on the first render should not turn the column off for the
 * rest of the session.
 */
export function loadSectors(region = activeRegion()) {
  const hit = cache.get(region);
  if (hit) return Promise.resolve(hit).then((v) => (v instanceof Map ? v : unpack(v)));

  const p = fetch(sectorFileFor(region))
    .then((r) => (r.ok ? r.json() : null))
    .then((raw) => {
      const map = unpack(raw);
      if (map.size) cache.set(region, map);
      else cache.delete(region);
      return map;
    })
    .catch(() => { cache.delete(region); return new Map(); });

  cache.set(region, p);
  return p;
}

/** What is already in hand for this book, without asking for it. */
const ready = (region) => {
  const hit = cache.get(region);
  return hit instanceof Map ? hit : null;
};

/**
 * The lookup a table renders through.
 *
 * `enabled` is whether either column is showing. Off, this fetches nothing and
 * every lookup answers empty — which is also what happens for the first render
 * or two while the file is in flight, so the cells must be written to take a
 * blank answer at any moment and not only at the start.
 *
 * THE BOOK IS HELD BESIDE THE MAP and compared on every render, for the reason
 * useColumnPrefs does the same: a `useState` initializer runs once, and these
 * tables stay mounted when the book changes underneath them. Kept as derived
 * state rather than an effect so the new book never paints a frame of the old
 * book's sectors.
 */
export function useSectors(enabled = true) {
  const region = activeRegion();
  const [state, setState] = useState(() => ({ region, map: ready(region) }));
  if (state.region !== region) setState({ region, map: ready(region) });
  const map = state.region === region ? state.map : ready(region);

  useEffect(() => {
    if (!enabled || map) return;
    let alive = true;
    loadSectors(region).then((m) => { if (alive && m.size) setState({ region, map: m }); });
    return () => { alive = false; };
  }, [enabled, region, map]);

  /* The same function until the file actually arrives. Callers hang this off
     a useMemo that rebuilds every row, and a fresh closure each render would
     rebuild them on every keystroke in the search box. */
  return useCallback(
    (symbol) => (map && map.get(String(symbol || "").toUpperCase())) || NONE,
    [map],
  );
}
