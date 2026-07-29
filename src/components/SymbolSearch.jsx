"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";

/**
 * Type three characters, pick a stock.
 *
 * The whole NSE + BSE list loads once (a few hundred KB, cached by the
 * browser) and is searched in memory. No debounce needed, no network call
 * per keystroke, works on a flaky connection.
 *
 * What's typed is reported upward on every keystroke, not only when a
 * suggestion is taken. The list is a snapshot: tickers get renamed, delisted
 * and re-listed between rebuilds — TATAMOTORS is absent today because the
 * demerger left TMPV in its place — so a symbol missing from it is an ordinary
 * thing to be recording, not a mistake to be blocked on. Reporting only on
 * pick left the parent holding an empty symbol while the box plainly showed
 * one, which reads as a form that has stopped working for no stated reason.
 */

let LIST = null;
let LOADING = null;

async function loadSymbols() {
  if (LIST) return LIST;
  if (!LOADING) {
    LOADING = fetch("/symbols.json")
      .then((r) => r.json())
      .then((d) => (LIST = d))
      .catch(() => (LIST = []));
  }
  return LOADING;
}

/** Rank matches so that a symbol prefix beats a name prefix beats a substring. */
function search(list, q, limit = 8) {
  const s = q.trim().toUpperCase();
  if (s.length < 2) return [];
  const out = [];
  for (const item of list) {
    const sym = item.s.toUpperCase();
    const name = item.n.toUpperCase();
    let score = -1;
    if (sym === s) score = 0;
    else if (sym.startsWith(s)) score = 1;
    else if (name.startsWith(s)) score = 2;
    else if (name.includes(" " + s)) score = 3;
    else if (sym.includes(s)) score = 4;
    else if (name.includes(s)) score = 5;
    if (score >= 0) {
      // Nudge NSE above BSE when both match equally — it's where the liquidity is
      out.push({ item, score: score * 10 + (item.e === "NSE" ? 0 : 1) });
      if (out.length > 400) break;
    }
  }
  out.sort((a, b) => a.score - b.score || a.item.s.length - b.item.s.length);
  return out.slice(0, limit).map((x) => x.item);
}

/** An exact symbol match, NSE first when both exchanges carry the same ticker. */
function exact(list, text) {
  const s = text.trim().toUpperCase();
  if (!s) return null;
  let hit = null;
  for (const item of list) {
    if (item.s.toUpperCase() !== s) continue;
    if (item.e === "NSE") return item;
    hit = hit || item;
  }
  return hit;
}

export default function SymbolSearch({ value, exchange, onPick, autoFocus }) {
  const [q, setQ] = useState(value || "");
  const [list, setList] = useState(LIST || []);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef(null);

  useEffect(() => { loadSymbols().then(setList); }, []);
  useEffect(() => { setQ(value || ""); }, [value]);

  useEffect(() => {
    const away = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const results = useMemo(() => search(list, q), [list, q]);

  const choose = useCallback((item) => {
    setQ(item.s);
    setOpen(false);
    onPick?.({ symbol: item.s, company: item.n, exchange: item.e });
  }, [onPick]);

  // Typed, not picked. Typing a ticker out in full is as good as choosing it
  // from the list, so an exact match is adopted whole — otherwise a listed
  // symbol would sit there with no company name and get described as unlisted.
  //
  // Everything else really has no name behind it, and `company: null` says so.
  // Keeping the last one would leave the wrong company under the right symbol.
  // Exchange stays as the parent has it: there's no field for it, and guessing
  // is worse than leaving the last known answer alone.
  const type = (text) => {
    setQ(text);
    setOpen(true);
    setHi(0);
    const m = exact(list, text);
    onPick?.(m
      ? { symbol: m.s, company: m.n, exchange: m.e }
      : { symbol: text, company: null, exchange });
  };

  const onKey = (e) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!open || !results.length) {
      // Nothing to choose from, so Enter accepts what's already been typed.
      if (e.key === "Enter") { e.preventDefault(); setOpen(false); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => (i + 1) % results.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => (i - 1 + results.length) % results.length); }
    else if (e.key === "Enter") { e.preventDefault(); choose(results[hi]); }
  };

  return (
    <div ref={boxRef} className="ss">
      <input
        className="in"
        autoFocus={autoFocus}
        value={q}
        placeholder="Type 3 letters — TATA, RELI, HDFC"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => type(e.target.value.toUpperCase())}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        aria-autocomplete="list"
        aria-expanded={open}
      />

      {open && q.trim().length >= 2 && (
        <div className="ss-pop" role="listbox">
          {results.length === 0 ? (
            <div className="ss-none">
              {list.length === 0
                ? "Symbol list not built yet — run: node scripts/build-symbols.mjs"
                : <>Nothing matches <b>{q}</b> — it will be recorded exactly as typed.</>}
            </div>
          ) : (
            results.map((item, i) => (
              <button
                key={`${item.e}:${item.s}`}
                role="option"
                aria-selected={i === hi}
                className="ss-row"
                data-hi={i === hi ? 1 : 0}
                onMouseEnter={() => setHi(i)}
                onClick={() => choose(item)}
              >
                <span className="ss-sym">{item.s}</span>
                <span className="ss-name">{item.n}</span>
                <span className="ss-ex" data-ex={item.e}>{item.e}</span>
              </button>
            ))
          )}
        </div>
      )}

      <style jsx>{`
        .ss { position: relative; }
        .ss-pop {
          position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 40;
          background: #fff; border: 1px solid var(--rule); border-radius: 3px;
          box-shadow: 0 10px 28px rgba(19, 28, 26, 0.14);
          max-height: 292px; overflow-y: auto;
        }
        .ss-row {
          display: grid; grid-template-columns: 88px 1fr auto; gap: 10px; align-items: baseline;
          width: 100%; text-align: left; padding: 9px 12px; background: none;
          border: 0; border-bottom: 1px solid var(--rule); cursor: pointer;
        }
        .ss-row:last-child { border-bottom: 0; }
        .ss-row[data-hi="1"] { background: #F1F5F3; }
        .ss-sym {
          font-family: 'Spline Sans Mono', monospace; font-size: 13px;
          font-weight: 600; color: var(--ink);
        }
        .ss-name {
          font-size: 12px; color: var(--ink2); overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
        }
        .ss-ex {
          font-size: 9px; font-weight: 700; letter-spacing: 0.09em;
          padding: 2px 5px; border-radius: 2px; border: 1px solid var(--rule);
          color: var(--ink3);
        }
        .ss-ex[data-ex="NSE"] { color: var(--brass); border-color: var(--brass); }
        .ss-none { padding: 14px 12px; font-size: 12px; color: var(--ink3); }
      `}</style>
    </div>
  );
}
