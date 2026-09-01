"use client";

/**
 * The trades you are looking at, as pictures.
 *
 * FED BY THE FILTERS, which was the user's second requirement: "i need to see
 * those charts whos filters are above 5 R not the charts of 4R". It renders
 * `rows` — whatever the tabs, the saved view and the search have already
 * narrowed to — so the wall and the table always show the same set, and a
 * saved view becomes a wall of exactly those trades.
 *
 * PAGED, because the charts are the expensive part. Twenty-four is what the
 * reference does and it is about right for one screen of scrolling; more than
 * that and the fetch, not the rendering, becomes the wait.
 *
 * ONE FETCH PER LISTING, NOT PER CHART. Two trades in the same symbol six
 * months apart share one request for the union of their windows — see
 * windowsFor. Bars already stored come back without touching the network at
 * all, which is most of them: the measure pass stored everything Yahoo
 * returned, not just the trade window.
 */

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { rupee, rfmt, dmy } from "@/lib/format";
import { apiFetch } from "@/lib/db";
import { tickerFor, barsKeyFor } from "@/lib/bars";
import { isPartial } from "@/lib/positions";
import { windowsFor, barsFor, barsKey, hasBars } from "@/lib/candles";
import TradeChart from "./TradeChart";

const PER_PAGE = 24;
/* Matches MAX_SYMBOLS in /api/bars. A mismatch here silently drops the tail of
   every batch — the same bug that made a measure run report success over
   trades it never touched. */
const PER_CALL = 12;

const SIZES = {
  small: { cols: 4, height: 150, compact: true },
  medium: { cols: 3, height: 200, compact: true },
  large: { cols: 2, height: 300, compact: false },
};

export default function ChartWall({ rows = [], onMeasure, measuring = false }) {
  const [size, setSize] = useState("medium");
  const [page, setPage] = useState(0);
  const [bars, setBars] = useState({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  /* A filter change can leave you on page 6 of a 2-page result, staring at an
     empty grid that looks like a failure. */
  useEffect(() => { setPage(0); }, [rows]);
  const shown = rows.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  /**
   * A trade with no ticker can never have a chart, and saying so once is
   * kinder than a spinner that never resolves. A BSE lot whose ISIN never
   * matched keeps its scrip code, and 533022.BO is a different company — see
   * the note in bars.js.
   */
  const drawable = shown.filter((t) => t.symbol && t.entry_date
    && tickerFor(t.symbol, t.exchange));

  useEffect(() => {
    if (!drawable.length) return;
    /* Same key the response is filed under, or this refetches every listing on
       every render while the charts it already has sit there. */
    const want = windowsFor(drawable)
      .filter((w) => !bars[barsKeyFor(w.symbol, w.exchange)]);
    if (!want.length) return;

    let dead = false;
    setLoading(true);
    setErr("");
    (async () => {
      try {
        for (let i = 0; i < want.length; i += PER_CALL) {
          if (dead) return;
          const res = await apiFetch("/api/bars", {
            method: "POST",
            body: JSON.stringify({ want: want.slice(i, i + PER_CALL) }),
          });
          const payload = await res.json().catch(() => null);
          if (!res.ok || !payload) {
            setErr(payload?.error || `The price history service answered ${res.status}.`);
            break;
          }
          if (dead) return;
          /* Merged, not replaced: paging back to a page whose bars are already
             in hand must not refetch them. */
          setBars((b) => ({ ...b, ...payload.bars }));
        }
      } catch (e) {
        if (!dead) setErr(e?.message || "Could not load price history.");
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => { dead = true; };
  }, [drawable.map(barsKey).join(","), page]);   // eslint-disable-line react-hooks/exhaustive-deps

  const cfg = SIZES[size];
  const missing = shown.filter((t) => !hasBars(barsFor(t, bars))).length;

  if (!rows.length) {
    return <div className="cw-empty">No trades in this view to chart.</div>;
  }

  return (
    <div className="cw">
      <div className="cw-bar">
        <div className="cw-count">
          {rows.length} trade{rows.length === 1 ? "" : "s"}
          {pages > 1 && <> · showing {page * PER_PAGE + 1}–{Math.min((page + 1) * PER_PAGE, rows.length)}</>}
          {loading && <span className="cw-load"> · loading price history…</span>}
          {!loading && missing > 0 && (
            <span className="cw-load"> · {missing} not measured yet</span>
          )}
        </div>
        <div className="cw-right">
          {!loading && missing > 0 && onMeasure && (
            <button className="btn ghost sm" onClick={onMeasure} disabled={measuring}>
              <RefreshCw size={12} />{measuring ? "Measuring…" : "Measure these"}
            </button>
          )}
          <div className="seg">
            {Object.keys(SIZES).map((k) => (
              <button key={k} data-on={size === k ? 1 : 0} onClick={() => setSize(k)}>
                {k}
              </button>
            ))}
          </div>
        </div>
      </div>

      {err && <div className="cw-err">{err}</div>}

      <div className="cw-grid" style={{ "--cols": cfg.cols }}>
        {shown.map((t) => {
          const mine = barsFor(t, bars);
          return (
            <div key={t.id} className="cw-card">
              {hasBars(mine)
                ? <TradeChart trade={t} bars={mine} height={cfg.height} compact={cfg.compact} />
                : <div className="cw-blank" style={{ height: cfg.height }}>
                    {!tickerFor(t.symbol, t.exchange)
                      ? "No price history for this listing"
                      : loading ? "…" : "Not measured yet"}
                  </div>}
              <div className="cw-meta">
                <div className="cw-sym">
                  <b>{t.symbol}</b>
                  <span className="cw-ex">{t.exchange}</span>
                  {isPartial(t) && <i className="cw-part">part sold</i>}
                </div>
                <div className="cw-dates mono">
                  {dmy(t.entry_date)}
                  {t.exit_date ? ` → ${dmy(t.exit_date)}` : " · open"}
                  {isFinite(t.heldDays) && ` · ${Math.round(t.heldDays)}d`}
                </div>
                <div className="cw-pnl mono" data-neg={t.pnl < 0 ? 1 : 0}>
                  {isFinite(t.pnl) ? rupee(t.pnl) : "—"}
                  <span className="cw-r">{rfmt(t.r, 1)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {pages > 1 && (
        <div className="cw-pages">
          <button className="btn ghost sm" disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span className="mono">{page + 1} of {pages}</span>
          <button className="btn ghost sm" disabled={page >= pages - 1}
                  onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}

      <style jsx>{`
        .cw-bar { display: flex; align-items: center; justify-content: space-between;
          gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
        .cw-count { font-size: 11.5px; color: var(--ink3); }
        .cw-load { color: var(--brass); }
        .cw-right { display: flex; align-items: center; gap: 8px; }
        .cw-err { font-size: 11.5px; color: var(--short); margin-bottom: 10px; }
        .cw-empty { font-size: 12px; color: var(--ink3); padding: 28px 0; }

        .cw-grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
          gap: 12px; }
        .cw-card { border: 1px solid var(--rule); border-radius: 3px; overflow: hidden;
          background: var(--card); }
        .cw-blank { display: grid; place-items: center; font-size: 11px;
          color: var(--ink3); background: var(--paper); }

        .cw-meta { padding: 8px 10px 9px; border-top: 1px solid var(--rule); }
        .cw-sym { display: flex; align-items: baseline; gap: 6px; }
        .cw-sym b { font-size: 12.5px; color: var(--ink); }
        .cw-ex { font-size: 9px; letter-spacing: 0.08em; color: var(--ink3); }
        .cw-part { font-style: normal; font-size: 9px; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--brass); }
        .cw-dates { font-size: 10.5px; color: var(--ink3); margin-top: 2px; }
        .cw-pnl { font-size: 12.5px; margin-top: 4px; color: var(--long);
          display: flex; justify-content: space-between; font-variant-numeric: tabular-nums; }
        .cw-pnl[data-neg="1"] { color: var(--short); }
        .cw-r { color: var(--ink2); }

        .cw-pages { display: flex; align-items: center; justify-content: center;
          gap: 12px; margin-top: 16px; font-size: 11px; color: var(--ink3); }

        @media (max-width: 900px) { .cw-grid { --cols: 2 !important; } }
        @media (max-width: 560px) { .cw-grid { --cols: 1 !important; } }
      `}</style>
    </div>
  );
}
