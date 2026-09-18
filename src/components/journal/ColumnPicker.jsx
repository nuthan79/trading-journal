"use client";

import { useEffect, useRef, useState } from "react";
import { Columns3 } from "lucide-react";
import { COLUMN_HINTS } from "@/lib/columns";

/**
 * Choose which columns a table shows.
 *
 * A checklist in a dropdown, with Show all and Reset at the foot — the shape
 * traders already know from the charting tools they use. The symbol is not in
 * the list: a row with no name is not a row anybody can read.
 *
 * Each entry carries the column's own hover text, so the list doubles as the
 * key to what the columns mean.
 */
export default function ColumnPicker({ columns, prefs, resetLabel = "Reset" }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  /* Closes on a click anywhere else and on Escape, the two ways people expect
     a dropdown to go away. Mousedown rather than click, so the press that
     opens a different control does not have to finish first. */
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const shown = columns.filter((c) => prefs.show(c.k)).length;

  return (
    <div className="cp" ref={box}>
      <button type="button" className="btn ghost sm" aria-expanded={open}
              title={`${shown} of ${columns.length} columns shown`}
              onClick={() => setOpen((o) => !o)}>
        <Columns3 size={13} />Columns
      </button>

      {open && (
        <div className="cp-menu" role="menu">
          <div className="cp-list">
            {columns.map((c) => (
              <label key={c.k} className="cp-item" title={c.hint ?? COLUMN_HINTS[c.k]}>
                <input type="checkbox" checked={prefs.show(c.k)}
                       onChange={() => prefs.toggle(c.k)} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
          <div className="cp-foot">
            <button type="button" className="btn ghost sm" onClick={prefs.showAll}>Show all</button>
            <button type="button" className="btn ghost sm" onClick={prefs.reset}
                    disabled={prefs.isDefault}>{resetLabel}</button>
          </div>
        </div>
      )}

      <style jsx>{`
        .cp { position: relative; display: inline-block; }
        .cp-menu {
          position: absolute; right: 0; top: calc(100% + 6px); z-index: 30;
          width: 250px; background: var(--card); border: 1px solid var(--rule);
          border-radius: 3px; box-shadow: 0 8px 24px rgba(19, 28, 26, 0.12);
        }
        /* Scrolls inside itself, so a long list never pushes the page. */
        .cp-list { max-height: 340px; overflow-y: auto; padding: 6px 0; }
        .cp-item {
          display: flex; align-items: center; gap: 10px; padding: 7px 14px;
          font-size: 13px; color: var(--ink); cursor: pointer; user-select: none;
        }
        .cp-item:hover { background: var(--paper); }
        .cp-item input { width: 15px; height: 15px; margin: 0; accent-color: var(--ink);
                         cursor: pointer; flex: none; }
        .cp-foot {
          display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--rule);
          background: var(--paper);
        }
        .cp-foot :global(.btn) { flex: 1; justify-content: center; }
      `}</style>
    </div>
  );
}
