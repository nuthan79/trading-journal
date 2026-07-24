"use client";

import { useState } from "react";
import { X, Check } from "lucide-react";

export default function SettingsSheet({ profile, onSave, onClose }) {
  const [s, setS] = useState({
    journal_name: profile.journal_name || "",
    account_size: String(profile.account_size ?? ""),
    default_risk_pct: String(profile.default_risk_pct ?? ""),
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setS((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({
        journal_name: s.journal_name.trim() || "Breakout Ledger",
        account_size: Number(s.account_size) || 0,
        default_risk_pct: Number(s.default_risk_pct) || 0,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" style={{ maxWidth: 560 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheethead">
          <div className="disp" style={{ fontSize: 16 }}>Setup</div>
          <button className="x" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
          <label className="f"><span>Journal name</span>
            <input className="in" style={{ fontFamily: "Archivo, sans-serif" }}
                   value={s.journal_name} onChange={set("journal_name")} /></label>

          <div className="grid2" style={{ gap: 12 }}>
            <label className="f"><span>Account size — ₹</span>
              <input className="in" inputMode="numeric" value={s.account_size} onChange={set("account_size")} /></label>
            <label className="f"><span>Default risk per trade %</span>
              <input className="in" inputMode="decimal" value={s.default_risk_pct} onChange={set("default_risk_pct")} /></label>
          </div>
          <div className="hint" style={{ marginTop: -8 }}>
            Used to pre-fill the position sizer. Risk % on each trade is always computed
            against this account size.
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10,
                        borderTop: "1px solid var(--rule)", paddingTop: 16 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn" disabled={saving} onClick={submit}>
              <Check size={14} />{saving ? "Saving…" : "Save setup"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
