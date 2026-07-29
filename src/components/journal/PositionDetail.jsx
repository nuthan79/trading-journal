"use client";

import { useEffect } from "react";
import { Pencil, Trash2, X, ChevronUp, ChevronDown } from "lucide-react";
import { rupee, rfmt, pct, signedPct } from "@/lib/format";

/**
 * One position, opened up.
 *
 * The table gives a row per position; this gives the story of a single one —
 * what was paid, what came back out and when, and where price stood against
 * the risk taken each time a piece was sold.
 *
 * Read-only. Editing goes through the trade form, which already owns the rules
 * about what a position may become; a second editable surface would be a
 * second chance to get those wrong.
 */

const day = (d) => {
  const x = new Date(d);
  return isFinite(x)
    ? x.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";
};

const daysBetween = (a, b) => {
  const [x, y] = [new Date(a), new Date(b)];
  return isFinite(x) && isFinite(y) ? Math.round((y - x) / 86400000) : NaN;
};

export default function PositionDetail({ row, onClose, onEdit, onDelete, onPrev, onNext }) {
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowUp" && onPrev) { e.preventDefault(); onPrev(); }
      else if (e.key === "ArrowDown" && onNext) { e.preventDefault(); onNext(); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose, onPrev, onNext]);

  if (!row) return null;

  const dir = row.side === "short" ? -1 : 1;
  const entry = Number(row.entry_price);
  const qty = Number(row.quantity);
  const perShare = row.riskPerShare;
  const exits = row.exits || [];

  // derivePosition returns `charges` as entry-side plus every sell, and that
  // total shadows the trade row's own figure once the two are spread together.
  // Backing the sells out again is the only way to show the entry leg's share.
  const exitCharges = exits.reduce((a, e) => a + (Number(e.charges) || 0), 0);
  const entryCharges = Math.max(0, (Number(row.charges) || 0) - exitCharges);

  // Where price stood against the risk taken. Deliberately not weighted by
  // size: "I sold that piece at 3.9R" is a fact about price, and stays true
  // whether the piece was a third of the position or all of it.
  const atR = (price) => (perShare > 0 ? ((price - entry) * dir) / perShare : NaN);
  const gainPct = (price) => (entry > 0 ? ((price - entry) / entry) * 100 * dir : NaN);

  const stat = (label, value, sub) => (
    <div className="pd-stat">
      <div className="pd-stat-l">{label}</div>
      <div className="pd-stat-v mono">
        {value}
        {sub != null && <i>{sub}</i>}
      </div>
    </div>
  );

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet pd" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheethead">
          <div className="pd-acts">
            <button className="btn ghost sm" onClick={() => onEdit(row)}>
              <Pencil size={13} />Edit
            </button>
            <button className="btn ghost sm danger" onClick={() => onDelete(row)}>
              <Trash2 size={13} />Delete
            </button>
          </div>
          <div className="pd-nav">
            <button className="x" onClick={onPrev} disabled={!onPrev} aria-label="Previous position">
              <ChevronUp size={17} />
            </button>
            <button className="x" onClick={onNext} disabled={!onNext} aria-label="Next position">
              <ChevronDown size={17} />
            </button>
            <button className="x" onClick={onClose} aria-label="Close"><X size={19} /></button>
          </div>
        </div>

        <div className="pd-body">
          {/* Who, how long, and what it has come to */}
          <div className="pd-card">
            <div className="pd-name">
              <b className="disp">{row.symbol}</b>
              <span>{[row.company, row.exchange].filter(Boolean).join(" · ")}</span>
            </div>
            <div className="pd-when mono">
              {day(row.entry_date)}
              {isFinite(row.heldDays) && ` · ${row.heldDays} days`}
              {` · ${isFinite(row.pctClosed) ? row.pctClosed.toFixed(1) : "0"}% sold`}
            </div>
            <div className={`pd-big mono ${row.pnl >= 0 ? "pos" : "neg"}`}>
              {isFinite(row.pnl) ? rupee(row.pnl) : "—"}
              <i>
                {isFinite(row.exposure) && row.exposure > 0 && isFinite(row.pnl)
                  ? ` (${signedPct((row.pnl / row.exposure) * 100)})`
                  : ""}
                {isFinite(row.r) ? ` (${rfmt(row.r)})` : ""}
              </i>
            </div>
            <div className="pd-split mono">
              banked {isFinite(row.realisedPnl) && row.qtyExited > 0 ? rupee(row.realisedPnl) : "—"}
              {row.qtyOpen > 0 && (
                <> · still running {isFinite(row.unrealisedPnl) ? rupee(row.unrealisedPnl) : "no mark"}</>
              )}
            </div>
          </div>

          {/* The numbers the position was built on */}
          <div className="pd-grid">
            {stat("Avg entry", entry.toFixed(2), ` × ${qty}`)}
            {stat("Avg exit",
              isFinite(row.avgExitPrice) ? row.avgExitPrice.toFixed(2) : "—",
              isFinite(row.avgExitPrice) ? ` (${signedPct(gainPct(row.avgExitPrice))})` : null)}
            {stat("Mark",
              isFinite(row.mark) ? Number(row.mark).toFixed(2) : "—",
              isFinite(row.mark) ? ` (${signedPct(gainPct(row.mark))})` : null)}
            {stat("Stop now",
              isFinite(row.currentStop) ? row.currentStop.toFixed(2) : "—",
              isFinite(row.slPctCurrent) ? ` (${pct(Math.abs(row.slPctCurrent))} away)` : null)}
            {stat("Stop at entry",
              isFinite(row.initialStop) ? row.initialStop.toFixed(2) : "—",
              isFinite(row.slPct) ? ` (${pct(row.slPct)})` : null)}
            {stat("1R — risk taken",
              isFinite(row.riskAmt) ? rupee(row.riskAmt) : "—",
              isFinite(row.riskPct) ? `${pct(row.riskPct, 2)} of account` : null)}
            {stat("Position size", isFinite(row.exposure) ? rupee(row.exposure) : "—")}
            {stat("Open risk",
              row.isRiskFree || !(row.openRiskAmt > 0) ? "nil" : rupee(-Math.abs(row.openRiskAmt)),
              row.isRiskFree || !(row.openRiskAmt > 0) ? "nothing left to lose" : null)}
          </div>

          {/* Every leg, in order */}
          <div className="card scroll pd-table">
            <table className="t">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Price</th>
                  <th className="num">Qty</th>
                  <th className="num">Charges</th>
                  <th className="num">P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <span className="mono">{day(row.entry_date)}</span>
                    <span className="pd-leg" data-kind="in">bought</span>
                  </td>
                  <td className="num">{entry.toFixed(2)}</td>
                  <td className="num">{qty}</td>
                  <td className="num pd-dim">{rupee(entryCharges)}</td>
                  <td className="num pd-dim">—</td>
                </tr>

                {exits.map((e, i) => {
                  const held = daysBetween(row.entry_date, e.exit_date);
                  const gross = (Number(e.price) - entry) * Number(e.quantity) * dir;
                  const net = gross - (Number(e.charges) || 0);
                  return (
                    <tr key={i}>
                      <td>
                        <span className="mono">{day(e.exit_date)}</span>
                        <span className="pd-leg" data-kind="out">sold</span>
                        {isFinite(held) && <i className="pd-dim"> {held}d in</i>}
                      </td>
                      <td className="num">
                        {Number(e.price).toFixed(2)}
                        <i className="pd-dim"> {signedPct(gainPct(Number(e.price)))}</i>
                      </td>
                      <td className="num">
                        −{e.quantity}
                        <i className="pd-dim"> {qty > 0 ? pct((e.quantity / qty) * 100, 0) : ""}</i>
                      </td>
                      <td className="num pd-dim">{rupee(Number(e.charges) || 0)}</td>
                      <td className={`num ${net >= 0 ? "pos" : "neg"}`}>
                        {rupee(net)}
                        <i className="pd-dim"> at {rfmt(atR(Number(e.price)))}</i>
                      </td>
                    </tr>
                  );
                })}

                {row.qtyOpen > 0 && (
                  <tr className="pd-openrow">
                    <td>
                      <span className="mono">today</span>
                      <span className="pd-leg" data-kind="hold">still held</span>
                    </td>
                    <td className="num">
                      {isFinite(row.mark) ? Number(row.mark).toFixed(2) : "—"}
                    </td>
                    <td className="num">
                      {row.qtyOpen}
                      <i className="pd-dim"> {qty > 0 ? pct((row.qtyOpen / qty) * 100, 0) : ""}</i>
                    </td>
                    <td className="num pd-dim">—</td>
                    <td className={`num ${row.unrealisedPnl >= 0 ? "pos" : "neg"}`}>
                      {isFinite(row.unrealisedPnl) ? rupee(row.unrealisedPnl) : "—"}
                      {isFinite(row.mark) && (
                        <i className="pd-dim"> at {rfmt(atR(Number(row.mark)))}</i>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td>Position</td>
                  <td className="num pd-dim">—</td>
                  <td className="num">{qty}</td>
                  <td className="num">{isFinite(row.charges) ? rupee(row.charges) : "—"}</td>
                  <td className={`num ${row.pnl >= 0 ? "pos" : "neg"}`}>
                    {isFinite(row.pnl) ? rupee(row.pnl) : "—"}
                    {isFinite(row.r) && <i className="pd-dim"> {rfmt(row.r)}</i>}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {row.thesis && (
            <div className="pd-thesis">
              <div className="pd-stat-l">Why this trade</div>
              <p>{row.thesis}</p>
            </div>
          )}

          <div className="pd-foot">
            The R beside each sell is where price stood against your 1R at that moment, not that
            leg&apos;s share of the result — sizes differ, so those don&apos;t add up to the
            position&apos;s figure at the bottom. P&amp;L is after charges throughout.
          </div>
        </div>

        <style jsx>{`
          .pd { max-width: 720px; }
          .pd-acts { display: flex; gap: 8px; }
          .pd-nav { display: flex; gap: 2px; align-items: center; }
          .pd-nav .x:disabled { opacity: 0.25; cursor: default; }
          .pd-body { padding: 18px 20px 20px; display: flex; flex-direction: column; gap: 14px; }

          .pd-card {
            border: 1px solid var(--rule); border-radius: 3px;
            background: var(--card); padding: 14px 16px;
          }
          .pd-name { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; }
          .pd-name b { font-size: 18px; }
          .pd-name span { font-size: 12px; color: var(--ink3); }
          .pd-when { font-size: 11.5px; color: var(--ink3); margin-top: 3px; }
          .pd-big {
            font-size: 26px; font-weight: 600; margin-top: 10px;
            font-variant-numeric: tabular-nums;
          }
          .pd-big i { font-style: normal; font-size: 14px; font-weight: 500; }
          .pd-split { font-size: 11.5px; color: var(--ink2); margin-top: 5px; }

          .pd-grid {
            display: grid; grid-template-columns: repeat(4, 1fr);
            border: 1px solid var(--rule); border-radius: 3px;
            background: var(--card); overflow: hidden;
          }
          @media (max-width: 640px) { .pd-grid { grid-template-columns: repeat(2, 1fr); } }

          .pd-table { max-height: none; }
          .pd-leg {
            font-size: 8.5px; font-weight: 700; letter-spacing: 0.08em;
            text-transform: uppercase; margin-left: 7px;
            padding: 1px 4px; border-radius: 2px; border: 1px solid currentColor;
          }
          .pd-leg[data-kind="in"] { color: var(--ink3); }
          .pd-leg[data-kind="out"] { color: var(--long); }
          .pd-leg[data-kind="hold"] { color: var(--brass); }
          .pd-openrow { background: #FAFBFA; }

          .pd-thesis {
            border-left: 2px solid var(--brass); background: #F5F8F6;
            padding: 10px 13px; border-radius: 2px;
          }
          .pd-thesis p { font-size: 12.5px; margin: 4px 0 0; line-height: 1.55; }
          .pd-foot {
            font-size: 11px; color: var(--ink3); line-height: 1.6; text-wrap: pretty;
          }
        `}</style>

        {/* Global: these sit inside markup this component builds through the
            `stat` helper and inside table cells, and scoped styled-jsx does
            not reach past the element it is attached to reliably here. */}
        <style jsx global>{`
          .pd-stat { padding: 11px 13px; border-right: 1px solid var(--rule); min-width: 0; }
          .pd-stat:last-child { border-right: 0; }
          .pd-stat-l {
            font-size: 9px; font-weight: 600; letter-spacing: 0.1em;
            text-transform: uppercase; color: var(--ink3);
          }
          .pd-stat-v {
            font-size: 15px; margin-top: 4px; font-variant-numeric: tabular-nums;
          }
          /* On its own line: these read "0.90% of account" and "stop is at or
             past entry", which an ellipsis cuts to nothing useful. */
          .pd-stat-v i {
            display: block; font-style: normal; font-size: 10.5px;
            color: var(--ink3); margin-top: 2px; line-height: 1.4;
          }
          .pd-dim { color: var(--ink3); font-size: 10.5px; font-style: normal; }
          .pd-table tfoot td {
            border-top: 1px solid var(--ink3); font-weight: 600; font-size: 12px;
          }
        `}</style>
      </div>
    </div>
  );
}
