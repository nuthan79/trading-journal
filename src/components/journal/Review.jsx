"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, track } from "@/lib/db";
import { reviewFindings } from "@/lib/analysis";
import { classifyRegime, regimeIndex, REGIME_LABEL } from "@/lib/market";
import { signedPct } from "@/lib/format";

/**
 * Behavioural review — arithmetic findings from the trader's own closed
 * trades: stop discipline, sizing, entries, exits, and how the trading
 * tracked the market regime. Every figure here is computed in
 * src/lib/analysis.js, so the page owes nothing to a third party and costs
 * nothing to run.
 *
 * A model-written summary used to sit on top of this. It was removed along
 * with its route: the endpoint spent an API key on every call and had no
 * authentication, which is fine for a private tool and untenable for a paid
 * one. The findings below were always the substance; the prose was a layer.
 */

const SEVERITY = {
  critical: { label: "Critical", color: "var(--short)" },
  warning: { label: "Warning", color: "var(--brass)" },
  watch: { label: "Watch", color: "var(--ink3)" },
  good: { label: "Good", color: "var(--long)" },
};

const SEVERITY_ORDER = ["critical", "warning", "watch", "good"];

const REGIME_COLOR = {
  uptrend: "var(--long)",
  pressure: "var(--brass)",
  correction: "var(--short)",
  unknown: "var(--ink3)",
};

function FindingCard({ f }) {
  const sev = SEVERITY[f.severity] || SEVERITY.watch;
  return (
    <div className="rv-card" style={{ borderLeftColor: sev.color }}>
      <div className="rv-card-head">
        <span className="rv-tag" style={{ color: sev.color, borderColor: sev.color }}>{sev.label}</span>
        <div className="rv-title">{f.title}</div>
      </div>
      <p className="rv-detail">{f.detail}</p>
      {f.evidence && (
        <details className="rv-evidence">
          <summary>Evidence</summary>
          <pre className="mono">{JSON.stringify(f.evidence, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

export default function Review({ closed, stats, all }) {
  const [market, setMarket] = useState({ loading: true, error: null, classified: [] });

  // Opening the review is the habit this journal is actually for — recording
  // trades is bookkeeping, reading them back is the point.
  useEffect(() => { track("review_opened"); }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch("/api/market?index=NIFTY500&range=3y");
        const json = await res.json();
        if (!alive) return;
        const classified = classifyRegime(json.history || []);
        setMarket({ loading: false, error: classified.length ? null : (json.error || null), classified });
      } catch (err) {
        if (alive) setMarket({ loading: false, error: err.message, classified: [] });
      }
    })();
    return () => { alive = false; };
  }, []);

  const regimes = useMemo(
    () => (market.classified.length ? regimeIndex(market.classified) : null),
    [market.classified]
  );

  const result = useMemo(
    () => reviewFindings(closed, { regimes, stats, all }),
    [closed, regimes, stats, all]
  );

  const groups = useMemo(() => {
    const by = { critical: [], warning: [], watch: [], good: [] };
    result.findings.forEach((f) => { if (by[f.severity]) by[f.severity].push(f); });
    return by;
  }, [result]);

  const last = market.classified[market.classified.length - 1];
  const pos50 = last?.ma50 ? ((last.close - last.ma50) / last.ma50) * 100 : null;
  const pos200 = last?.ma200 ? ((last.close - last.ma200) / last.ma200) * 100 : null;

  if (!closed.length) {
    return (
      <div className="sec card empty">
        <div className="eyebrow">Review</div>
        <p>This reads your closed trades for behavioural patterns — stop discipline, sizing,
          entries, exits, and how well your activity tracks the market. Log a few closed
          trades and come back.</p>
      </div>
    );
  }

  return (
    <div className="sec">
      <div className="rv-strip">
        {market.loading ? (
          <span className="rv-dim">Loading market regime…</span>
        ) : last ? (
          <>
            <span className="rv-dot" style={{ background: REGIME_COLOR[last.regime] }} />
            <b>{REGIME_LABEL[last.regime]}</b>
            <span className="rv-dim">NIFTY 500 · {last.close.toFixed(0)}</span>
            {pos50 != null && <span className="rv-dim">{signedPct(pos50)} vs 50DMA</span>}
            {pos200 != null && <span className="rv-dim">{signedPct(pos200)} vs 200DMA</span>}
          </>
        ) : (
          <span className="rv-dim">
            Market regime unavailable{market.error ? ` — ${market.error}` : ""}. Findings below still work.
          </span>
        )}
      </div>

      {result.provisional && (
        <div className="warn" style={{ marginBottom: 18 }}>
          Only {result.sample} closed trades in this sample — treat everything below as an early
          signal, not a conclusion, until you're past about 30.
        </div>
      )}

      {result.findings.length === 0 ? (
        <div className="card empty">
          <div className="eyebrow">Not enough data yet</div>
          <p>Each check here needs a minimum sample before it will speak — most start around
            8–15 closed trades in the relevant category. Keep logging and they'll fill in.</p>
        </div>
      ) : (
        SEVERITY_ORDER.map((sevKey) =>
          groups[sevKey].length ? (
            <div key={sevKey} className="rv-group">
              <div className="eyebrow" style={{ color: SEVERITY[sevKey].color, marginBottom: 9 }}>
                {SEVERITY[sevKey].label} · {groups[sevKey].length}
              </div>
              {groups[sevKey].map((f) => <FindingCard key={f.id} f={f} />)}
            </div>
          ) : null
        )
      )}

      <style jsx global>{`
        .rv-strip {
          display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
          padding: 10px 14px; border: 1px solid var(--rule); border-radius: 3px;
          background: var(--card); margin-bottom: 18px; font-size: 12.5px;
        }
        .rv-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
        .rv-dim { color: var(--ink3); }

        .rv-group { margin-bottom: 22px; }

        .rv-card {
          border: 1px solid var(--rule); border-left: 3px solid var(--rule);
          background: var(--card); border-radius: 2px;
          padding: 13px 16px 14px; margin-bottom: 10px;
        }
        .rv-card-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
        .rv-tag {
          border: 1px solid currentColor; border-radius: 999px; padding: 2px 8px;
          font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
          flex: none;
        }
        .rv-title { font-size: 14.5px; font-weight: 600; }
        .rv-detail { font-size: 13px; line-height: 1.65; color: var(--ink2); margin: 9px 0 0; }

        .rv-evidence { margin-top: 10px; }
        .rv-evidence summary {
          cursor: pointer; font-size: 10.5px; font-weight: 600; letter-spacing: 0.09em;
          text-transform: uppercase; color: var(--ink3);
        }
        .rv-evidence summary:hover { color: var(--ink2); }
        .rv-evidence pre {
          background: var(--paper); border: 1px solid var(--rule); border-radius: 2px;
          padding: 10px 12px; margin-top: 8px; font-size: 11.5px; line-height: 1.6;
          overflow-x: auto; color: var(--ink2);
        }

      `}</style>
    </div>
  );
}
