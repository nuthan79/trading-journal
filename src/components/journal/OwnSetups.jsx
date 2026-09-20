"use client";

import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { customPatterns, checkPatternName, patternUsage,
         MAX_CUSTOM_PATTERNS, PATTERN_MAX_LEN } from "@/lib/patterns";
import { saveProfile, renamePattern } from "@/lib/db";

/**
 * Your own setups — up to three, beside the built-in eleven.
 *
 * SAVED AS YOU GO, not with the rest of the sheet. A rename writes every trade
 * carrying the old name, and a half-applied rename — list changed, trades not,
 * because the sheet was closed without saving — is the one state this must not
 * be able to reach. So each action completes on its own, trades first.
 *
 * THE COUNT IS THE POINT of showing usage beside each name: it is what makes
 * "this one cannot be deleted" a fact the user can see rather than a refusal.
 */
export default function OwnSetups({ profile, trades = [], onProfileChange }) {
  const mine = customPatterns(profile);
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState(null);   // { from, to }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const used = useMemo(() => {
    const m = {};
    for (const p of mine) m[p] = patternUsage(trades, p);
    return m;
  }, [mine.join("|"), trades]);

  const write = async (list, work) => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      /* The trades first. If the rename fails the list is untouched, and the
         user sees the error over a state that is still consistent. */
      if (work) await work();
      onProfileChange?.(await saveProfile({ custom_patterns: list }));
      setAdding(""); setEditing(null);
    } catch (e) {
      setErr(e.message || "Could not save that.");
    }
    setBusy(false);
  };

  const add = () => {
    const name = adding.trim();
    const problem = checkPatternName(name, mine);
    if (problem) { setErr(problem); return; }
    write([...mine, name]);
  };

  const rename = () => {
    const { from, to } = editing || {};
    const name = String(to || "").trim();
    if (name === from) { setEditing(null); return; }
    /* Compared against the OTHER two, or renaming a name to a different case
       of itself reports it as a duplicate of itself. */
    const problem = checkPatternName(name, mine.filter((p) => p !== from));
    if (problem) { setErr(problem); return; }
    write(mine.map((p) => (p === from ? name : p)), () => renamePattern(from, name));
  };

  const remove = (name) => {
    const n = used[name] || 0;
    if (n > 0) {
      setErr(`${n} trade${n === 1 ? "" : "s"} still use “${name}”. Rename it, or change those trades first.`);
      return;
    }
    write(mine.filter((p) => p !== name));
  };

  return (
    <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 18 }}>
      <div className="eyebrow" style={{ marginBottom: 4 }}>Your own setups</div>
      <div className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
        Up to {MAX_CUSTOM_PATTERNS}, added to the base pattern list on every trade.
        Three is the limit on purpose: past that, the breakdowns on Analysis split
        into slices too small to tell you anything.
      </div>

      {mine.length > 0 && (
        <ul className="os-list">
          {mine.map((p) => (
            <li key={p}>
              {editing?.from === p ? (
                <>
                  <input className="in os-in" autoFocus maxLength={PATTERN_MAX_LEN}
                         value={editing.to}
                         onChange={(e) => setEditing({ from: p, to: e.target.value })}
                         onKeyDown={(e) => { if (e.key === "Enter") rename(); }} />
                  <button className="btn sm" onClick={rename} disabled={busy}>
                    <Check size={12} />{busy ? "Saving…" : "Rename"}
                  </button>
                  <button className="btn ghost sm" onClick={() => { setEditing(null); setErr(""); }}>
                    <X size={12} />
                  </button>
                </>
              ) : (
                <>
                  <b>{p}</b>
                  <i>{used[p] ? `${used[p]} trade${used[p] === 1 ? "" : "s"}` : "not used yet"}</i>
                  <button className="btn ghost sm" onClick={() => { setEditing({ from: p, to: p }); setErr(""); }}>
                    <Pencil size={12} />Rename
                  </button>
                  <button className="btn ghost sm" onClick={() => remove(p)} disabled={busy}>
                    <Trash2 size={12} />Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {mine.length < MAX_CUSTOM_PATTERNS && !editing && (
        <div className="os-add">
          <input className="in os-in" maxLength={PATTERN_MAX_LEN}
                 placeholder="Support Entry" value={adding}
                 onChange={(e) => { setAdding(e.target.value); setErr(""); }}
                 onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <button className="btn ghost sm" onClick={add} disabled={busy || !adding.trim()}>
            <Plus size={12} />{busy ? "Saving…" : "Add setup"}
          </button>
        </div>
      )}

      {/* A rename moves the history with it, which is the part nobody expects
          a settings screen to do. Said before it is done, not after. */}
      <div className="hint" style={{ marginTop: 10 }}>
        Renaming one moves every trade using it to the new name, so a setup never
        ends up split in two. A setup still in use cannot be removed.
      </div>
      {err && <div className="warn" style={{ marginTop: 10 }}>{err}</div>}

      <style jsx>{`
        .os-list { list-style: none; margin: 0 0 12px; padding: 0;
                   display: flex; flex-direction: column; gap: 8px; }
        .os-list li { display: flex; align-items: center; gap: 10px;
                      border: 1px solid var(--rule); border-radius: 3px; padding: 8px 10px; }
        .os-list b { font-size: 13px; font-weight: 600; }
        .os-list i { flex: 1; font-style: normal; font-size: 11.5px; color: var(--ink3); }
        .os-add { display: flex; gap: 8px; align-items: center; }
        .os-in { flex: 0 1 220px; font-size: 13px; }
      `}</style>
    </div>
  );
}
