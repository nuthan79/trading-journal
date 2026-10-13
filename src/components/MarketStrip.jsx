"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/db";

/**
 * The market in one line, under the header on every screen.
 *
 * WHAT IT ANSWERS: is the market with me today? For each of the book's
 * indices — the level, the day's move, and how far it stands from its 20-,
 * 50- and 200-day averages — with a dot for its regime, the same three states
 * the Process tab reviews your trades against.
 *
 * A TICKER, AT THE USER'S CALL. A still row was tried first and argued for —
 * a line that moves on every screen pulls the eye — and the user asked twice
 * for it to scroll. It also had to: four indices with three averages each are
 * wider than the header leaves (1,690px against ~1,100). So it crawls right
 * to left, slowly, and STOPS while the pointer is on it, so a figure can be
 * read and its hover opened. Anyone whose system asks for reduced motion gets
 * the still row back, scrollable by hand.
 *
 * Refreshed every five minutes while the tab is visible — the same window
 * the server caches for, so a refresh never asks Yahoo twice.
 */

const REFRESH_MS = 5 * 60 * 1000;
const SPEED_PX = 40;          // per second — slow enough to read on the move

const REGIME = {
  uptrend: { color: "var(--long)", word: "Uptrend", says: "above its 50-day average, which is above the 200-day" },
  pressure: { color: "var(--brass)", word: "Under pressure", says: "on the wrong side of one of its averages, but not both" },
  correction: { color: "var(--short)", word: "Correction", says: "below its 50-day average, which is below the 200-day" },
};

/* Two decimals throughout, at the user's request — a rounded −1.0% hid a
   −0.97% they could read off their charting platform. */
const pct = (v, dp = 2) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(dp)}%`);
/** An index level the way an exchange quotes it: 22,090.35. */
export const level = (v) => (Number.isFinite(v)
  ? v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const tone = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");

export default function MarketStrip({ book = "IN" }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await apiFetch(`/api/indices?book=${encodeURIComponent(book)}`);
        const json = await res.json();
        if (alive && Array.isArray(json?.items)) setData(json);
      } catch { /* the strip is a courtesy; a failed fetch leaves the last one up */ }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    const onShow = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { alive = false; clearInterval(id); document.removeEventListener("visibilitychange", onShow); };
  }, [book]);

  const items = (data?.items || []).filter((x) => x && !x.error);

  /* Speed by distance, not by time: one copy of the row crosses at a steady
     reading pace however many indices there are. */
  const track = useRef(null);
  const [secs, setSecs] = useState(60);
  useEffect(() => {
    const w = track.current ? track.current.scrollWidth / 2 : 0;
    if (w > 0) setSecs(Math.max(20, w / SPEED_PX));
  }, [items.length, data]);

  if (!items.length) return null;

  const row = (copy) => items.map((x) => {
        const r = REGIME[x.regime];
        return (
          <div key={`${copy}-${x.key}`} className="ms-i"
               title={`${x.name}${r ? ` · ${r.word}: ${r.says}` : ""}. Daily closes from Yahoo; `
                 + `today's level counts as today's close until the market shuts, refreshed every five minutes.`}>
            {r && <span className="ms-dot" style={{ background: r.color }} />}
            <b>{x.name}</b>
            <span className="ms-lvl">{level(x.last)}</span>
            <span className={`ms-day ${tone(x.dayPct)}`}>{pct(x.dayPct)}</span>
            <span className="ms-ma">
              <span className={tone(x.vs20)}>{pct(x.vs20)}</span> 20D
              {" · "}<span className={tone(x.vs50)}>{pct(x.vs50)}</span> 50D
              {" · "}<span className={tone(x.vs200)}>{pct(x.vs200)}</span> 200D
            </span>
          </div>
        );
      });

  return (
    <div className="ms" aria-label="Market indices">
      {/* The row twice, end to end: moving the pair left by exactly one copy
          puts the second where the first began, so the loop has no seam. The
          copy is hidden from screen readers — it is the same figures. */}
      <div className="ms-track" ref={track} style={{ animationDuration: `${secs}s` }}>
        {row(0)}
        <div className="ms-copy" aria-hidden="true">{row(1)}</div>
      </div>

      {/* GLOBAL, prefixed ms-: the items are built by `row`, and styled-jsx
          scoping did not reach them — the first ticker ran the indices into
          one another with no gaps and no dots. See CLAUDE.md on the gotcha. */}
      <style jsx global>{`
        .ms {
          overflow: hidden; padding: 8px 0;
          border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
          background: var(--card);
          /* Fade the ends, so figures arrive and leave rather than being cut. */
          -webkit-mask-image: linear-gradient(90deg, transparent, #000 48px, #000 calc(100% - 48px), transparent);
          mask-image: linear-gradient(90deg, transparent, #000 48px, #000 calc(100% - 48px), transparent);
        }
        .ms-track { display: flex; width: max-content; animation: ms-crawl linear infinite; }
        .ms:hover .ms-track { animation-play-state: paused; }
        .ms-copy { display: flex; }
        @keyframes ms-crawl { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) {
          .ms { overflow-x: auto; -webkit-mask-image: none; mask-image: none; }
          .ms-track { animation: none; }
          .ms-copy { display: none; }
        }
        /* A divider between indices, and room either side of it — the same
           on every item, so the join between the two copies looks like any
           other gap. */
        .ms-i {
          display: flex; align-items: center; gap: 8px; white-space: nowrap;
          font-size: 12px; color: var(--ink2); padding: 0 25px; cursor: help;
          border-right: 1px solid var(--rule); flex: 0 0 auto;
        }
        .ms-dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
        .ms-i b { color: var(--ink); font-weight: 600; }
        .ms-lvl { color: var(--ink); font-variant-numeric: tabular-nums; }
        .ms-day, .ms-ma { font-variant-numeric: tabular-nums; }
        .ms-ma { color: var(--ink3); font-size: 11px; margin-left: 4px; }
        .ms-i .pos { color: var(--long); }
        .ms-i .neg { color: var(--short); }
      `}</style>
    </div>
  );
}
