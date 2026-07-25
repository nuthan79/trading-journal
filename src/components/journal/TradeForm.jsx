"use client";

import { useState } from "react";
import { X, Check } from "lucide-react";
import SymbolSearch from "@/components/SymbolSearch";
import { derivePosition } from "@/lib/positions";
import { rupee, pct } from "@/lib/format";
import { PATTERNS, EXIT_REASONS, MISTAKES, STAGES, slBand } from "@/lib/constants";

const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));

/** See Journal.jsx's withExits — same reasoning, applied to live form state. */
function withExits(t) {
  if (t.status === "closed" && t.exit_date && t.exit_price !== "") {
    return { ...t, exits: [{ exit_date: t.exit_date, quantity: t.quantity, price: t.exit_price }] };
  }
  return { ...t, exits: [] };
}

const blank = () => ({
  status: "open", symbol: "", company: "", exchange: "NSE", side: "long",
  entry_date: new Date().toISOString().slice(0, 10),
  entry_price: "", quantity: "", stop_loss: "",
  pattern: "", pivot_price: "", vol_pct_avg: "", weinstein_stage: "", rs_rank: "",
  exit_date: "", exit_price: "", exit_reason: "", charges: "0",
  mistakes: [], notes: "",
});

const str = (v) => (v === null || v === undefined ? "" : String(v));

function fromInitial(row) {
  return {
    id: row.id,
    status: row.status, symbol: row.symbol, company: row.company || "",
    exchange: row.exchange, side: row.side,
    entry_date: row.entry_date, entry_price: str(row.entry_price),
    quantity: str(row.quantity), stop_loss: str(row.stop_loss),
    pattern: row.pattern || "", pivot_price: str(row.pivot_price),
    vol_pct_avg: str(row.vol_pct_avg), weinstein_stage: str(row.weinstein_stage),
    rs_rank: str(row.rs_rank),
    exit_date: row.exit_date || "", exit_price: str(row.exit_price),
    exit_reason: row.exit_reason || "", charges: str(row.charges ?? 0),
    mistakes: row.mistakes || [], notes: row.notes || "",
  };
}

function toPayload(t) {
  const numOrNull = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
  return {
    ...(t.id ? { id: t.id } : {}),
    symbol: t.symbol.trim().toUpperCase(),
    company: t.company || null,
    exchange: t.exchange,
    side: t.side,
    status: t.status,
    entry_date: t.entry_date,
    entry_price: Number(t.entry_price),
    quantity: Number(t.quantity),
    stop_loss: Number(t.stop_loss),
    pattern: t.pattern || null,
    pivot_price: numOrNull(t.pivot_price),
    vol_pct_avg: numOrNull(t.vol_pct_avg),
    weinstein_stage: t.weinstein_stage ? Number(t.weinstein_stage) : null,
    rs_rank: numOrNull(t.rs_rank),
    exit_date: t.status === "closed" ? (t.exit_date || null) : null,
    exit_price: t.status === "closed" ? numOrNull(t.exit_price) : null,
    exit_reason: t.status === "closed" ? (t.exit_reason || null) : null,
    charges: numOrNull(t.charges) ?? 0,
    mistakes: t.mistakes || [],
    notes: t.notes || null,
  };
}

export default function TradeForm({ initial, accountSize, defaultRiskPct, onSave, onClose }) {
  const [t, setT] = useState(initial ? fromInitial(initial) : blank());
  const [riskPct, setRiskPct] = useState(defaultRiskPct ?? 0.75);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setT((p) => ({ ...p, [k]: e.target.value }));
  const d = derivePosition(withExits(t), accountSize);
  const editing = !!initial;
  const slBandLabel = slBand(d.slPct);

  const toggleMistake = (m) =>
    setT((p) => ({ ...p, mistakes: p.mistakes.includes(m)
      ? p.mistakes.filter((x) => x !== m) : [...p.mistakes, m] }));

  const sizeIt = () => {
    const rps = Math.abs(num(t.entry_price) - num(t.stop_loss));
    if (!(rps > 0) || !(accountSize > 0)) return;
    setT((p) => ({ ...p, quantity: String(Math.floor((accountSize * (riskPct / 100)) / rps)) }));
  };

  const valid = t.symbol.trim() && num(t.entry_price) > 0 &&
    num(t.quantity) > 0 && num(t.stop_loss) > 0 &&
    (t.status === "open" || (isFinite(num(t.exit_price)) && t.exit_date));

  const overRisk = isFinite(d.riskPct) && d.riskPct > 2;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onSave(toPayload(t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheethead">
          <div>
            <div className="eyebrow">{editing ? "Edit trade" : "New trade"}</div>
            <div className="disp" style={{ fontSize: 17, marginTop: 2 }}>
              {t.symbol ? t.symbol.toUpperCase() : "Untitled position"}
            </div>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>

          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Position</div>
            <div className="grid4" style={{ gap: 12 }}>
              <label className="f" style={{ gridColumn: "span 2" }}><span>Symbol</span>
                <SymbolSearch
                  value={t.symbol}
                  exchange={t.exchange}
                  onPick={({ symbol, company, exchange }) =>
                    setT((p) => ({ ...p, symbol, company, exchange }))}
                />
                {t.company && (
                  <div className="hint">{t.company} · {t.exchange}</div>
                )}
              </label>
              <label className="f"><span>Direction</span>
                <select className="in" value={t.side} onChange={set("side")}>
                  <option value="long">Long</option><option value="short">Short</option>
                </select></label>
              <label className="f"><span>Entry date</span>
                <input className="in" type="date" value={t.entry_date} onChange={set("entry_date")} /></label>
            </div>
            <div className="grid3" style={{ gap: 12, marginTop: 12 }}>
              <label className="f"><span>Entry price</span>
                <input className="in" inputMode="decimal" value={t.entry_price} onChange={set("entry_price")} /></label>
              <label className="f"><span>Stop loss</span>
                <input className="in" inputMode="decimal" value={t.stop_loss} onChange={set("stop_loss")} />
                <div className="hint" style={{ color: slBandLabel === "wide" || slBandLabel === "very wide" ? "var(--brass)" : undefined }}>
                  {isFinite(d.slPct) ? `${d.slPct.toFixed(1)}% from entry — ${slBandLabel}` : "How far the stop sits from entry"}
                </div></label>
              <label className="f"><span>Quantity</span>
                <input className="in" inputMode="numeric" value={t.quantity} onChange={set("quantity")} /></label>
            </div>
          </div>

          <div className="readout">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <span className="eyebrow" style={{ color: "var(--ink2)" }}>Size it for me</span>
              <input className="in mono" style={{ width: 68, padding: "4px 7px", fontSize: 13 }}
                     value={riskPct} inputMode="decimal"
                     onChange={(e) => setRiskPct(e.target.value)} />
              <span style={{ fontSize: 12, color: "var(--ink2)" }}>% of account at risk</span>
              <button className="btn ghost sm" type="button" onClick={sizeIt}>Set quantity</button>
            </div>
            <div className="row"><span>Risk per share</span>
              <b>{isFinite(d.riskPerShare) ? d.riskPerShare.toFixed(2) : "—"}</b></div>
            <div className="row"><span>1R — total risk</span>
              <b>{rupee(d.riskAmt)}</b></div>
            <div className="row"><span>Risk as % of account</span>
              <b style={{ color: overRisk ? "var(--short)" : "inherit" }}>{pct(d.riskPct, 2)}</b></div>
            <div className="row"><span>Position value / exposure</span>
              <b>{rupee(d.exposure)}</b></div>
            {overRisk && (
              <div className="warn" style={{ marginTop: 9 }}>
                This position risks more than 2% of the account. Reduce the quantity or tighten the stop.
              </div>
            )}
          </div>

          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>The setup</div>
            <div className="grid4" style={{ gap: 12 }}>
              <label className="f"><span>Base pattern</span>
                <select className="in" value={t.pattern} onChange={set("pattern")}>
                  <option value="">—</option>
                  {PATTERNS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select></label>
              <label className="f"><span>Pivot price</span>
                <input className="in" inputMode="decimal" value={t.pivot_price} onChange={set("pivot_price")} />
                <div className="hint">
                  {isFinite(d.distPivot)
                    ? `Entered ${d.distPivot >= 0 ? "" : "−"}${Math.abs(d.distPivot).toFixed(1)}% ${d.distPivot >= 0 ? "above" : "below"} pivot`
                    : "Sets your extension at entry"}
                </div></label>
              <label className="f"><span>Volume % of avg</span>
                <input className="in" inputMode="decimal" placeholder="240" value={t.vol_pct_avg} onChange={set("vol_pct_avg")} />
                <div className="hint" style={{ color: isFinite(num(t.vol_pct_avg)) && num(t.vol_pct_avg) < 100 ? "var(--short)" : undefined }}>
                  {isFinite(num(t.vol_pct_avg))
                    ? num(t.vol_pct_avg) >= 100
                      ? `${(num(t.vol_pct_avg) - 100).toFixed(0)}% above the 30-day average`
                      : `${(100 - num(t.vol_pct_avg)).toFixed(0)}% below average — thin breakout`
                    : "100 = the 30-day average"}
                </div></label>
              <label className="f"><span>RS rank</span>
                <input className="in" inputMode="numeric" placeholder="1–99" value={t.rs_rank} onChange={set("rs_rank")} /></label>
            </div>
            <label className="f" style={{ marginTop: 12, maxWidth: 280 }}><span>Weinstein stage</span>
              <select className="in" value={t.weinstein_stage} onChange={set("weinstein_stage")}>
                <option value="">—</option>
                {STAGES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select></label>
          </div>

          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Exit</div>
            <div className="seg" style={{ marginBottom: 12 }}>
              <button type="button" data-on={t.status === "open" ? 1 : 0}
                      onClick={() => setT((p) => ({ ...p, status: "open" }))}>Still open</button>
              <button type="button" data-on={t.status === "closed" ? 1 : 0}
                      onClick={() => setT((p) => ({ ...p, status: "closed",
                        exit_date: p.exit_date || new Date().toISOString().slice(0, 10) }))}>Closed</button>
            </div>
            {t.status === "closed" && (
              <>
                <div className="grid3" style={{ gap: 12 }}>
                  <label className="f"><span>Exit price</span>
                    <input className="in" inputMode="decimal" value={t.exit_price} onChange={set("exit_price")} /></label>
                  <label className="f"><span>Exit date</span>
                    <input className="in" type="date" value={t.exit_date} onChange={set("exit_date")} /></label>
                  <label className="f"><span>Why you exited</span>
                    <select className="in" value={t.exit_reason} onChange={set("exit_reason")}>
                      <option value="">—</option>
                      {EXIT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select></label>
                </div>
                <div className="grid3" style={{ gap: 12, marginTop: 12 }}>
                  <label className="f"><span>Charges (brokerage, STT, etc.)</span>
                    <input className="in" inputMode="decimal" value={t.charges} onChange={set("charges")} /></label>
                </div>
                {isFinite(d.r) && (
                  <div className="readout" style={{ marginTop: 12 }}>
                    <div className="row"><span>Realised P&amp;L (net of charges)</span>
                      <b className={d.pnl >= 0 ? "pos" : "neg"}>{rupee(d.pnl)}</b></div>
                    <div className="row"><span>Outcome in R</span>
                      <b className={d.r >= 0 ? "pos" : "neg"} style={{ fontSize: 15 }}>{d.r >= 0 ? "+" : ""}{d.r.toFixed(2)}R</b></div>
                    {isFinite(d.heldDays) && (
                      <div className="row"><span>Held</span><b>{d.heldDays} days</b></div>)}
                  </div>
                )}
                <div style={{ marginTop: 14 }}>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>Anything you got wrong</div>
                  <div className="chips">
                    {MISTAKES.map((m) => (
                      <button key={m} type="button" className="chip rd" data-on={t.mistakes.includes(m) ? 1 : 0}
                              onClick={() => toggleMistake(m)}>{m}</button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <label className="f"><span>Notes on this trade</span>
            <textarea className="in" rows={3} value={t.notes} onChange={set("notes")}
              placeholder="What the chart looked like, what the market was doing, what you were thinking." /></label>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end",
                        borderTop: "1px solid var(--rule)", paddingTop: 16 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn" disabled={!valid || saving} style={{ opacity: valid ? 1 : 0.4 }}
                    onClick={submit}>
              <Check size={14} />{saving ? "Saving…" : editing ? "Save changes" : "Log trade"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
