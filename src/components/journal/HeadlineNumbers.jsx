"use client";

import { useMemo } from "react";
import { headline } from "@/lib/calc";
import { rupee, rfmt, pct, days } from "@/lib/format";

/**
 * The headline block: eighteen numbers, two rows, no chrome.
 *
 * Colour is used sparingly and only where a sign genuinely carries meaning.
 * Win rate, profit factor and hold time are deliberately left neutral — a 35%
 * win rate isn't bad and a 65% one isn't good, so tinting them would be
 * editorialising rather than informing.
 */

function Cell({ label, value, tone, hint }) {
  return (
    <div className="hn-cell" title={hint || undefined}>
      <div className={`hn-v mono ${tone || ""}`}>{value}</div>
      <div className="hn-l">{label}</div>
    </div>
  );
}

const sign = (v) => (!isFinite(v) ? "" : v > 0 ? "pos" : v < 0 ? "neg" : "");

export default function HeadlineNumbers({ closed, openingCapital, flows = [] }) {
  const h = useMemo(
    () => headline(closed, { openingCapital, flows }),
    [closed, openingCapital, flows]
  );

  if (!h.n) {
    return (
      <div className="hn-empty">
        <div className="eyebrow">Headline numbers</div>
        <p>These fill in as you close trades. Everything here is derived — nothing to enter.</p>
      </div>
    );
  }

  const cells = [
    { label: "Net P&L", value: rupee(h.netPnl), tone: sign(h.netPnl),
      hint: `After ${rupee(h.charges)} of charges` },
    { label: "Return on capital", value: pct(h.returnOnCapital), tone: sign(h.returnOnCapital),
      hint: "Cumulative, not annualised" },
    { label: "Total R", value: rfmt(h.totalR), tone: sign(h.totalR) },
    { label: "Expectancy", value: rfmt(h.expectancy), tone: sign(h.expectancy),
      hint: "Average R per trade — the number that travels between traders" },
    { label: "Win rate", value: pct(h.winRate) },
    { label: "Profit factor", value: isFinite(h.profitFactor) ? h.profitFactor.toFixed(2) : "∞" },
    { label: "Avg win", value: rfmt(h.avgWin), tone: "pos" },
    { label: "Avg loss", value: rfmt(-h.avgLoss), tone: "neg" },
    { label: "Payoff ratio", value: isFinite(h.payoff) ? h.payoff.toFixed(2) : "∞",
      hint: "Average win divided by average loss" },

    { label: "Max DD (R)", value: `${h.maxDD.toFixed(2)}R`, tone: "neg",
      hint: "Deepest peak-to-trough run in risk units" },
    { label: "Max DD (%)", value: pct(h.maxDDPct), tone: "neg",
      hint: `${rupee(h.maxDDAmt)} at the worst point — what you actually had to sit through` },
    { label: "Win streak", value: h.bestW },
    { label: "Loss streak", value: h.worstL, tone: h.worstL >= 6 ? "neg" : "" },
    { label: "Best trade", value: rfmt(h.best), tone: "pos" },
    { label: "Worst trade", value: rfmt(h.worst), tone: "neg" },
    { label: "Avg hold", value: days(h.avgHold) },
    { label: "Green months", value: `${h.months.green}/${h.months.total}` },
    { label: "Green quarters", value: `${h.quarters.green}/${h.quarters.total}` },
  ];

  // The honest quality measure: return earned per unit of drawdown endured
  const quality = isFinite(h.quality) ? h.quality : null;

  return (
    <section>
      <div className="eyebrow" style={{ marginBottom: 9 }}>Headline numbers</div>

      <div className="hn-grid">
        {cells.map((c) => <Cell key={c.label} {...c} />)}
      </div>

      {quality !== null && (
        <div className="hn-foot">
          <span className="mono" style={{ fontWeight: 500 }}>
            {quality === Infinity ? "∞" : quality.toFixed(2)}
          </span>{" "}
          total R per unit of drawdown
          {h.n < 30 && <> · {h.n} closed trades is still a small sample</>}
        </div>
      )}

      <style jsx global>{`
        .hn-grid {
          display: grid;
          grid-template-columns: repeat(9, minmax(0, 1fr));
          border: 1px solid rgba(124, 139, 135, 0.45);
          border-radius: 3px;
          background: transparent;
          overflow: hidden;
        }
        .hn-cell {
          padding: 13px 12px 12px;
          border-right: 1px solid rgba(124, 139, 135, 0.45);
          border-bottom: 1px solid rgba(124, 139, 135, 0.45);
          min-width: 0;
        }
        /* Right edge of each row, and the whole last row */
        .hn-cell:nth-child(9n) { border-right: 0; }
        .hn-cell:nth-last-child(-n + 9) { border-bottom: 0; }

        .hn-v {
          font-size: 19px;
          font-weight: 500;
          line-height: 1.15;
          letter-spacing: -0.015em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .hn-v.pos { color: var(--long); }
        .hn-v.neg { color: var(--short); }
        .hn-l {
          font-family: 'Archivo', sans-serif;
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.11em;
          text-transform: uppercase;
          color: var(--ink3);
          margin-top: 5px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .hn-foot {
          font-size: 11.5px;
          color: var(--ink3);
          margin-top: 8px;
          padding-left: 2px;
        }
        .hn-empty {
          border: 1px solid var(--rule); background: var(--card);
          border-radius: 3px; padding: 34px 20px; text-align: center;
        }
        .hn-empty p {
          font-size: 13px; color: var(--ink3);
          max-width: 340px; margin: 8px auto 0;
        }

        @media (max-width: 1120px) { .hn-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); }
          .hn-cell:nth-child(9n) { border-right: 1px solid rgba(124, 139, 135, 0.45); }
          .hn-cell:nth-child(6n) { border-right: 0; }
          .hn-cell:nth-last-child(-n + 9) { border-bottom: 1px solid rgba(124, 139, 135, 0.45); }
          .hn-cell:nth-last-child(-n + 6) { border-bottom: 0; }
        }
        @media (max-width: 720px) { .hn-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .hn-cell:nth-child(6n) { border-right: 1px solid rgba(124, 139, 135, 0.45); }
          .hn-cell:nth-child(3n) { border-right: 0; }
          .hn-cell:nth-last-child(-n + 6) { border-bottom: 1px solid rgba(124, 139, 135, 0.45); }
          .hn-cell:nth-last-child(-n + 3) { border-bottom: 0; }
          .hn-v { font-size: 17px; }
        }
      `}</style>
    </section>
  );
}
