"use client";

import { useEffect, useState } from "react";
import { X, Trash2, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A saved chart, full screen.
 *
 * Extracted rather than copied. The trade panel had this and the diary wanted
 * it, and the two would have drifted the moment either gained a feature — the
 * paging, the actual-size toggle, the escape handling and the remove
 * confirmation are all things you fix once or twice depending on this choice.
 *
 * `shots` is [{ id, src, title, sub }]. The caller decides what a chart is
 * called, because the answer differs by where you opened it from: on a trade
 * it is the symbol, in the diary it is the entry — and an entry that happens
 * to hang off a trade should say so, since "which trade was this?" is exactly
 * what you cannot tell from a picture of a chart.
 *
 * NOT CIRCULAR. Paging stops at both ends and the arrow greys out. Wrapping
 * reads as broken on a set of three: click past the last and you are back at
 * the first with nothing to tell you it happened, which feels like the button
 * misfired rather than like a deliberate loop.
 */
export default function ChartViewer({ shots = [], index = 0, onIndex, onClose, onRemove }) {
  const [actual, setActual] = useState(false);
  const [removing, setRemoving] = useState(false);

  const at = Math.min(Math.max(index, 0), shots.length - 1);
  const shot = shots[at];

  useEffect(() => { setActual(false); }, [at, shot?.id]);

  // Nothing left to show — the last chart was removed while it was open.
  useEffect(() => { if (!shots.length) onClose?.(); }, [shots.length, onClose]);

  const canPrev = at > 0;
  const canNext = at < shots.length - 1;
  const step = (d) => {
    const to = at + d;
    if (to >= 0 && to < shots.length) onIndex?.(to);
  };

  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose?.(); }
      // Left and right page the charts. Up and down are deliberately not
      // handled: on the trade panel they step the position underneath, and
      // nobody looking at a chart means "next trade".
      else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [at, shots.length, onClose]);

  if (!shot) return null;

  const remove = async () => {
    if (!onRemove || removing) return;
    setRemoving(true);
    try { await onRemove(shot); } finally { setRemoving(false); }
  };

  return (
    <div className="cv" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="cv-bar">
        <span className="cv-title">
          {shot.title}
          {shot.sub && <i className="cv-sub">{shot.sub}</i>}
          {shots.length > 1 && <i className="cv-count">{at + 1} of {shots.length}</i>}
        </span>
        <span className="cv-spacer" />
        {onRemove && (
          <button className="cv-btn is-danger" disabled={removing} onClick={remove}>
            <Trash2 size={14} />{removing ? "Removing…" : "Remove"}
          </button>
        )}
        <button className="cv-btn" onClick={() => setActual((a) => !a)}>
          {actual ? "Fit to screen" : "Actual size"}
        </button>
        <button className="cv-btn" onClick={onClose} aria-label="Close chart">
          <X size={15} />
        </button>
      </div>

      <div className={`cv-scroll${actual ? " is-actual" : ""}`}
           onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
        <img src={shot.src} alt={shot.title} onClick={() => setActual((a) => !a)} />
      </div>

      {/* Full-height zones rather than small buttons: the arrow is a hint, the
          whole edge is the target. They light on hover, and an end that cannot
          be paged past says so by dimming instead of quietly doing nothing.
          Outside the scroller, so they hold still while an actual-size chart
          is panned underneath. */}
      {shots.length > 1 && (
        <>
          <button className="cv-nav is-prev" onClick={() => step(-1)}
                  disabled={!canPrev} aria-label="Previous chart">
            <ChevronLeft size={26} />
          </button>
          <button className="cv-nav is-next" onClick={() => step(1)}
                  disabled={!canNext} aria-label="Next chart">
            <ChevronRight size={26} />
          </button>
        </>
      )}

      <div className="cv-hint">
        Click the chart to {actual ? "fit it to the screen" : "see it at full resolution"}
        {shots.length > 1 && " · ← → for the others"} · Esc to close
      </div>

      <style jsx global>{`
        .cv {
          position: fixed; inset: 0; z-index: 200;
          background: rgba(10, 14, 13, 0.92);
          display: flex; flex-direction: column;
        }
        .cv-bar { display: flex; align-items: center; gap: 8px; padding: 10px 14px; flex: 0 0 auto; }
        .cv-spacer { flex: 1; }
        .cv-title {
          color: #EDF0EE; font-size: 12.5px; display: inline-flex;
          align-items: baseline; gap: 9px; padding-left: 4px; min-width: 0;
        }
        .cv-sub, .cv-count {
          font-style: normal; color: rgba(237,240,238,0.55); font-size: 11px; white-space: nowrap;
        }
        .cv-btn {
          background: rgba(255,255,255,0.10); border: 1px solid rgba(255,255,255,0.18);
          color: #EDF0EE; border-radius: 3px; padding: 5px 10px; cursor: pointer;
          font: inherit; font-size: 12px; display: inline-flex; align-items: center; gap: 5px;
          white-space: nowrap;
        }
        .cv-btn:hover { background: rgba(255,255,255,0.18); }
        .cv-btn:disabled { opacity: 0.5; cursor: default; }
        .cv-btn.is-danger { color: #F0B0A4; border-color: rgba(240,176,164,0.35); }
        .cv-btn.is-danger:hover:not(:disabled) { background: rgba(240,176,164,0.16); }

        .cv-scroll {
          flex: 1 1 auto; min-height: 0; overflow: auto;
          display: flex; align-items: center; justify-content: center; padding: 0 14px;
        }
        .cv-scroll img {
          max-width: 100%; max-height: 100%; width: auto; height: auto;
          display: block; cursor: zoom-in; border-radius: 2px;
          min-width: 0; min-height: 0;
        }
        .cv-scroll.is-actual { display: block; }
        .cv-scroll.is-actual img { max-width: none; max-height: none; margin: 0 auto; cursor: zoom-out; }

        .cv-nav {
          position: absolute; top: 54px; bottom: 44px; width: 86px;
          background: none; border: 0; cursor: pointer; padding: 0;
          color: rgba(237,240,238,0.30);
          display: flex; align-items: center;
          transition: color 0.12s ease, background 0.12s ease;
        }
        .cv-nav.is-prev { left: 0; justify-content: flex-start; padding-left: 10px; }
        .cv-nav.is-next { right: 0; justify-content: flex-end; padding-right: 10px; }
        .cv-nav:not(:disabled):hover { color: #FFFFFF; }
        .cv-nav.is-prev:not(:disabled):hover {
          background: linear-gradient(to right, rgba(0,0,0,0.55), transparent);
        }
        .cv-nav.is-next:not(:disabled):hover {
          background: linear-gradient(to left, rgba(0,0,0,0.55), transparent);
        }
        /* Dimmed and inert at the ends. Wrapping would hide that you had run
           out; this shows it. */
        .cv-nav:disabled { color: rgba(237,240,238,0.10); cursor: default; }

        .cv-hint {
          flex: 0 0 auto; text-align: center; padding: 9px 14px 13px;
          font-size: 11.5px; color: rgba(237,240,238,0.55);
        }
      `}</style>
    </div>
  );
}
