"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";

/**
 * Type three characters, pick a stock and an exchange.
 *
 * The symbol file holds ONE row per company carrying the exchanges it trades
 * on, so a dual-listed name doesn't sit in the data twice. Here that row is
 * expanded back out into one line per exchange, because at the moment of
 * logging a trade the exchange is a real choice you have to make — it decides
 * which exchange fee applies, and which Yahoo ticker the price comes from.
 *
 * So typing INFY offers:
 *     INFY   Infosys Limited        NSE
 *     INFY   Infosys Limited        BSE
 *
 * The whole list loads once and is searched in memory — no network call per
 * keystroke, and it works on a poor connection.
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

/** Older files stored a single exchange string; treat that as a one-item list. */
const exchangesOf = (item) =>
  Array.isArray(item.x) && item.x.length ? item.x : [item.e || "NSE"];

/**
 * Rank matches: symbol prefix beats name prefix beats substring. Companies are
 * matched first and expanded afterwards, so a dual-listed name never crowds a
 * better match off the list by occupying two slots.
 */
function search(list, q, { maxCompanies = 6 } = {}) {
  const s = q.trim().toUpperCase();
  if (s.length < 2) return [];

  const scored = [];
  for (const item of list) {
    const sym = (item.s || "").toUpperCase();
    const name = (item.n || "").toUpperCase();
    let score = -1;
    if (sym === s) score = 0;
    else if (sym.startsWith(s)) score = 1;
    else if (name.startsWith(s)) score = 2;
    else if (name.includes(" " + s)) score = 3;
    else if (sym.includes(s)) score = 4;
    else if (name.includes(s)) score = 5;

    if (score >= 0) {
      scored.push({ item, score });
      if (scored.length > 500) break;
    }
  }

  scored.sort((a, b) => a.score - b.score || a.item.s.length - b.item.s.length);

  const rows = [];
  for (const { item } of scored.slice(0, maxCompanies)) {
    for (const ex of exchangesOf(item)) {
      rows.push({
        symbol: item.s,
        company: item.n,
        exchange: ex,
        bseCode: ex === "BSE" ? item.b || null : null,
        // true when the same company is also available on the other exchange,
        // so the UI can explain why a name appears twice
        dual: exchangesOf(item).length > 1,
      });
    }
  }
  return rows;
}

export default function SymbolSearch({ value, onPick, autoFocus, exchange }) {
  const [q, setQ] = useState(value || "");
  const [list, setList] = useState(LIST || []);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { loadSymbols().then(setList); }, []);
  useEffect(() => { setQ(value || ""); }, [value]);

  useEffect(() => {
    const away = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const results = useMemo(() => search(list, q), [list, q]);

  // keep the highlighted row in view when arrowing past the fold
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-i="${hi}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const choose = useCallback((row) => {
    setQ(row.symbol);
    setOpen(false);
    onPick?.(row);
  }, [onPick]);

  const onKey = (e) => {
    if (!open || !results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => (i + 1) % results.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => (i - 1 + results.length) % results.length); }
    else if (e.key === "Enter") { e.preventDefault(); choose(results[hi]); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={boxRef} className="ss">
      <input
        className="in"
        autoFocus={autoFocus}
        value={q}
        placeholder="Type 3 letters — INFY, TATA, RELI"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => { setQ(e.target.value.toUpperCase()); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        aria-autocomplete="list"
        aria-expanded={open}
      />

      {/* what's currently selected, once the dropdown is closed */}
      {!open && value && exchange && (
        <div className="ss-current">
          trading on <b>{exchange}</b>
        </div>
      )}

      {open && q.trim().length >= 2 && (
        <div className="ss-pop" role="listbox" ref={listRef}>
          {results.length === 0 ? (
            <div className="ss-none">
              {list.length === 0
                ? "Symbol list not built yet — run: node scripts/build-symbols.mjs"
                : `Nothing matches "${q}". You can still type the symbol by hand.`}
            </div>
          ) : (
            results.map((row, i) => (
              <button
                key={`${row.symbol}:${row.exchange}`}
                type="button"
                role="option"
                aria-selected={i === hi}
                className="ss-row"
                data-i={i}
                data-hi={i === hi ? 1 : 0}
                onMouseEnter={() => setHi(i)}
                onClick={() => choose(row)}
              >
                <span className="ss-sym">{row.symbol}</span>
                <span className="ss-name">{row.company}</span>
                <span className="ss-ex" data-ex={row.exchange}>{row.exchange}</span>
              </button>
            ))
          )}
          {results.some((r) => r.dual) && (
            <div className="ss-foot">
              Names listed twice trade on both exchanges — pick the one you dealt on.
              It sets the exchange fee and where the price is fetched from.
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .ss { position: relative; }
        .ss-current {
          font-size: 11px; color: var(--ink3); margin-top: 5px;
        }
        .ss-current b { color: var(--ink2); font-weight: 600; }
        .ss-pop {
          position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 40;
          background: #fff; border: 1px solid var(--rule); border-radius: 3px;
          box-shadow: 0 10px 28px rgba(19, 28, 26, 0.14);
          max-height: 320px; overflow-y: auto;
        }
        .ss-row {
          display: grid; grid-template-columns: 92px 1fr auto; gap: 10px;
          align-items: baseline; width: 100%; text-align: left;
          padding: 9px 12px; background: none; border: 0;
          border-bottom: 1px solid var(--rule); cursor: pointer;
        }
        .ss-row:last-of-type { border-bottom: 0; }
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
          padding: 2px 6px; border-radius: 2px; border: 1px solid var(--rule);
          color: var(--ink3); min-width: 34px; text-align: center;
        }
        .ss-ex[data-ex="NSE"] { color: var(--brass); border-color: var(--brass); }
        .ss-ex[data-ex="BSE"] { color: var(--ink2); border-color: var(--ink3); }
        .ss-none { padding: 14px 12px; font-size: 12px; color: var(--ink3); }
        .ss-foot {
          padding: 9px 12px; font-size: 10.5px; color: var(--ink3);
          border-top: 1px solid var(--rule); background: #F7F9F8;
          line-height: 1.5; text-wrap: pretty;
        }
      `}</style>
    </div>
  );
}
