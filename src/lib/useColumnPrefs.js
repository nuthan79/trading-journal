"use client";

import { useCallback, useState } from "react";
import { activeRegion, DEFAULT_REGION } from "./regions";
import { loadHidden, serializeHidden } from "./columnPrefs";

/**
 * A table's column choices, remembered in this browser.
 *
 * Read in the initializer rather than an effect: the journal screens render
 * only after the session resolves on the client, so there is no server render
 * to disagree with, and an effect would flash the default columns on every
 * load for anybody who chose differently. Every storage call is guarded —
 * private windows and blocked site data throw on access.
 */
/**
 * WHICH BOOK'S COLUMNS. A region is a separate book, and the columns worth
 * showing differ: MTF cost means nothing in a US book, and hiding it there
 * used to hide it in India too, because one key served both.
 *
 * India keeps the key it has always had, so nobody's saved choice moves; any
 * other market gets its own. The same reasoning as the account size — see
 * regionSettings.
 */
export const columnKeyFor = (table, region) =>
  (!region || region === DEFAULT_REGION ? table : `${table}.${region}`);

/** What this key holds now. Guarded: private windows throw on access. */
export function readHidden(key, { defaults = [], legacyKey = null } = {}) {
  let raw = null, legacy = null;
  try {
    raw = localStorage.getItem(key);
    if (legacyKey) legacy = localStorage.getItem(legacyKey);
  } catch { /* nothing stored is a valid answer */ }
  return loadHidden(raw, { defaults, legacy });
}

export function useColumnPrefs(table, { defaults = [], legacyKey = null } = {}) {
  const key = `ledgerr:columns:${columnKeyFor(table, activeRegion())}`;

  /**
   * THE KEY CAN CHANGE UNDER A MOUNTED TABLE, which is what switching books
   * does: the screens stay, the data changes. Read once in an initializer,
   * the hook kept the previous book's choice in memory and wrote it into the
   * new book's key on the first toggle — so hiding a column in the US hid it
   * in India, exactly as if the keys had never been split.
   *
   * So the key is held BESIDE the value and compared on every render. This is
   * React's own pattern for state derived from a prop, and it re-renders
   * immediately rather than after a paint — which is why it is here and not
   * in an effect: an effect would flash the previous book's columns first.
   */
  const [state, setState] = useState(() => ({ key, hidden: readHidden(key, { defaults, legacyKey }) }));
  if (state.key !== key) {
    setState({ key, hidden: readHidden(key, { defaults, legacyKey }) });
  }
  const hidden = state.key === key ? state.hidden : readHidden(key, { defaults, legacyKey });

  const setHidden = useCallback((next) => {
    setState({ key, hidden: next });
    try { localStorage.setItem(key, serializeHidden(next)); } catch {}
  }, [key]);

  const show = (k) => !hidden.has(k);
  const toggle = (k) => {
    const next = new Set(hidden);
    if (next.has(k)) next.delete(k); else next.add(k);
    setHidden(next);
  };
  const showAll = () => setHidden(new Set());
  const reset = () => setHidden(new Set(defaults));
  const isDefault = serializeHidden(hidden) === serializeHidden(new Set(defaults));

  return { hidden, show, toggle, showAll, reset, isDefault };
}
