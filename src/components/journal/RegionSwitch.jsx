"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { REGIONS } from "@/lib/regions";

/**
 * Which market you are looking at.
 *
 * A REGION IS A SEPARATE BOOK, and this is the one control that says so. The
 * whole journal switches: the positions, the capital, the totals, the
 * currency. Nothing is merged and nothing is hidden — the trades of the other
 * book are exactly where they were, under its own name.
 *
 * SO THE LABEL IS THE CURRENCY, not a flag. "₹ India" tells you in one glance
 * which book's figures you are reading, which is the question somebody
 * actually has when a screen full of numbers looks unfamiliar. Flags are
 * decoration here and, for a market, occasionally a political statement.
 *
 * The choice is remembered on the profile, so the market you were last
 * reading is the one that opens on your phone.
 */
export default function RegionSwitch({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);

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

  const current = REGIONS.find((r) => r.id === value) || REGIONS[0];

  return (
    <div className="rs" ref={box}>
      <button className="rs-btn" onClick={() => setOpen((o) => !o)}
              aria-haspopup="listbox" aria-expanded={open}
              title="Which market you are looking at. Each one is its own book.">
        <b>{current.sign}</b>
        <span>{current.label}</span>
        <ChevronDown size={13} />
      </button>

      {open && (
        <div className="rs-menu" role="listbox">
          {REGIONS.map((r) => (
            <button key={r.id} role="option" aria-selected={r.id === value}
                    onClick={() => { setOpen(false); onChange?.(r.id); }}>
              <b>{r.sign}</b>
              <span>{r.label}</span>
              {r.id === value && <Check size={13} />}
            </button>
          ))}
          {/* Said once, here, because the first switch is the moment somebody
              wonders where their trades went. */}
          <p>Each market is its own book — its own capital, positions and
             totals. Nothing is mixed between them.</p>
        </div>
      )}

      <style jsx>{`
        .rs { position: relative; }
        .rs-btn {
          display: inline-flex; align-items: center; gap: 7px;
          background: var(--card); border: 1px solid var(--rule); border-radius: 3px;
          padding: 7px 10px; font-size: 12px; color: var(--ink2); cursor: pointer;
        }
        .rs-btn:hover { border-color: var(--brass); color: var(--ink); }
        .rs-btn b { font-size: 13px; color: var(--brass); font-weight: 600; }
        .rs-menu {
          position: absolute; right: 0; top: calc(100% + 6px); z-index: 60;
          min-width: 230px; background: var(--card); border: 1px solid var(--rule);
          border-radius: 3px; box-shadow: 0 10px 30px rgba(0,0,0,.09); padding: 4px;
        }
        .rs-menu button {
          display: flex; align-items: center; gap: 9px; width: 100%;
          background: none; border: 0; padding: 8px 10px; font-size: 13px;
          color: var(--ink); cursor: pointer; text-align: left; border-radius: 2px;
        }
        .rs-menu button:hover { background: var(--bg); }
        .rs-menu button b { color: var(--brass); width: 12px; }
        .rs-menu button span { flex: 1; }
        .rs-menu p {
          margin: 4px 6px 6px; padding-top: 8px; border-top: 1px solid var(--rule);
          font-size: 11px; line-height: 1.5; color: var(--ink3);
        }
      `}</style>
    </div>
  );
}
