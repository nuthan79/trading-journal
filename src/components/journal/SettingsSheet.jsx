"use client";

import { useMemo, useState } from "react";
import { X, Check, Upload, Ruler } from "lucide-react";
import { BROKER_PRESETS, US_BROKER_PRESETS, mergeConfig, mergeUsConfig } from "@/lib/charges";
import { useAutosave, loadDraft, DRAFT_KEYS } from "@/lib/useAutosave";
import { mtfPrefs } from "@/lib/mtf";
import { SHOW_SETUP_TRADES } from "@/lib/flags";
import OwnSetups from "./OwnSetups";
import { regionSettings, regionSettingsPatch, hasMtf, region as regionInfo,
         DEFAULT_REGION } from "@/lib/regions";
import { rupee } from "@/lib/format";

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

export default function SettingsSheet({ profile, onSave, onClose, onNavigate,
                                       needStopsCount = 0, trades = [], onProfileChange,
                                       bookRegion = DEFAULT_REGION, rate = 0 }) {
  const persisted = loadDraft(DRAFT_KEYS.settings);

  /* Each book is funded separately: the account size and risk % belong to the
     market being read, not to the user. India keeps the columns it always
     had — see regionSettings — so nothing about an Indian journal moves. */
  const mine = regionSettings(profile, bookRegion);
  const book = regionInfo(bookRegion);

  /* What the MTF settings are now — the profile's, or the defaults a profile
     without them (before migration 050) is calculated with. */
  const mtfNow = mtfPrefs(profile);
  /* The draft is laid OVER these, so a Setup draft saved before the MTF fields
     existed still opens with them filled in rather than blank. */
  const [s, setS] = useState({
    journal_name: profile.journal_name || "",
    account_size: String(mine.account_size ?? ""),
    default_risk_pct: String(mine.default_risk_pct ?? ""),
    mtf_in_pnl: mtfNow._mtfInPnl,
    ...(persisted?.s || {}),
  });
  /* The charge config of THIS book: India's statutory-plus-brokerage shape,
     or the US commission one. Two different sets of fields, so they cannot
     share a default. */
  const [cfg, setCfg] = useState(() =>
    persisted?.cfg ? fromDraftCfg(persisted.cfg)
      : bookRegion === DEFAULT_REGION
        ? mergeConfig(mine.charge_config)
        : mergeUsConfig(mine.charge_config)
  );
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setS((p) => ({ ...p, [k]: e.target.value }));

  const { clear: clearDraft } = useAutosave(DRAFT_KEYS.settings, { s, cfg: forSave(cfg) });
  const closeAndClear = () => { clearDraft(); onClose(); };

  const presetName = useMemo(() => {
    const presets = bookRegion === DEFAULT_REGION ? BROKER_PRESETS : US_BROKER_PRESETS;
    for (const [name, preset] of Object.entries(presets)) {
      if (Object.entries(preset).every(([k, v]) => cfg[k] === v)) return name;
    }
    return "";
  }, [cfg]);

  const applyPreset = (name) => {
    const presets = bookRegion === DEFAULT_REGION ? BROKER_PRESETS : US_BROKER_PRESETS;
    if (!presets[name]) return;
    setCfg((p) => ({ ...p, ...presets[name] }));
  };

  const submit = async () => {
    setSaving(true);
    try {
      const inPnl = s.mtf_in_pnl !== false;
      await onSave({
        journal_name: s.journal_name.trim() || "Breakout Ledger",
        /* Into the columns for India, into region_settings for anywhere else,
           merged so another market's settings survive this write. */
        ...regionSettingsPatch(profile, bookRegion, {
          account_size: Number(s.account_size) || 0,
          default_risk_pct: Number(s.default_risk_pct) || 0,
          charge_config: forSave(cfg),
        }),
        /*
         * ONLY WHAT CHANGED. Sent every time, this would make every Setup save
         * fail on a database where migration 050 has not run — a user changing
         * their account size told the save failed over a margin setting they
         * never touched.
         */
        ...(inPnl !== mtfNow._mtfInPnl ? { mtf_in_pnl: inPnl } : {}),
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
            {/* The sign of the book being funded. "Account size — ₹" over a
                US book was the whole bug: the field is dollars and the label
                said otherwise. */}
            <label className="f"><span>Account size — {book.sign}</span>
              <input className="in" inputMode="numeric" value={s.account_size} onChange={set("account_size")} /></label>
            <label className="f"><span>Default risk per trade %</span>
              <input className="in" inputMode="decimal" value={s.default_risk_pct} onChange={set("default_risk_pct")} /></label>
          </div>
          <div className="hint" style={{ marginTop: -8 }}>
            Used to pre-fill the position sizer. Risk % on each trade is always computed
            against this account size.
            {/* An Indian trader funding a US book thinks in rupees, so the
                equivalent is stated rather than left to be worked out. One
                rate, today's, and it says so. */}
            {book.currency !== "INR" && rate > 0 && Number(s.account_size) > 0 && (
              <> Roughly {rupee(Number(s.account_size) * rate, { region: "IN" })} at
                today&apos;s rate, ₹{rate.toFixed(2)} to the {book.currency === "USD" ? "dollar" : book.currency}.</>
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Charges</div>
            <div className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
              {bookRegion === DEFAULT_REGION
                ? <>Drives the auto-calculated figure in the trade form. Pick the plan your
                  broker charges you on. STT, GST, stamp duty and the exchange and SEBI
                  fees are the same for every trader in the country — we keep those
                  current, so there is nothing here to maintain.</>
                /* The American bill is almost all commission: the two regulatory
                   fees are cents, sell-side only, and set by the SEC and FINRA
                   on dates they announce. */
                : <>Drives the auto-calculated figure in the trade form. Pick what your
                  broker charges to execute. The SEC and FINRA fees on a sale are set
                  nationally and change on announced dates — we keep those current.</>}
            </div>

            <label className="f" style={{ marginBottom: 12 }}><span>Broker plan</span>
              <select className="in" value={presetName} onChange={(e) => applyPreset(e.target.value)}>
                <option value="" disabled>Custom — doesn't match a preset</option>
                {Object.keys(bookRegion === DEFAULT_REGION ? BROKER_PRESETS : US_BROKER_PRESETS).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <div className="hint">
                Sets brokerage and DP charges. Re-select if your broker changes its plan.
              </div>
            </label>

            {/* The statutory rates were six editable boxes here until
                2026-09-21. They are set by the government and the exchanges
                and are identical for everyone, so the boxes asked a question
                with one right answer and accepted every wrong one — and a
                mistyped STT understates every charge and every net P&L in the
                journal with nothing on screen to explain it. They live in
                `charges.js` now; `mergeConfig` puts them back over anything a
                profile still carries. */}
          </div>

          {/*
            * MARGIN (MTF). The broker's pledge and unpledge fees, and whether
            * MTF comes out of P&L and R. Here rather than on each trade: they
            * are the same on every margin trade, and the choice is about how
            * this user reads their whole record.
            */}
          {/* MTF is an Indian broker product — pledged shares, a per-lakh daily
              rate, a pledge fee each way. US margin is an interest rate on a
              balance, which is a different model and not this one, so the
              section is absent rather than empty. */}
          {hasMtf(bookRegion) && (
          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Margin (MTF)</div>
            <div className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
              Used on trades you mark as bought on MTF. The interest rate is set on each
              trade, since it is the one part that is yours: pledge and unpledge fees are
              ₹18 a side everywhere and are kept current for you.
            </div>
            {/* Same reasoning as the statutory rates above: the depository
                charges ₹18 to pledge and ₹18 to release, at every broker. */}
            <div className="f"><span>Deduct MTF from P&amp;L and R?</span></div>
            <div className="st-choice" role="radiogroup" aria-label="Deduct MTF from P&L and R?">
              <label>
                <input type="radio" name="mtf_in_pnl" checked={s.mtf_in_pnl !== false}
                       onChange={() => setS((p) => ({ ...p, mtf_in_pnl: true }))} />
                <span>
                  <b>Yes, deduct it</b>
                  <i>P&amp;L and R show what you kept after paying MTF.</i>
                </span>
              </label>
              <label>
                <input type="radio" name="mtf_in_pnl" checked={s.mtf_in_pnl === false}
                       onChange={() => setS((p) => ({ ...p, mtf_in_pnl: false }))} />
                <span>
                  <b>No, show it separately</b>
                  <i>P&amp;L and R show the trade alone. MTF is listed on its own.</i>
                </span>
              </label>
            </div>
          </div>
          )}

          {/* Saved as they are edited rather than with this sheet — see the
              note in OwnSetups: a rename writes the trades too, and a list
              saved without them would split one setup across two names. */}
          <OwnSetups profile={profile} trades={trades} onProfileChange={onProfileChange} />

          {SHOW_SETUP_TRADES && (
          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Trades</div>
            <div className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
              Bring in closed trades from your broker's tax P&amp;L or capital gains
              report. Charges come from the file where the broker states them, and
              are worked out from the statutory rates where they don&apos;t.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn ghost" onClick={() => onNavigate?.("/import")}>
                <Upload size={13} />Import trades
              </button>
              {/* Filling stops is a chore done over several sittings, so it needs
                  its own way in rather than living only at the end of an import. */}
              <button className="btn ghost" onClick={() => onNavigate?.("/stops")}
                      disabled={!needStopsCount}
                      style={{ opacity: needStopsCount ? 1 : 0.45 }}>
                <Ruler size={13} />
                {needStopsCount ? `Add ${needStopsCount} missing stop${needStopsCount === 1 ? "" : "s"}` : "No stops missing"}
              </button>
            </div>
          </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10,
                        borderTop: "1px solid var(--rule)", paddingTop: 16 }}>
            <button className="btn ghost" onClick={closeAndClear}>Cancel</button>
            <button className="btn" disabled={saving} onClick={submit}>
              <Check size={14} />{saving ? "Saving…" : "Save setup"}
            </button>
          </div>
        </div>
      </div>
      <style jsx>{`
        /* Two choices, each with the sentence that says what it does. */
        .st-choice { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
        .st-choice label {
          display: flex; gap: 10px; align-items: flex-start; cursor: pointer;
          border: 1px solid var(--rule); border-radius: 3px; padding: 10px 12px;
          background: var(--card);
        }
        .st-choice input { margin: 3px 0 0; accent-color: var(--ink); flex: none; }
        .st-choice span { display: flex; flex-direction: column; gap: 2px; }
        .st-choice b { font-size: 13px; font-weight: 600; color: var(--ink); }
        .st-choice i { font-style: normal; font-size: 12px; color: var(--ink3); line-height: 1.45; }
      `}</style>
    </div>
  );
}
