"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash2, X, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, LogOut, ImagePlus } from "lucide-react";
import { rupee, rfmt, pct, signedPct } from "@/lib/format";
import { chartUrl } from "@/lib/db";
import { resolveTradingViewChart } from "@/lib/charts";

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

export default function PositionDetail({ row, diary = [], onAttachChart, onRemoveChart, onClose, onEdit, onExit, onDelete, onPrev, onNext }) {
  /**
   * The diary entries written against this trade, newest first.
   *
   * This is the join the app already had in its data and never showed: a diary
   * entry carries trade_id and an image, so "what did the chart look like"
   * has always been answerable and was only reachable by scrolling the diary
   * hunting for the right date.
   */
  const notes = useMemo(
    () => (diary || [])
      .filter((d) => d.trade_id === row?.id)
      .sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date))),
    [diary, row?.id]
  );

  // Signed Storage URLs expire, so they are fetched when the panel opens
  // rather than held anywhere. A pasted TradingView link passes straight
  // through — chartUrl knows the difference.
  const [urls, setUrls] = useState({});
  useEffect(() => {
    let alive = true;
    for (const e of notes) {
      if (!e.image_path || urls[e.id]) continue;
      chartUrl(e.image_path).then((u) => {
        if (alive && u) setUrls((m) => ({ ...m, [e.id]: u }));
      });
    }
    return () => { alive = false; };
  }, [notes]);

  /* ---- attaching a chart ------------------------------------------- */
  //
  // Charts were only ever attachable from the Diary, and only if you
  // remembered to pick the trade from a dropdown while writing an entry. The
  // link between the two has been in the schema from the start and almost
  // nothing used it — three trades in a hundred and twenty-five. Attaching
  // from the trade you are already looking at is the whole fix.
  //
  // It still writes a diary entry underneath. The diary stays the one home
  // for charts and notes, nothing about the data model changes, and the entry
  // shows up in both places.
  const [link, setLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  // null while the preview is loading, then whether it actually resolved to an
  // image. A well-formed snapshot id that does not exist parses perfectly and
  // 404s at S3 — without this you can attach a dead link and only find out
  // months later, when the chart is the thing you came back for.
  const [imgOk, setImgOk] = useState(null);
  const resolved = resolveTradingViewChart(link);

  useEffect(() => { setLink(""); setOpen(false); }, [row?.id]);
  useEffect(() => { setImgOk(null); }, [resolved.url]);

  const attach = async () => {
    if (!resolved.ok || imgOk !== true || !onAttachChart) return;
    setSaving(true);
    try {
      await onAttachChart({
        trade_id: row.id,
        // Dated to the trade's entry, not to today: a chart attached during a
        // weekend review belongs beside the decision it illustrates, and the
        // diary lists by date.
        entry_date: row.entry_date || new Date().toISOString().slice(0, 10),
        image_path: resolved.url,
        emotions: [],
        body: "",
      });
      setLink("");
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  /* ---- the chart, full size ---------------------------------------- */
  //
  // A TradingView snapshot is around four thousand pixels wide and the panel
  // shows it at six hundred. Fine for "is there a chart", useless for the
  // thing charts are for. `zoom` holds the src being looked at; `actual`
  // switches between fitting the screen and 1:1 with scroll, because a chart
  // scaled to fit a laptop is still smaller than the one it was drawn on.
  /**
   * An INDEX into the charts, not a URL.
   *
   * Holding the src meant the lightbox knew what it was showing and nothing
   * about where that sat among the others, so there was no next to go to. An
   * index gives it both, and re-resolves through `shots` on every render, so
   * deleting the chart being viewed lands on whatever takes its place rather
   * than on a dead URL.
   */
  const [zoom, setZoom] = useState(null);
  const [actual, setActual] = useState(false);
  const [removing, setRemoving] = useState(false);
  useEffect(() => { setActual(false); }, [zoom]);

  // Only entries whose image has actually resolved can be paged through — a
  // Storage URL still being signed has nothing to show yet.
  const shots = notes.filter((e) => e.image_path && urls[e.id]);
  const at = zoom == null ? -1 : Math.min(zoom, shots.length - 1);
  const shot = at >= 0 ? shots[at] : null;

  // Deleting the last chart, or the last one full stop, closes the viewer
  // rather than leaving it open on nothing.
  useEffect(() => {
    if (zoom != null && shots.length === 0) setZoom(null);
  }, [zoom, shots.length]);

  /**
   * Removing a chart is not always removing an entry.
   *
   * A chart lives on a diary entry that may also hold a note and the emotions
   * tagged with it. Deleting the row would take those with it silently, and
   * "wrong chart attached" is a different mistake from "this whole entry was a
   * mistake". So an entry carrying words keeps them and loses only the image;
   * an entry that was nothing but the chart goes entirely, because an empty
   * diary row is litter nobody will ever tidy.
   *
   * The caller confirms and does the writing — it owns the diary state, and
   * the delete path already asks before it removes anything.
   */
  const removeChart = async (entry) => {
    if (!onRemoveChart || removing) return;
    setRemoving(true);
    try {
      await onRemoveChart(entry);
    } finally {
      setRemoving(false);
    }
  };

  const step = (d) => {
    if (!shots.length) return;
    setZoom((i) => (((i ?? 0) + d) % shots.length + shots.length) % shots.length);
  };

  useEffect(() => {
    const key = (e) => {
      // The lightbox owns Escape while it is open, or one press would shut
      // the panel behind it and lose the trade you were reading.
      if (zoom != null) {
        if (e.key === "Escape") { e.stopPropagation(); setZoom(null); }
        // Left and right page the charts; up and down would step the TRADE
        // underneath, which is never what someone looking at a chart means.
        else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
        else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
        return;
      }
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowUp" && onPrev) { e.preventDefault(); onPrev(); }
      else if (e.key === "ArrowDown" && onNext) { e.preventDefault(); onNext(); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose, onPrev, onNext, zoom, shots.length]);

  if (!row) return null;

  const dir = row.side === "short" ? -1 : 1;
  const entry = Number(row.entry_price);
  const qty = Number(row.quantity);
  const perShare = row.riskPerShare;
  const exits = row.exits || [];
  // Everything sold. The panel keeps its shape either way — same legs, same
  // arithmetic — but stops offering a mark, a live risk or a sell to record,
  // none of which mean anything once there's nothing left on the table.
  const closed = row.status === "closed" || !(row.qtyOpen > 0);

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
    <>
    {/* Above the panel, not inside it: the sheet scrolls and clips, and a
        chart pinned to the viewport must do neither. */}
    {shot && (
      <div className="pd-lightbox"
           onMouseDown={(e) => e.target === e.currentTarget && setZoom(null)}>
        <div className="pd-lb-bar">
          {shots.length > 1 && (
            <span className="pd-lb-count">
              {at + 1} of {shots.length}
              <i className="pd-lb-when">{day(shot.entry_date)}</i>
            </span>
          )}
          <span className="pd-lb-spacer" />
          {onRemoveChart && (
            <button className="pd-lb-btn is-danger" disabled={removing}
                    onClick={() => removeChart(shot)}>
              <Trash2 size={14} />{removing ? "Removing…" : "Remove"}
            </button>
          )}
          <button className="pd-lb-btn" onClick={() => setActual((a) => !a)}>
            {actual ? "Fit to screen" : "Actual size"}
          </button>
          <button className="pd-lb-btn" onClick={() => setZoom(null)} aria-label="Close chart">
            <X size={15} />
          </button>
        </div>

        <div className={`pd-lb-scroll${actual ? " is-actual" : ""}`}
             onMouseDown={(e) => e.target === e.currentTarget && setZoom(null)}>
          <img src={urls[shot.id]} alt={`Chart saved ${shot.entry_date}`}
               onClick={() => setActual((a) => !a)} />
        </div>

        {/* Outside the scroller so they hold still while an actual-size chart
            is panned around underneath them. */}
        {shots.length > 1 && (
          <>
            <button className="pd-lb-nav is-prev" onClick={() => step(-1)} aria-label="Previous chart">
              <ChevronLeft size={22} />
            </button>
            <button className="pd-lb-nav is-next" onClick={() => step(1)} aria-label="Next chart">
              <ChevronRight size={22} />
            </button>
          </>
        )}

        <div className="pd-lb-hint">
          Click the chart to {actual ? "fit it to the screen" : "see it at full resolution"}
          {shots.length > 1 && " · ← → for the others"} · Esc to close
        </div>
      </div>
    )}
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet pd" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheethead">
          <div className="pd-acts">
            {/* Same form as Edit, opened on a fresh sell. It's the word in mind
                when a position is being closed, so it gets its own button
                rather than being something to find inside Edit. Nothing left
                to sell on a closed trade, so it isn't offered. */}
            {!closed && onExit && (
              <button className="btn ghost sm" onClick={() => onExit(row)}>
                <LogOut size={13} />Exit
              </button>
            )}
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
              {closed && row.lastExit && ` → ${day(row.lastExit)}`}
              {isFinite(row.heldDays) && ` · ${row.heldDays} days`}
              {!closed && ` · ${isFinite(row.pctClosed) ? row.pctClosed.toFixed(1) : "0"}% sold`}
              {closed && exits.length > 1 && ` · ${exits.length} sells`}
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
              {closed
                ? `after ${rupee(row.charges)} of charges`
                : <>
                    banked {isFinite(row.realisedPnl) && row.qtyExited > 0 ? rupee(row.realisedPnl) : "—"}
                    {row.qtyOpen > 0 && (
                      <> · still running {isFinite(row.unrealisedPnl) ? rupee(row.unrealisedPnl) : "no mark"}</>
                    )}
                  </>}
            </div>
          </div>

          {/* The numbers the position was built on */}
          <div className="pd-grid">
            {stat("Avg entry", entry.toFixed(2), `${qty} shares`)}
            {stat("Avg exit",
              isFinite(row.avgExitPrice) ? row.avgExitPrice.toFixed(2) : "—",
              isFinite(row.avgExitPrice) ? signedPct(gainPct(row.avgExitPrice)) : null)}
            {closed
              ? stat("Held",
                  isFinite(row.heldDays) ? `${row.heldDays}d` : "—",
                  exits.length > 1 ? `over ${exits.length} sells` : "one sell")
              : stat("CMP",
                  isFinite(row.mark) ? Number(row.mark).toFixed(2) : "—",
                  isFinite(row.mark) ? signedPct(gainPct(row.mark)) : null)}
            {stat("Charges", isFinite(row.charges) ? rupee(row.charges) : "—",
              isFinite(row.exposure) && row.exposure > 0
                ? `${pct((row.charges / row.exposure) * 100, 2)} of size` : null)}
            {/* One stop. It was two tiles — the stop the position opened with
                and the stop now — which read as a distinction the trader had
                made when it was one number they had typed once. */}
            {stat("Stop",
              isFinite(row.stop) ? row.stop.toFixed(2) : "—",
              row.stop_source === "assumed"
                ? `${isFinite(row.slPct) ? pct(row.slPct) : ""} — assumed, not set`
                : isFinite(row.slPct) ? `${pct(row.slPct)} from entry` : null)}
            {stat("1R — risk taken",
              isFinite(row.riskAmt) ? rupee(row.riskAmt) : "—",
              isFinite(row.riskPct) ? `${pct(row.riskPct, 2)} of account` : null)}
            {stat("Position size", isFinite(row.exposure) ? rupee(row.exposure) : "—")}
            {closed
              ? stat("Result",
                  isFinite(row.r) ? rfmt(row.r) : "—",
                  isFinite(row.pnl) && isFinite(row.exposure) && row.exposure > 0
                    ? signedPct((row.pnl / row.exposure) * 100) : null)
              : stat("Open risk",
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
                        {/* Why it went. The whole point of recording it. */}
                        {e.reason && <i className="pd-why"> {e.reason}</i>}
                      </td>
                      <td className="num">
                        {Number(e.price).toFixed(2)}
                        <i className="pd-dim">{signedPct(gainPct(Number(e.price)))}</i>
                      </td>
                      <td className="num">
                        −{e.quantity}
                        <i className="pd-dim">{qty > 0 ? `${pct((e.quantity / qty) * 100, 0)} of it` : ""}</i>
                      </td>
                      <td className="num pd-dim">{rupee(Number(e.charges) || 0)}</td>
                      <td className={`num ${net >= 0 ? "pos" : "neg"}`}>
                        {rupee(net)}
                        <i className="pd-dim">at {rfmt(atR(Number(e.price)))}</i>
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
                      <i className="pd-dim">{qty > 0 ? `${pct((row.qtyOpen / qty) * 100, 0)} of it` : ""}</i>
                    </td>
                    <td className="num pd-dim">—</td>
                    <td className={`num ${row.unrealisedPnl >= 0 ? "pos" : "neg"}`}>
                      {isFinite(row.unrealisedPnl) ? rupee(row.unrealisedPnl) : "—"}
                      {isFinite(row.mark) && (
                        <i className="pd-dim">at {rfmt(atR(Number(row.mark)))}</i>
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
                    {isFinite(row.r) && <i className="pd-dim">{rfmt(row.r)} overall</i>}
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

          {/* What you decided afterwards. Only ever written on a trade that's
              finished, and the reason to open a closed one back up at all. */}
          {(row.mistakes || []).length > 0 && (
            <div className="pd-mistakes">
              <div className="pd-stat-l">Tagged on this trade</div>
              <div className="chips" style={{ marginTop: 6 }}>
                {row.mistakes.map((m) => <span key={m} className="chip">{m}</span>)}
              </div>
            </div>
          )}

          {row.notes && (
            <div className="pd-notes">
              <div className="pd-stat-l">Notes</div>
              <p>{row.notes}</p>
            </div>
          )}

          {/* The charts, last, because they are the thing worth arriving at.
              A diary entry with no image still shows — what you wrote at the
              time is the other half of the evidence. */}
          {(notes.length > 0 || onAttachChart) && (
            <div className="pd-charts">
              <div className="pd-charts-head">
                <div className="pd-stat-l">
                  {notes.length > 0
                    ? `From the diary · ${notes.length} ${notes.length === 1 ? "entry" : "entries"}`
                    : "No chart saved for this trade"}
                </div>
                {onAttachChart && !open && (
                  <button className="btn ghost sm" onClick={() => setOpen(true)}>
                    <ImagePlus size={13} />Attach chart
                  </button>
                )}
              </div>

              {open && (
                <div className="pd-attach">
                  <input
                    className="in" autoFocus value={link}
                    placeholder="Paste a TradingView snapshot link — tradingview.com/x/…"
                    onChange={(e) => setLink(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && resolved.ok) attach(); }}
                  />
                  {/* The preview is the validation. A link that resolves to a
                      real image proves itself by rendering; one that does not
                      cannot be talked into working, so the message says which
                      menu item to use instead. */}
                  {resolved.ok && (
                    <img className="pd-attach-preview" src={resolved.url}
                         alt="Chart to attach" data-bad={imgOk === false ? 1 : 0}
                         onLoad={() => setImgOk(true)}
                         onError={() => setImgOk(false)} />
                  )}
                  {resolved.ok && imgOk === false && (
                    <p className="pd-attach-help">
                      That link is the right shape but TradingView has no snapshot at it.
                      Check it was copied whole — or take a fresh one with the camera icon.
                    </p>
                  )}
                  {/* The message travels with the result now, so a new failure
                      case cannot be added without its explanation. */}
                  {!resolved.ok && !resolved.empty && (
                    <p className="pd-attach-help">{resolved.error}</p>
                  )}
                  <div className="pd-attach-row">
                    {/* Enabled only once the image has actually rendered — the
                        preview is the proof, not the parse. */}
                    <button className="btn sm"
                            disabled={!resolved.ok || imgOk !== true || saving}
                            onClick={attach}>
                      {saving ? "Attaching…" : "Attach"}
                    </button>
                    <button className="btn ghost sm"
                            onClick={() => { setLink(""); setOpen(false); }}>Cancel</button>
                    <span className="pd-attach-note">
                      Saved as a diary entry against this trade, dated {day(row.entry_date)}.
                    </span>
                  </div>
                </div>
              )}
              {notes.map((e) => (
                <figure key={e.id} className="pd-shot">
                  {e.image_path ? (
                    urls[e.id]
                      ? <button className="pd-shot-open"
                                onClick={() => setZoom(shots.findIndex((x) => x.id === e.id))}
                                title="Open full size">
                          <img src={urls[e.id]} alt={`Chart saved ${e.entry_date}`} />
                        </button>
                      : <div className="pd-shot-wait">loading chart…</div>
                  ) : null}
                  <figcaption>
                    <span className="mono">{day(e.entry_date)}</span>
                    {(e.emotions || []).length > 0 && (
                      <span className="pd-emo"> · {e.emotions.join(", ")}</span>
                    )}
                  </figcaption>
                  {e.body && <p>{e.body}</p>}
                </figure>
              ))}
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

          /* 1px gap over a ruled background draws the separators: with eight
             cells on two rows, borders on the cells themselves leave the wrap
             seam undrawn and need nth-child arithmetic that breaks the moment
             the column count changes. */
          .pd-grid {
            display: grid; grid-template-columns: repeat(4, 1fr);
            gap: 1px; background: var(--rule);
            border: 1px solid var(--rule); border-radius: 3px; overflow: hidden;
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
          .pd-charts { margin-top: 18px; }
          .pd-charts-head {
            display: flex; align-items: center; justify-content: space-between;
            gap: 12px; flex-wrap: wrap;
          }
          .pd-attach {
            margin-top: 10px; padding: 12px; border: 1px solid var(--rule);
            border-radius: 3px; background: var(--card);
          }
          .pd-attach .in { width: 100%; font-size: 12.5px; }
          .pd-attach-preview {
            width: 100%; height: auto; display: block; margin-top: 10px;
            border: 1px solid var(--rule); border-radius: 3px;
          }
          /* A broken image renders as an alt-text stub at whatever size the
             browser picks; collapsing it keeps the message below as the thing
             you read. */
          .pd-attach-preview[data-bad="1"] { display: none; }
          .pd-attach-help {
            font-size: 11.5px; color: var(--ink3); line-height: 1.55;
            margin: 8px 0 0; text-wrap: pretty;
          }
          .pd-attach-row {
            display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px;
          }
          .pd-attach-note { font-size: 11px; color: var(--ink3); }
          .pd-shot {
            margin: 10px 0 0; padding: 0 0 12px;
            border-bottom: 1px solid var(--rule);
          }
          .pd-shot:last-child { border-bottom: 0; }
          .pd-shot img {
            width: 100%; height: auto; display: block; border-radius: 3px;
            border: 1px solid var(--rule); background: var(--card);
          }
          .pd-shot-wait {
            height: 120px; display: flex; align-items: center; justify-content: center;
            font-size: 11.5px; color: var(--ink3);
            border: 1px dashed var(--rule); border-radius: 3px;
          }
          .pd-shot figcaption { font-size: 11.5px; color: var(--ink3); margin-top: 6px; }
          .pd-emo { color: var(--brass); }
          .pd-shot p { font-size: 12.5px; line-height: 1.55; margin: 5px 0 0; color: var(--ink2); }
          .pd-notes p {
            font-size: 12.5px; margin: 5px 0 0; line-height: 1.6;
            white-space: pre-wrap; color: var(--ink2);
          }
          .pd-foot {
            font-size: 11px; color: var(--ink3); line-height: 1.6; text-wrap: pretty;
          }
        `}</style>

        {/* Global: these sit inside markup this component builds through the
            `stat` helper and inside table cells, and scoped styled-jsx does
            not reach past the element it is attached to reliably here. */}
        <style jsx global>{`
          .pd-stat { padding: 11px 13px; background: var(--card); min-width: 0; }
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
          .pd-why {
            color: var(--brass); font-size: 10.5px; font-style: normal;
            display: inline; margin-left: 6px;
          }
          /* Suffixes go under the figure, not beside it. Inline, every "+12.0%"
             and "of it" shoved its own number left by a different amount, so a
             right-aligned column of prices came out ragged. */
          .pd-table td > i.pd-dim { display: block; margin-top: 2px; line-height: 1.3; }
          .pd-table td, .pd-table th { vertical-align: top; }
          .pd-table td:first-child i.pd-dim { display: inline; }
          .pd-table tfoot td {
            border-top: 1px solid var(--ink3); font-weight: 600; font-size: 12px;
          }
        `}</style>

      {/* Global, and not by preference. The lightbox renders in the other branch
          of this component's fragment from the scoped block above, and
          styled-jsx puts its scoping class on neither — the markup came out with
          no jsx- class at all and every rule silently missed, which is why a
          4215px chart ignored max-width and filled the screen. Same trap the
          block above this one describes. Prefixed so nothing leaks. */}
      <style jsx global>{`
          .pd-shot-open {
            display: block; width: 100%; padding: 0; border: 0; background: none;
            cursor: zoom-in;
          }
          .pd-lightbox {
            position: fixed; inset: 0; z-index: 200;
            background: rgba(10, 14, 13, 0.92);
            display: flex; flex-direction: column;
          }
          .pd-lb-bar {
            display: flex; justify-content: flex-end; align-items: center; gap: 8px;
            padding: 10px 14px; flex: 0 0 auto;
          }
          .pd-lb-btn {
            background: rgba(255,255,255,0.10); border: 1px solid rgba(255,255,255,0.18);
            color: #EDF0EE; border-radius: 3px; padding: 5px 10px; cursor: pointer;
            font: inherit; font-size: 12px; display: inline-flex; align-items: center; gap: 5px;
          }
        .pd-lb-btn:hover { background: rgba(255,255,255,0.18); }
        .pd-lb-btn:disabled { opacity: 0.5; cursor: default; }
        .pd-lb-btn.is-danger { color: #F0B0A4; border-color: rgba(240,176,164,0.35); }
        .pd-lb-btn.is-danger:hover { background: rgba(240,176,164,0.16); }
        .pd-lb-spacer { flex: 1; }
        .pd-lb-count {
          color: #EDF0EE; font-size: 12px; display: inline-flex;
          align-items: baseline; gap: 8px; padding-left: 4px;
        }
        .pd-lb-when { font-style: normal; color: rgba(237,240,238,0.55); font-size: 11px; }
        /* Vertically centred on the viewport rather than inside the scroller,
           so they hold position while an actual-size chart is panned. */
        .pd-lb-nav {
          position: absolute; top: 50%; transform: translateY(-50%);
          background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.18);
          color: #EDF0EE; width: 38px; height: 56px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          border-radius: 3px;
        }
        .pd-lb-nav:hover { background: rgba(0,0,0,0.7); }
        .pd-lb-nav.is-prev { left: 10px; }
        .pd-lb-nav.is-next { right: 10px; }
          .pd-lb-scroll {
            flex: 1 1 auto; min-height: 0; overflow: auto;
            display: flex; align-items: center; justify-content: center;
            padding: 0 14px;
          }
          .pd-lb-scroll img {
            max-width: 100%; max-height: 100%; width: auto; height: auto;
            display: block; cursor: zoom-in; border-radius: 2px;
            /* A flex item will not shrink below its intrinsic size unless its
               automatic minimum is removed, so a 4215px snapshot ignored
               max-width and rendered full width in a viewport a fifth of that. */
            min-width: 0; min-height: 0;
          }
          /* 1:1. The flex centring has to go or the image is clipped rather than
             scrolled once it is wider than the box. */
          .pd-lb-scroll.is-actual { display: block; }
          .pd-lb-scroll.is-actual img {
            max-width: none; max-height: none; margin: 0 auto; cursor: zoom-out;
          }
          .pd-lb-hint {
            flex: 0 0 auto; text-align: center; padding: 9px 14px 13px;
            font-size: 11.5px; color: rgba(237,240,238,0.55);
          }
        `}</style>
      </div>
    </div>

    </>
  );
}
