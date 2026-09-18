"use client";

import { useCallback, useState } from "react";
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
export function useColumnPrefs(table, { defaults = [], legacyKey = null } = {}) {
  const key = `ledgerr:columns:${table}`;

  const [hidden, setHiddenState] = useState(() => {
    let raw = null, legacy = null;
    try {
      raw = localStorage.getItem(key);
      if (legacyKey) legacy = localStorage.getItem(legacyKey);
    } catch {}
    return loadHidden(raw, { defaults, legacy });
  });

  const setHidden = useCallback((next) => {
    setHiddenState(next);
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
