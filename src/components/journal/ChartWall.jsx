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

import { useCallback, useEffect, useState } from "react";
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

/**
 * TWO SIZES, NOT THREE. Medium was dropped as useless, and it was: at three
 * across it was still too small for the axis labels and the crosshair readout
 * to be switched on, so it was a small chart taking a large chart's room —
 * worse than either at the job either was for.
 *
 * The two that are left are two different jobs. Small is for SHAPE: four
 * across, no axes, scan a page of them for the ones that look wrong. Large is
 * for READING one: two across, price axis, dates, crosshair with the OHLC.
 */
const SIZES = {
  small: { cols: 4, height: 150, compact: true },
  large: { cols: 2, height: 300, compact: false },
};

export default function ChartWall({ rows = [] }) {
  const [size, setSize] = useState("small");
  const [page, setPage] = useState(0);
  const [bars, setBars] = useState({});
  const [skips, setSkips] = useState({});
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

  /**
   * FETCHING BARS IS NOT "MEASURING".
   *
   * The button here used to run measurePaths — the MFE/MAE pass — which gates
   * on hasRealStop. On a book where most trades carry an assumed stop that
   * pass finds nothing to do and returns silently, so the button looked
   * broken because it was doing a job the wall never needed. A chart wants
   * BARS for its window; the path measurement is a different question with a
   * different home on Review.
   *
   * So the retry is this same read-through fetch, run again with the local
   * cache ignored for the listings still missing. And when the server declines
   * a listing it says why, which is the difference between a blank square and
   * a blank square you can do something about.
   */
  const load = useCallback(async (force = false) => {
    const want = windowsFor(drawable)
      .filter((w) => force || !bars[barsKeyFor(w.symbol, w.exchange)]);
    if (!want.length) return;

    setLoading(true);
    setErr("");
    try {
      for (let i = 0; i < want.length; i += PER_CALL) {
        const res = await apiFetch("/api/bars", {
          method: "POST",
          body: JSON.stringify({ want: want.slice(i, i + PER_CALL) }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload) {
          setErr(payload?.error || `The price history service answered ${res.status}.`);
          break;
        }
        /* Merged, not replaced: paging back to a page whose bars are already
           in hand must not refetch them. */
        setBars((b) => ({ ...b, ...payload.bars }));
        if (payload.skipped?.length) {
          setSkips((sk) => ({
            ...sk,
            ...Object.fromEntries(payload.skipped.map((x) => [x.key, x.why])),
          }));
        }
      }
    } catch (e) {
      setErr(e?.message || "Could not load price history.");
    } finally {
      setLoading(false);
    }
  }, [drawable, bars]);

  /* eslint-disable-next-line react-hooks/exhaustive-deps */
  useEffect(() => { load(false); }, [drawable.map(barsKey).join(","), page]);

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
            <span className="cw-load"> · {missing} without price history</span>
          )}
        </div>
        <div className="cw-right">
          {!loading && missing > 0 && (
            <button className="btn ghost sm" onClick={() => load(true)}>
              <RefreshCw size={12} />Load history
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
                    {/* A reason beats a blank square. "no ticker" is a BSE lot
                        whose ISIN never resolved, still carrying a scrip code;
                        anything else is what the upstream actually said. */}
                    {!tickerFor(t.symbol, t.exchange)
                      ? "No price history for this listing"
                      : loading ? "…"
                      : skips[barsKey(t)] === "no ticker" ? "Symbol not recognised"
                      : skips[barsKey(t)] || "No history yet"}
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
