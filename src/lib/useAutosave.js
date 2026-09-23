"use client";

import { useCallback, useEffect, useRef } from "react";
import { scopedKey } from "./browserStore";

/**
 * Debounced localStorage autosave for in-progress form state, with an
 * immediate flush on backgrounding. beforeunload doesn't reliably fire when
 * a mobile app is backgrounded (it isn't a page unload) — visibilitychange
 * and pagehide are what actually catch the app-switch that kills the tab.
 *
 * THE KEY IS SCOPED TO THE ACCOUNT here rather than at the four call sites —
 * a draft is the most private thing this app keeps in the browser, and it is
 * restored automatically. See browserStore.js.
 */
export function useAutosave(rawKey, value, { delay = 400 } = {}) {
  const key = scopedKey(rawKey);
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  const flush = useCallback(() => {
    try {
      const v = valueRef.current;
      if (v === null || v === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // localStorage unavailable (private browsing, quota) — nothing to do
    }
  }, [key]);

  const clear = useCallback(() => {
    try { localStorage.removeItem(key); } catch {}
  }, [key]);

  useEffect(() => {
    const t = setTimeout(flush, delay);
    return () => clearTimeout(t);
  }, [value, delay, flush]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [flush]);

  return { flush, clear };
}

export function loadDraft(rawKey) {
  try {
    const raw = localStorage.getItem(scopedKey(rawKey));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearDraft(rawKey) {
  try { localStorage.removeItem(scopedKey(rawKey)); } catch {}
}

export const DRAFT_KEYS = {
  diary: "diary-draft-v1",
  trade: "trade-draft-v1",
  settings: "settings-draft-v1",
  firstRun: "first-run-draft-v1",
};
