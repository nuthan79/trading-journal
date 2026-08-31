"use client";

import { useMemo, useState } from "react";
import { matchesEdgeFilter, describeEdgeFilter } from "@/lib/edge";
import { Plus, Pencil, Trash2, Download, Image as ImageIcon, X } from "lucide-react";
import { rupee, rfmt, pct, signedPct } from "@/lib/format";
import PositionDetail from "./PositionDetail";
import { SETUP_FIELDS } from "@/lib/gaps";
import { noStopOnRecord, hasRealStop } from "@/lib/stops";

const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));

function exportCsv(all) {
  const cols = ["symbol", "exchange", "side", "entry_date", "entry_price", "quantity", "stop_loss",
    "exposure", "riskAmt", "riskPct", "pattern", "pivot_price", "distPivot", "vol_pct_avg",
    "weinstein_stage", "rs_rank",
    "exit_date", "exit_price", "avgExitPrice", "exitPct", "exit_reason", "charges", "pnl", "r",
    "heldDays", "mistakes", "notes"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [cols.join(",")].concat(all.map((t) =>
    cols.map((c) => esc(Array.isArray(t[c]) ? t[c].join(" | ") :
      typeof t[c] === "number" ? (isFinite(t[c]) ? t[c].toFixed(4) : "") : t[c])).join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `trades-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}

export default function Trades({ all, diary = [], onEdit, onExit, onDelete, onNew,
                                 onAttachChart, onRemoveChart, mistake = "", missing = "", edge = null, onClearFilter }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ k: "entry_date", dir: -1 });
  const noStopCount = useMemo(() => (all || []).filter(noStopOnRecord).length, [all]);
  const [detailId, setDetailId] = useState(null);

  /**
   * Trades that have a chart, by trade id.
   *
   * Charts are not attached to trades — they hang off diary entries, which
   * point back at a trade through trade_id. That link is real in the data and
   * was surfaced nowhere, so "did I save a chart for this one" could only be
   * answered by scrolling the diary. A Set of ids is enough for the column;
   * the images themselves are fetched only when a row is opened.
   */
  const charted = useMemo(() => {
    const m = new Map();
    for (const d of diary || []) {
      if (!d.trade_id || !d.image_path) continue;
      m.set(d.trade_id, (m.get(d.trade_id) || 0) + 1);
    }
    return m;
  }, [diary]);

  /**
   * `?missing=stop` reaches the trades marked as having no stop on record.
   *
   * Deliberately NOT added to SETUP_FIELDS: those are the chart-read fields
   * the Edge screen needs, and putting a stop among them would add a sixth
   * row to the Review data-gaps card duplicating the /stops queue. This is a
   * different question with a different home.
   *
   * It exists because those trades leave /stops once resolved — correctly,
   * they are answered — and there was then no list of them anywhere. One at
   * a time through this table always worked; finding them did not.
   */
  const NO_STOP_FIELD = { key: "stop", label: "stop", has: hasRealStop };
  const missingField = SETUP_FIELDS.find((f) => f.key === missing)
    || (missing === "stop" ? NO_STOP_FIELD : null);
  const edgeDesc = useMemo(() => (edge ? describeEdgeFilter(edge) : null), [edge]);

  const rows = useMemo(() => {
    let r = all;
    // Arrives from the mistakes table on Performance. Exact match, not a
    // substring — "Sold too early" and "Sold a little late" both contain
    // "Sold", and a fuzzy filter would quietly mix two different errors.
    if (mistake) r = r.filter((t) => (t.mistakes || []).includes(mistake));

    // Arrives from the gaps prompt on Review. Closed only, matching how the
    // count was made — offering to fix a hundred and then listing a hundred
    // and forty is how a prompt stops being trusted.
    if (missingField) {
      r = r.filter((t) => t.status === "closed" && !missingField.has(t));
    }

    /*
      Arrives from a row on "Where the edge is". CLOSED ONLY, because that
      table is built from closed trades — an open position has no R and was
      never in the bucket, so including it here would show more trades than
      the row said and make the count look wrong.

      The membership test is edge.js's own, the same function that put the
      trade in the bucket. Writing a second one here would eventually disagree
      with the first, and the disagreement would surface as a row claiming 26
      trades and this list showing 24.
    */
    if (edge) {
      r = r.filter((t) => t.status === "closed" && matchesEdgeFilter(t, edge));
    }
    if (filter === "open") r = r.filter((t) => t.status === "open");
    if (filter === "closed") r = r.filter((t) => t.status === "closed");
    if (filter === "winners") r = r.filter((t) => t.r > 0);
    if (filter === "losers") r = r.filter((t) => isFinite(t.r) && t.r <= 0);
    if (filter === "nostop") r = r.filter(noStopOnRecord);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      r = r.filter((t) => (t.symbol || "").toLowerCase().includes(s) ||
        (t.pattern || "").toLowerCase().includes(s) || (t.notes || "").toLowerCase().includes(s));
    }
    return [...r].sort((a, b) => {
      const av = a[sort.k], bv = b[sort.k];
      if (typeof av === "number" || typeof bv === "number")
        return ((isFinite(av) ? av : -1e12) - (isFinite(bv) ? bv : -1e12)) * sort.dir;
      return String(av || "").localeCompare(String(bv || "")) * sort.dir;
    });
  }, [all, mistake, missingField, edge, filter, q, sort]);

  // Resolved by id against the filtered list, not held as an object: change
  // the filter or the sort while it's open and the panel follows the row,
  // or closes if that row is no longer on screen.
  /**
   * What is on screen, added up.
   *
   * Only worth having because the list filters: eight GARFIBRES rows raise
   * "so what did this stock cost me altogether", and nothing answered it.
   *
   * R is counted separately from money and says how many trades it covers. A
   * trade with no stop has a P&L and no R, so the two totals are drawn from
   * different sets of rows — printing them side by side without saying so
   * invites reading one as the other's explanation.
   */
  const totals = useMemo(() => {
    const pnl = rows.map((t) => t.pnl).filter(isFinite);
    const rs = rows.map((t) => t.r).filter(isFinite);
    return {
      n: rows.length,
      pnl: pnl.reduce((a, b) => a + b, 0),
      r: rs.reduce((a, b) => a + b, 0),
      withR: rs.length,
    };
  }, [rows]);

  const detailAt = detailId == null ? -1 : rows.findIndex((t) => t.id === detailId);

  const th = (k, label, cls) => {
    const active = sort.k === k;
    return (
      <th className={cls} data-sortable
          onClick={() => setSort((s) => ({ k, dir: s.k === k ? -s.dir : -1 }))}>
        {label}
        <span className="arrow">{active ? (sort.dir === 1 ? "↑" : "↓") : ""}</span>
      </th>
    );
  };

  return (
    <div className="sec">
      {(mistake || missingField || edgeDesc) && (
        <div className="tr-chip">
          <span>
            {mistake
              ? <>Showing trades tagged <b>{mistake}</b></>
              : missingField
              ? <>Closed trades with no <b>{missingField.label}</b> recorded — open each and add it</>
              /* The band label is the row's own string, carried in the URL and
                 printed verbatim — so this can never describe a slightly
                 different slice than the row that sent you here. */
              : <>Closed trades where <b>{edgeDesc.label}</b> is <b>{edgeDesc.value}</b></>}
          </span>
          <span className="tr-chip-n">{rows.length} of {all.length}</span>
          <button className="btn ghost sm" onClick={onClearFilter}>
            <X size={12} />Clear
          </button>
        </div>
      )}
      <div className="sechead">
        <div className="seg">
          {/**
            * "No stop" appears only when there are some, because a chip for an
            * empty set is a question nobody asked.
            *
            * It lives here rather than only on the stops queue, which is where
            * the link to these trades was. That screen is reachable while it
            * has work in it and through Settings afterwards — so the one list
            * somebody might want months later sat behind a route they would
            * have to already know about. A filter over trades belongs with the
            * other filters over trades.
            */}
          {[["all","All"],["open","Open"],["closed","Closed"],["winners","Winners"],["losers","Losers"],
            ...(noStopCount > 0 ? [["nostop", `No stop · ${noStopCount}`]] : [])].map(([id,l]) => (
            <button key={id} data-on={filter === id ? 1 : 0} onClick={() => setFilter(id)}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/*
            The clear button lives INSIDE the field, which is why the wrapper
            exists. Extra right padding on the input keeps a long symbol from
            running underneath it.

            It renders only when there is something to clear — a permanent X
            beside an empty box is a control that does nothing most of the time,
            and it would sit there competing with the placeholder.
          */}
          <div className="tr-search">
            <input className="in" placeholder="Search" value={q}
                   onChange={(e) => setQ(e.target.value)} />
            {q && (
              <button type="button" className="tr-clear" aria-label="Clear search"
                      onClick={() => setQ("")}>
                <X size={13} />
              </button>
            )}
          </div>
          <button className="btn ghost sm" onClick={() => exportCsv(all)}><Download size={13} />CSV</button>
        </div>
      </div>

      <div className="card scroll">
        {rows.length === 0 ? (
          <div className="empty">
            <div className="eyebrow">Nothing here yet</div>
            <p>Every trade you log becomes a row here and a bar on the plot. Start with
              one — even an old trade you still remember clearly.</p>
            <button className="btn" onClick={onNew}><Plus size={14} />Log a trade</button>
          </div>
        ) : (
          <table className="t">
            <thead><tr>
              {th("symbol", "Symbol", "fz fz-last")}
              {th("entry_date", "In")}
              {th("exit_date", "Out")}
              {th("heldDays", "Held", "num")}
              {/* Left to right, the life of the trade: what went on, how it
                  came off, what it came to. Risk sits after R because it is
                  the denominator R was measured against — useful once you
                  have seen the multiple, noise before it. */}
              {th("entry_price", "Entry", "num")}
              {th("stop_loss", "Stop", "num")}
              {th("slPct", "SL %", "num")}
              {th("quantity", "Qty", "num")}
              {th("exposure", "Size", "num")}
              {th("avgExitPrice", "Exit", "num")}
              {th("exitPct", "Exit %", "num")}
              {th("pnl", "P&L", "num")}
              {th("r", "R", "num")}
              {th("riskAmt", "Risk", "num")}
              {/* The setup — what the chart looked like going in. Behind the
                  outcome because most rows have none of it recorded, and a
                  block of dashes shouldn't sit between a symbol and its P&L. */}
              <th title="Charts saved against this trade in the diary">Chart</th>
              {th("pattern", "Pattern")}
              {th("distPivot", "Δ pivot", "num")}
              {th("vol_pct_avg", "Vol %", "num")}
              {th("weinstein_stage", "Stg", "num")}
              {th("rs_rank", "RS", "num")}
              <th></th>
            </tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="fz fz-last">
                    <button className="tr-sym" onClick={() => setDetailId(t.id)}
                            title={`Open ${t.symbol}`}>
                      <b className="disp">{t.symbol}</b>
                    </button>
                    <span style={{ color: "var(--ink3)", fontSize: 11 }}> {t.exchange}</span>
                    {t.side === "short" && <span style={{ color: "var(--short)", fontSize: 10 }}> ▾</span>}
                    {(t.mistakes || []).length > 0 && (
                      <span title={t.mistakes.join(", ")}
                            style={{ color: "var(--brass)", fontSize: 11, marginLeft: 4 }}>▲</span>)}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{t.entry_date}</td>
                  <td className="mono" style={{ fontSize: 12, color: t.exit_date ? "inherit" : "var(--ink3)" }}>
                    {t.exit_date || "open"}</td>
                  <td className="num" style={{ fontSize: 12, color: "var(--ink2)" }}
                      title={t.exit_date ? undefined : "Still open — counted to today"}>
                    {isFinite(t.heldDays) ? `${t.heldDays}d` : "—"}</td>
                  <td className="num" title={t.acquisition === "bonus"
                        ? "Bonus, split or allotment — these shares cost nothing, "
                          + "so the sale is all profit and there is no R to compute"
                        : undefined}>
                    {t.acquisition === "bonus"
                      ? <span className="tr-free">free</span>
                      : Number(t.entry_price).toFixed(2)}</td>
                  <td className="num" title={t.stop_source === "assumed"
                        ? "Assumed at import, not a stop you set — every R on this row follows from it"
                        : undefined}>
                    {isFinite(num(t.stop_loss)) ? Number(t.stop_loss).toFixed(2) : "—"}
                    {t.stop_source === "assumed" && <i className="tr-assumed">assumed</i>}
                    {noStopOnRecord(t) && <i className="tr-assumed">no stop</i>}</td>
                  <td className="num" style={{ fontSize: 12 }}>{isFinite(t.slPct) ? pct(t.slPct, 1) : "—"}</td>
                  <td className="num">{t.quantity}</td>
                  <td className="num" style={{ fontSize: 12 }}
                      title="Entry price × quantity — what the position cost">
                    {isFinite(t.exposure) ? rupee(t.exposure) : "—"}</td>
                  <td className="num" title={t.status === "partial"
                        ? "Average of the sells so far — the rest is still open"
                        : undefined}>
                    {isFinite(t.avgExitPrice) ? t.avgExitPrice.toFixed(2) : "—"}
                    {t.status === "partial" && <i className="tr-part">part</i>}</td>
                  <td className={`num ${isFinite(t.exitPct) ? (t.exitPct >= 0 ? "pos" : "neg") : ""}`}
                      style={{ fontSize: 12 }}
                      title="Price move from entry to the average exit, before charges">
                    {isFinite(t.exitPct) ? signedPct(t.exitPct) : "—"}</td>
                  <td className={`num ${isFinite(t.pnl) ? (t.pnl >= 0 ? "pos" : "neg") : ""}`}>
                    {isFinite(t.pnl) ? rupee(t.pnl) : "—"}</td>
                  <td className={`num ${isFinite(t.r) ? (t.r >= 0 ? "pos" : "neg") : ""}`}
                      style={{ fontWeight: 500 }}>{isFinite(t.r) ? rfmt(t.r) : "—"}</td>
                  <td className="num" style={{ fontSize: 12 }}
                      title={isFinite(t.riskPct)
                        ? `${pct(t.riskPct, 2)} of the account — the 1R every R above divides by`
                        : "No stop, so no 1R to divide by"}>
                    {isFinite(t.riskAmt) ? rupee(t.riskAmt) : "—"}</td>
                  {/* Clickable when there is one: opens the trade, where the
                      chart is actually rendered. A count only shows past one,
                      since "1" beside every charted row is noise. */}
                  <td style={{ textAlign: "center" }}>
                    {charted.has(t.id) ? (
                      <button className="tr-chart" onClick={() => setDetailId(t.id)}
                              title={`${charted.get(t.id)} chart${charted.get(t.id) === 1 ? "" : "s"} — open ${t.symbol}`}>
                        <ImageIcon size={13} />
                        {charted.get(t.id) > 1 && <span>{charted.get(t.id)}</span>}
                      </button>
                    ) : (
                      <span style={{ color: "var(--rule)", fontSize: 11 }}>—</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--ink2)" }}>{t.pattern || "—"}</td>
                  <td className="num" style={{ fontSize: 12,
                        color: t.distPivot > 5 ? "var(--short)" : "inherit" }}>
                    {isFinite(t.distPivot) ? `${t.distPivot >= 0 ? "+" : ""}${t.distPivot.toFixed(1)}%` : "—"}</td>
                  <td className="num" style={{ fontSize: 12,
                        color: isFinite(num(t.vol_pct_avg)) && num(t.vol_pct_avg) < 100 ? "var(--short)" : "inherit" }}>
                    {t.vol_pct_avg ? `${t.vol_pct_avg}%` : "—"}</td>
                  <td className="num" style={{ fontSize: 12 }}>{t.weinstein_stage || "—"}</td>
                  <td className="num" style={{ fontSize: 12 }}>{t.rs_rank || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="x" onClick={() => onEdit(t)} aria-label="Edit"><Pencil size={13} /></button>
                    <button className="x" onClick={() => onDelete(t.id)} aria-label="Delete"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
            {/* 21 columns: 11 spanned here, P&L, R, then 8 spanned to the end.
                Get that sum wrong and the whole row slides out of line under
                the headers without anything erroring. */}
            <tfoot className="stick">
              <tr className="tr-tot">
                <td colSpan={11}>
                  <b>{totals.n}</b> {totals.n === 1 ? "trade" : "trades"} shown
                </td>
                <td className={`num ${totals.pnl >= 0 ? "pos" : "neg"}`}>
                  {rupee(totals.pnl)}
                </td>
                <td className={`num ${totals.r >= 0 ? "pos" : "neg"}`}
                    title={totals.withR < totals.n
                      ? `${totals.n - totals.withR} of these have no stop recorded, so no R`
                      : undefined}>
                  {totals.withR ? rfmt(totals.r, 1) : "—"}
                  {totals.withR > 0 && totals.withR < totals.n && (
                    <i className="tr-tot-sub">of {totals.withR}</i>
                  )}
                </td>
                <td colSpan={8}></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      {rows.length > 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          ▲ marks a trade where you tagged a mistake · ▾ marks a short · click a symbol to open it
          · click any column to sort
        </div>
      )}

      {detailAt >= 0 && (
        <PositionDetail
          row={rows[detailAt]}
          diary={diary}
          onAttachChart={onAttachChart}
          onRemoveChart={onRemoveChart}
          onClose={() => setDetailId(null)}
          onEdit={(t) => { setDetailId(null); onEdit(t); }}
          onExit={onExit ? (t) => { setDetailId(null); onExit(t); } : undefined}
          onDelete={async (t) => { setDetailId(null); await onDelete(t.id); }}
          // Steps through the list as filtered and sorted on screen, so the
          // order under the arrows is the order being looked at.
          onPrev={detailAt > 0 ? () => setDetailId(rows[detailAt - 1].id) : undefined}
          onNext={detailAt < rows.length - 1 ? () => setDetailId(rows[detailAt + 1].id) : undefined}
        />
      )}

      <style jsx>{`
        .tr-search { position: relative; width: 180px; }
        .tr-search .in {
          padding: 6px 28px 6px 10px; font-size: 13px;
        }
        /*
          Centred on the field rather than the text, and sized to the tap
          target rather than to the glyph — so it stays comfortable to hit
          while the mark itself stays small enough to read as punctuation
          instead of as a second control competing with CSV beside it.
        */
        .tr-clear {
          position: absolute; top: 50%; right: 4px; transform: translateY(-50%);
          display: flex; align-items: center; justify-content: center;
          width: 20px; height: 20px; padding: 0;
          background: none; border: 0; border-radius: 50%;
          color: var(--ink3); cursor: pointer;
          transition: color 120ms ease, background 120ms ease;
        }
        .tr-clear:hover { color: var(--ink); background: var(--rule); }
        .tr-clear:active { transform: translateY(-50%) scale(0.92); }
        .tr-chip {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          border-left: 2px solid var(--brass); padding: 7px 0 7px 10px;
          margin-bottom: 12px; font-size: 12.5px; color: var(--ink2);
        }
        .tr-chip b { font-weight: 500; color: var(--ink); }
        .tr-chip-n { color: var(--ink3); font-size: 11.5px; }
        .tr-tot td {
          border-top: 1px solid var(--ink3); border-bottom: 0;
          font-size: 12px; padding-top: 8px;
        }
        .tr-tot b { font-weight: 500; }
        /* Under the figure, not beside it — inline, it pushed a right-aligned
           column out of true with the R values above it. */
        .tr-tot-sub {
          display: block; font-style: normal; font-size: 10px;
          color: var(--ink3); margin-top: 1px;
        }
        .tr-chart {
          background: none; border: 0; padding: 2px 4px; cursor: pointer;
          color: var(--brass); display: inline-flex; align-items: center; gap: 3px;
          font: inherit; font-size: 11px;
        }
        .tr-chart:hover { color: var(--ink); }
        /* Reads as text until you go near it — a sheet of rows, not a list
           of links. Same affordance as the Holdings table. */
        .tr-sym {
          background: none; border: 0; padding: 0; cursor: pointer;
          font: inherit; color: inherit; text-align: left;
          border-bottom: 1px solid transparent;
        }
        .tr-sym:hover { border-bottom-color: var(--brass); }
        /* Small, but never absent. Reading an R off a stop this app invented
           without knowing that is the one mistake this column can cause. */
        .tr-assumed {
          display: block; font-style: normal; font-size: 9px;
          letter-spacing: 0.06em; text-transform: uppercase; color: var(--brass);
        }
        /* Reads as a word rather than a price, because 0.00 in this column
           looks like a broken row and that is exactly the confusion that
           started all this. */
        /* An average of the sells so far reads as a final price unless it
           says otherwise, and a half-sold position's average is not where
           the trade ended. */
        .tr-part {
          display: block; font-style: normal; font-size: 9px;
          letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink3);
        }
        .tr-free {
          font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase;
          color: var(--ink3);
        }
      `}</style>
    </div>
  );
}
