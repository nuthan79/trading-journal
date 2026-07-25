"use client";

import { useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { markOpenPositions } from "@/lib/db";
import { rupee, rfmt, pct, signedPct } from "@/lib/format";

/**
 * Open positions with live marks.
 *
 * The columns that matter while a trade is live are not the same as the ones
 * that matter afterwards. Open R tells you what you'd bank by closing now;
 * "to stop" tells you what's left to lose. Both are more useful in the moment
 * than a P&L figure on its own.
 */

export default function OpenPositions({ open, onMarked, showRefresh = true }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [at, setAt] = useState(null);

  const refresh = useCallback(async () => {
    setBusy(true); setMsg("");
    const { marked, error } = await markOpenPositions(open);
    if (marked.length) {
      onMarked?.(marked);
      setAt(new Date());
      setMsg("");
    } else {
      setMsg(error || "No prices available");
    }
    setBusy(false);
  }, [open, onMarked]);

  if (!open.length) {
    return (
      <section>
        <div className="eyebrow" style={{ marginBottom: 9 }}>Open positions</div>
        <div className="op-empty">Nothing open. Flat is a position.</div>
        <style jsx>{`
          .op-empty {
            border: 1px solid var(--rule); background: var(--card); border-radius: 3px;
            padding: 26px 20px; text-align: center; font-size: 13px; color: var(--ink3);
          }
        `}</style>
      </section>
    );
  }

  const totalRisk = open.reduce((a, t) => a + (isFinite(t.riskAmt) ? t.riskAmt : 0), 0);
  const totalOpen = open.reduce((a, t) => a + (isFinite(t.pnl) ? t.pnl : 0), 0);
  const anyMarked = open.some((t) => isFinite(t.mark));

  return (
    <section>
      <div className="op-head">
        <div>
          <div className="eyebrow">Open positions</div>
          <div className="op-sub">
            {open.length} live · {rupee(totalRisk)} at risk
            {anyMarked && (
              <> · open <span className={totalOpen >= 0 ? "pos" : "neg"}>{rupee(totalOpen)}</span></>
            )}
          </div>
        </div>
        {showRefresh && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {at && <span className="op-dim">
              marked {at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </span>}
            <button className="btn ghost sm" onClick={refresh} disabled={busy}>
              <RefreshCw size={12} style={busy ? { animation: "spin 1s linear infinite" } : undefined} />
              {busy ? "Fetching" : "Refresh prices"}
            </button>
          </div>
        )}
      </div>

      {msg && <div className="op-warn">{msg}</div>}

      <div className="card scroll">
        <table className="t">
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="num">Entry</th>
              <th className="num">Last</th>
              <th className="num">Change</th>
              <th className="num">Stop</th>
              <th className="num">SL %</th>
              <th className="num">To stop</th>
              <th className="num">Qty</th>
              <th className="num">Value</th>
              <th className="num">Risk</th>
              <th className="num">Open P&amp;L</th>
              <th className="num">Open R</th>
              <th className="num">Held</th>
            </tr>
          </thead>
          <tbody>
            {open.map((t) => {
              const entry = Number(t.entry_price);
              const stop = Number(t.stop_loss);
              const mark = t.mark;
              const live = isFinite(mark);
              const fromEntry = live ? ((mark - entry) / entry) * 100 : NaN;
              const toStop = live ? ((mark - stop) / mark) * 100 : NaN;
              const breached = live && (t.side === "short" ? mark >= stop : mark <= stop);

              return (
                <tr key={t.id} data-alert={breached ? 1 : 0}>
                  <td>
                    <b className="disp">{t.symbol}</b>
                    <span className="op-dim"> {t.exchange}</span>
                    {t.side === "short" && <span className="neg" style={{ fontSize: 10 }}> ▾</span>}
                  </td>
                  <td className="num">{entry.toFixed(2)}</td>
                  <td className="num" style={{ fontWeight: live ? 500 : 400 }}>
                    {live ? mark.toFixed(2) : <span className="op-dim">—</span>}
                  </td>
                  <td className={`num ${fromEntry >= 0 ? "pos" : "neg"}`}>
                    {live ? signedPct(fromEntry) : "—"}
                  </td>
                  <td className="num neg">{stop.toFixed(2)}</td>
                  <td className="num op-dim">{isFinite(t.slPct) ? pct(t.slPct, 1) : "—"}</td>
                  <td className="num"
                      style={{ color: breached ? "var(--short)" : t.stopAboveEntry ? "var(--brass)" : undefined,
                               fontWeight: breached || t.stopAboveEntry ? 600 : 400 }}
                      title={t.stopAboveEntry ? "Stop is above entry — this position can no longer lose" : undefined}>
                    {live
                      ? breached ? "breached"
                        : t.stopAboveEntry ? `locked ${pct(Math.abs(toStop))}`
                        : pct(Math.abs(toStop))
                      : "—"}
                  </td>
                  <td className="num">{t.quantity}</td>
                  <td className="num">{rupee(t.exposure)}</td>
                  <td className="num" title={`${pct(t.riskPct, 2)} of capital`}>
                    {rupee(t.riskAmt)}
                  </td>
                  <td className={`num ${isFinite(t.pnl) ? (t.pnl >= 0 ? "pos" : "neg") : ""}`}>
                    {isFinite(t.pnl) ? rupee(t.pnl) : "—"}
                  </td>
                  <td className={`num ${isFinite(t.r) ? (t.r >= 0 ? "pos" : "neg") : ""}`}
                      style={{ fontWeight: 500 }}>
                    {isFinite(t.r) ? rfmt(t.r) : "—"}
                  </td>
                  <td className="num op-dim">{isFinite(t.heldDays) ? `${t.heldDays}d` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!anyMarked && (
        <div className="op-dim" style={{ marginTop: 8, fontSize: 11.5 }}>
          No marks yet — hit refresh. Outside market hours you'll get the last close.
        </div>
      )}

      <style jsx>{`
        .op-head {
          display: flex; align-items: flex-end; justify-content: space-between;
          gap: 14px; flex-wrap: wrap; margin-bottom: 10px;
        }
        .op-sub { font-size: 12px; color: var(--ink2); margin-top: 3px; }
        .op-dim { color: var(--ink3); font-size: 11px; }
        .op-warn {
          border: 1px solid var(--brass); background: #FBF6EA; color: #6B4E12;
          padding: 8px 11px; border-radius: 2px; font-size: 12px; margin-bottom: 10px;
        }
        tr[data-alert="1"] { background: #FDF3F0; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </section>
  );
}
