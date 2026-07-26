"use client";

import { useMemo, useState } from "react";
import { X, Check } from "lucide-react";
import { BROKER_PRESETS, mergeConfig } from "@/lib/charges";
import { useAutosave, loadDraft, DRAFT_KEYS } from "@/lib/useAutosave";

const STATUTORY_FIELDS = [
  { k: "sttPct", label: "STT %", hint: "of turnover, both legs" },
  { k: "exchangeNsePct", label: "NSE txn %", hint: "of turnover, both legs" },
  { k: "exchangeBsePct", label: "BSE txn %", hint: "of turnover, both legs" },
  { k: "sebiPct", label: "SEBI %", hint: "of turnover, both legs" },
  { k: "stampDutyPct", label: "Stamp duty %", hint: "of turnover, buy leg only" },
  { k: "gstPct", label: "GST %", hint: "on brokerage + fees" },
];

// JSON has no Infinity — the "no cap" preset would otherwise round-trip
// through profiles.charge_config as null, and null reads back as a cap of
// zero rather than no cap at all. A large finite number behaves identically
// in the Math.min(pct, cap) comparison and survives storage intact.
const UNCAPPED = 1e15;
const forSave = (cfg) => ({
  ...cfg,
  brokerageCap: cfg.brokerageCap === Infinity ? UNCAPPED : cfg.brokerageCap,
});
// Inverse of forSave — a drafted "no cap" preset round-trips through
// localStorage the same way it round-trips through Supabase's jsonb column
// (JSON has no Infinity), so it needs the same sentinel conversion back.
const fromDraftCfg = (cfg) => ({
  ...cfg,
  brokerageCap: cfg.brokerageCap === UNCAPPED ? Infinity : cfg.brokerageCap,
});

export default function SettingsSheet({ profile, onSave, onClose }) {
  const persisted = loadDraft(DRAFT_KEYS.settings);

  const [s, setS] = useState(persisted?.s ?? {
    journal_name: profile.journal_name || "",
    account_size: String(profile.account_size ?? ""),
    default_risk_pct: String(profile.default_risk_pct ?? ""),
  });
  const [cfg, setCfg] = useState(() =>
    persisted?.cfg ? fromDraftCfg(persisted.cfg) : mergeConfig(profile.charge_config)
  );
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setS((p) => ({ ...p, [k]: e.target.value }));
  const setRate = (k) => (e) => {
    const v = e.target.value;
    setCfg((p) => ({ ...p, [k]: v === "" ? "" : Number(v) }));
  };

  const { clear: clearDraft } = useAutosave(DRAFT_KEYS.settings, { s, cfg: forSave(cfg) });
  const closeAndClear = () => { clearDraft(); onClose(); };

  const presetName = useMemo(() => {
    for (const [name, preset] of Object.entries(BROKER_PRESETS)) {
      if (Object.entries(preset).every(([k, v]) => cfg[k] === v)) return name;
    }
    return "";
  }, [cfg]);

  const applyPreset = (name) => {
    if (!BROKER_PRESETS[name]) return;
    setCfg((p) => ({ ...p, ...BROKER_PRESETS[name] }));
  };

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({
        journal_name: s.journal_name.trim() || "Breakout Ledger",
        account_size: Number(s.account_size) || 0,
        default_risk_pct: Number(s.default_risk_pct) || 0,
        charge_config: forSave(cfg),
      });
      clearDraft();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && closeAndClear()}>
      <div className="sheet" style={{ maxWidth: 560 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheethead">
          <div className="disp" style={{ fontSize: 16 }}>Setup</div>
          <button className="x" onClick={closeAndClear} aria-label="Close"><X size={19} /></button>
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

          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Charges</div>
            <div className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
              Drives the auto-calculated figure in the trade form. Statutory rates apply to
              everyone the same way; brokerage is set by your broker's plan.
            </div>

            <label className="f" style={{ marginBottom: 12 }}><span>Broker plan</span>
              <select className="in" value={presetName} onChange={(e) => applyPreset(e.target.value)}>
                <option value="" disabled>Custom — doesn't match a preset</option>
                {Object.keys(BROKER_PRESETS).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <div className="hint">
                Sets brokerage and DP charges. Re-select if your broker changes its plan.
              </div>
            </label>

            <div className="grid3" style={{ gap: 10 }}>
              {STATUTORY_FIELDS.map((f) => (
                <label key={f.k} className="f">
                  <span>{f.label}</span>
                  <input className="in mono" inputMode="decimal"
                         value={cfg[f.k] ?? ""} onChange={setRate(f.k)} />
                  <div className="hint">{f.hint}</div>
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10,
                        borderTop: "1px solid var(--rule)", paddingTop: 16 }}>
            <button className="btn ghost" onClick={closeAndClear}>Cancel</button>
            <button className="btn" disabled={saving} onClick={submit}>
              <Check size={14} />{saving ? "Saving…" : "Save setup"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
