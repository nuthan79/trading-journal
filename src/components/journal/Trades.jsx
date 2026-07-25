"use client";

import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Download } from "lucide-react";
import { rupee, rfmt, pct } from "@/lib/format";

const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));

function exportCsv(all) {
  const cols = ["symbol", "exchange", "side", "entry_date", "entry_price", "quantity", "stop_loss",
    "riskAmt", "riskPct", "pattern", "pivot_price", "distPivot", "vol_pct_avg", "weinstein_stage", "rs_rank",
    "exit_date", "exit_price", "exit_reason", "charges", "pnl", "r", "heldDays", "mistakes", "notes"];
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

export default function Trades({ all, onEdit, onDelete, onNew }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ k: "entry_date", dir: -1 });

  const rows = useMemo(() => {
    let r = all;
    if (filter === "open") r = r.filter((t) => t.status === "open");
    if (filter === "closed") r = r.filter((t) => t.status === "closed");
    if (filter === "winners") r = r.filter((t) => t.r > 0);
    if (filter === "losers") r = r.filter((t) => isFinite(t.r) && t.r <= 0);
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
  }, [all, filter, q, sort]);

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
      <div className="sechead">
        <div className="seg">
          {[["all","All"],["open","Open"],["closed","Closed"],["winners","Winners"],["losers","Losers"]].map(([id,l]) => (
            <button key={id} data-on={filter === id ? 1 : 0} onClick={() => setFilter(id)}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="in" style={{ width: 180, padding: "6px 10px", fontSize: 13 }}
                 placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
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
              {th("symbol", "Symbol")}
              {th("entry_date", "In")}
              {th("exit_date", "Out")}
              {th("pattern", "Pattern")}
              {th("distPivot", "Δ pivot", "num")}
              {th("vol_pct_avg", "Vol %", "num")}
              {th("weinstein_stage", "Stg", "num")}
              {th("rs_rank", "RS", "num")}
              {th("entry_price", "Entry", "num")}
              {th("stop_loss", "Stop", "num")}
              {th("quantity", "Qty", "num")}
              {th("riskPct", "Risk", "num")}
              {th("pnl", "P&L", "num")}
              {th("r", "R", "num")}
              <th></th>
            </tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td>
                    <b className="disp">{t.symbol}</b>
                    <span style={{ color: "var(--ink3)", fontSize: 11 }}> {t.exchange}</span>
                    {t.side === "short" && <span style={{ color: "var(--short)", fontSize: 10 }}> ▾</span>}
                    {(t.mistakes || []).length > 0 && (
                      <span title={t.mistakes.join(", ")}
                            style={{ color: "var(--brass)", fontSize: 11, marginLeft: 4 }}>▲</span>)}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{t.entry_date}</td>
                  <td className="mono" style={{ fontSize: 12, color: t.exit_date ? "inherit" : "var(--ink3)" }}>
                    {t.exit_date || "open"}</td>
                  <td style={{ fontSize: 12, color: "var(--ink2)" }}>{t.pattern || "—"}</td>
                  <td className="num" style={{ fontSize: 12,
                        color: t.distPivot > 5 ? "var(--short)" : "inherit" }}>
                    {isFinite(t.distPivot) ? `${t.distPivot >= 0 ? "+" : ""}${t.distPivot.toFixed(1)}%` : "—"}</td>
                  <td className="num" style={{ fontSize: 12,
                        color: isFinite(num(t.vol_pct_avg)) && num(t.vol_pct_avg) < 100 ? "var(--short)" : "inherit" }}>
                    {t.vol_pct_avg ? `${t.vol_pct_avg}%` : "—"}</td>
                  <td className="num" style={{ fontSize: 12 }}>{t.weinstein_stage || "—"}</td>
                  <td className="num" style={{ fontSize: 12 }}>{t.rs_rank || "—"}</td>
                  <td className="num">{Number(t.entry_price).toFixed(2)}</td>
                  <td className="num">{Number(t.stop_loss).toFixed(2)}</td>
                  <td className="num">{t.quantity}</td>
                  <td className="num" style={{ fontSize: 12 }}>{pct(t.riskPct, 2)}</td>
                  <td className={`num ${isFinite(t.pnl) ? (t.pnl >= 0 ? "pos" : "neg") : ""}`}>
                    {isFinite(t.pnl) ? rupee(t.pnl) : "—"}</td>
                  <td className={`num ${isFinite(t.r) ? (t.r >= 0 ? "pos" : "neg") : ""}`}
                      style={{ fontWeight: 500 }}>{isFinite(t.r) ? rfmt(t.r) : "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="x" onClick={() => onEdit(t)} aria-label="Edit"><Pencil size={13} /></button>
                    <button className="x" onClick={() => onDelete(t.id)} aria-label="Delete"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {rows.length > 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          ▲ marks a trade where you tagged a mistake · ▾ marks a short · click any column to sort
        </div>
      )}
    </div>
  );
}
