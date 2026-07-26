"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { rupee, pct } from "@/lib/format";

/**
 * First run.
 *
 * Every risk percentage, every return figure and the whole drawdown reading is
 * computed against account size. Left at its default it makes each of those
 * numbers quietly wrong — not missing, which you'd notice, but plausible and
 * incorrect, which you wouldn't. So this is asked once, before the dashboard
 * renders anything.
 *
 * Two fields. Anything else can be discovered later in settings; this is the
 * minimum that has to be true before a number means what it says.
 */

const PRESET_RISK = [0.5, 0.75, 1.0, 1.5];

export default function FirstRun({ onComplete, initialName = "" }) {
  const [name, setName] = useState(initialName || "");
  const [capital, setCapital] = useState("");
  const [risk, setRisk] = useState("0.75");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const capitalNum = Number(String(capital).replace(/[^0-9.]/g, ""));
  const riskNum = Number(risk);
  const valid = capitalNum > 0 && riskNum > 0 && riskNum <= 5;

  const perTrade = valid ? (capitalNum * riskNum) / 100 : NaN;

  const submit = async () => {
    if (!valid) return;
    setBusy(true); setErr("");
    try {
      await onComplete({
        journal_name: name.trim() || "Trading Journal",
        account_size: capitalNum,
        default_risk_pct: riskNum,
        onboarded_at: new Date().toISOString(),
      });
    } catch (e) {
      setErr(e.message || "Could not save. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="fr-wrap">
      <div className="fr-intro">
        <div className="eyebrow">Before you start</div>
        <h1 className="disp fr-h1">Two things to set</h1>
        <p className="fr-lede">
          Every figure in this journal is measured against these. They can be changed
          later in settings, but the numbers will only mean what they say once
          they're right.
        </p>
      </div>

      <div className="fr-card">
        <label className="f fr-field">
          <span>Account size — rupees</span>
          <input
            className="in fr-big"
            inputMode="numeric"
            placeholder="1000000"
            value={capital}
            autoFocus
            onChange={(e) => setCapital(e.target.value)}
          />
          <div className="fr-help">
            Your own trading capital. If you use margin, enter what's yours rather
            than your buying power — otherwise risk percentages are measured against
            borrowed money and read lower than they are.
            {capitalNum > 0 && (
              <div className="fr-echo mono">{rupee(capitalNum, { compact: true })}</div>
            )}
          </div>
        </label>

        <label className="f fr-field">
          <span>Risk per trade</span>
          <div className="fr-risk">
            {PRESET_RISK.map((v) => (
              <button
                key={v}
                type="button"
                className="fr-chip"
                data-on={Number(risk) === v ? 1 : 0}
                onClick={() => setRisk(String(v))}
              >
                {v}%
              </button>
            ))}
            <input
              className="in fr-custom"
              inputMode="decimal"
              value={risk}
              onChange={(e) => setRisk(e.target.value)}
              aria-label="Custom risk percent"
            />
          </div>
          <div className="fr-help">
            The default the position sizer starts from. You can override it on any
            single trade.
            {isFinite(perTrade) && (
              <div className="fr-echo mono">
                {pct(riskNum, 2)} of {rupee(capitalNum)} = {rupee(perTrade)} at risk per trade
              </div>
            )}
          </div>
        </label>

        <label className="f fr-field">
          <span>Journal name — optional</span>
          <input
            className="in"
            style={{ fontFamily: "Archivo, sans-serif" }}
            placeholder="Trading Journal"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        {err && <div className="warn">{err}</div>}

        <button
          className="btn fr-go"
          onClick={submit}
          disabled={!valid || busy}
        >
          <Check size={14} />
          {busy ? "Saving" : "Start journalling"}
        </button>
      </div>

      <style jsx>{`
        .fr-wrap { max-width: 520px; margin: 0 auto; padding: 64px 20px 90px; }
        .fr-intro { margin-bottom: 22px; }
        .fr-h1 { font-size: 25px; margin: 7px 0 10px; }
        .fr-lede {
          margin: 0; font-size: 14px; line-height: 1.62; color: var(--ink2);
          max-width: 460px; text-wrap: pretty;
        }
        .fr-card {
          border: 1px solid var(--rule); background: var(--card);
          border-radius: 3px; padding: 22px;
          display: flex; flex-direction: column; gap: 22px;
        }
        .fr-field { display: block; }
        .fr-big { font-size: 19px; padding: 11px; }
        .fr-help {
          font-size: 11.5px; color: var(--ink3); line-height: 1.6;
          margin-top: 7px; text-wrap: pretty;
        }
        .fr-echo {
          margin-top: 6px; color: var(--ink2); font-size: 12px;
          font-variant-numeric: tabular-nums;
        }
        .fr-risk { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .fr-chip {
          border: 1px solid var(--rule); background: var(--card); color: var(--ink2);
          padding: 8px 13px; border-radius: 2px; font-size: 13px; font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .fr-chip[data-on="1"] {
          background: var(--ink); color: var(--paper); border-color: var(--ink);
        }
        .fr-custom { width: 74px; padding: 8px 9px; font-size: 13px; }
        .fr-go { justify-content: center; padding: 12px; }
        .fr-go:disabled { opacity: 0.4; cursor: default; }
      `}</style>
    </div>
  );
}
