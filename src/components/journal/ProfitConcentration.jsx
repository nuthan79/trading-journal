"use client";

import { useMemo } from "react";
import { profitConcentration, bestWorst } from "@/lib/dashboard";
import { rfmt, rupee, pct } from "@/lib/format";

/**
 * Where the profit actually came from, and the trades at each extreme.
 *
 * The concentration figures answer the question a good total R can't: was this
 * a system, or three lucky trades? Strip the top 5% and re-run expectancy — if
 * what's left is still positive, the edge is broad enough to rely on.
 *
 * Worst trades are ranked by rupees lost rather than by R, deliberately. A −1R
 * loss on a large position cost the account more than a −2R loss on a small
 * one, and it's the rupees that have to be earned back.
 */

function Stat({ value, label, tone, wide }) {
  return (
    <div className={`pc-cell ${wide ? "wide" : ""}`}>
      <div className={`pc-v mono ${tone || ""}`}>{value}</div>
      <div className="pc-l">{label}</div>
    </div>
  );
}

function TradeTable({ title, rows, tone }) {
  if (!rows.length) return null;
  return (
    <section className="tt-card">
      <div className="eyebrow tt-head">{title}</div>
      <div className="scroll">
        <table className="t">
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="num">Exit</th>
              <th className="num">Held</th>
              <th className="num">R</th>
              <th className="num">P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>
                  <b className="disp">{t.symbol}</b>
                  {t.thesis && (
                    <div className="tt-thesis" title={t.thesis}>{t.thesis}</div>
                  )}
                </td>
                <td className="num mono tt-dim">{t.exitDate}</td>
                <td className="num mono tt-dim">
                  {isFinite(t.heldDays) ? `${t.heldDays} d` : "—"}
                </td>
                <td className={`num mono ${tone}`} style={{ fontWeight: 500 }}>
                  {rfmt(t.r)}
                </td>
                <td className={`num mono ${tone}`}>{rupee(t.pnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <style jsx>{`
        .tt-card { border:1px solid var(--rule); background:var(--card);
                   border-radius:3px; padding:16px 18px 6px; }
        .tt-head { display:block; border-bottom:1px solid var(--rule);
                   padding-bottom:9px; margin-bottom:2px; }
        .tt-dim { color: var(--ink3); font-size: 12px; }
        .tt-thesis {
          font-size: 11px; font-weight: 400; color: var(--ink3);
          max-width: 170px; white-space: nowrap; overflow: hidden;
          text-overflow: ellipsis; margin-top: 2px;
        }
      `}</style>
    </section>
  );
}

export default function ProfitConcentration({ closed }) {
  const pcData = useMemo(() => profitConcentration(closed), [closed]);
  const bw = useMemo(() => bestWorst(closed), [closed]);

  return (
    <>
      {pcData && (
        <section className="pc-card">
          <div className="eyebrow pc-title">Profit concentration</div>

          <div className="pc-strip">
            <Stat
              wide
              value={`${pcData.topDecileShare.toFixed(1)}% of gross profit`}
              label="Top 10% of trades"
            />
            <Stat
              value={rfmt(pcData.expectancyLessTop5)}
              label="Expectancy less top 5%"
              tone={pcData.expectancyLessTop5 >= 0 ? "pos" : "neg"}
            />
            <Stat value={rfmt(pcData.best)} label="Best single trade" tone="pos" />
            <Stat
              value={rfmt(pcData.median)}
              label="Median trade"
              tone={pcData.median >= 0 ? "" : "neg"}
            />
          </div>

          <p className="pc-foot">
            Strip out your best 5% of trades and expectancy goes from{" "}
            <b>{rfmt(pcData.expectancy)}</b> to{" "}
            <b>{rfmt(pcData.expectancyLessTop5)}</b>.{" "}
            {pcData.broadEdge ? (
              <>The system still pays without them — the edge is broad, not lucky.</>
            ) : (
              <>
                Without them the system doesn't pay. On this sample the result rests on a
                handful of trades, so treat the headline expectancy as fragile until the
                remainder can carry it.
              </>
            )}
          </p>

          <style jsx>{`
            .pc-card { border:1px solid var(--rule); background:var(--card);
                       border-radius:3px; padding:16px 20px 17px; }
            .pc-title { display:block; border-bottom:1px solid var(--rule);
                        padding-bottom:9px; margin-bottom:14px; }
            .pc-strip {
              display:grid; grid-template-columns: 2fr 1fr 1fr 1fr;
              border:1px solid var(--rule); border-radius:3px; overflow:hidden;
            }
            .pc-foot { font-size:12.5px; color:var(--ink2); line-height:1.65;
                       margin:13px 0 0; max-width:600px; text-align:left;
                       text-wrap:pretty; }
            .pc-foot b { font-weight:600; font-variant-numeric:tabular-nums;
                         white-space:nowrap; color:var(--ink); }
            @media (max-width: 820px) {
              .pc-strip { grid-template-columns: 1fr 1fr; }
            }
          `}</style>
          <style jsx global>{`
            .pc-cell { padding:14px 16px; border-right:1px solid var(--rule); min-width:0; }
            .pc-cell:last-child { border-right:0; }
            .pc-v { font-size:20px; font-weight:600; line-height:1.15;
                    letter-spacing:-0.015em; white-space:nowrap;
                    overflow:hidden; text-overflow:ellipsis; }
            .pc-cell.wide .pc-v { font-size:23px; }
            .pc-v.pos { color: var(--long); }
            .pc-v.neg { color: var(--short); }
            .pc-l { font-family:'Archivo',sans-serif; font-size:9px; font-weight:600;
                    letter-spacing:0.11em; text-transform:uppercase;
                    color:var(--ink3); margin-top:5px; white-space:nowrap;
                    overflow:hidden; text-overflow:ellipsis; }
            @media (max-width: 820px) {
              .pc-cell:nth-child(2) { border-right:0; }
              .pc-cell:nth-child(-n+2) { border-bottom:1px solid var(--rule); }
            }
          `}</style>
        </section>
      )}

      {(bw.best.length > 0 || bw.worst.length > 0) && (
        <div className="bw-pair">
          <TradeTable title="Best trades" rows={bw.best} tone="pos" />
          <TradeTable title="Worst trades" rows={bw.worst} tone="neg" />
          <style jsx>{`
            .bw-pair { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
            @media (max-width: 900px) { .bw-pair { grid-template-columns:1fr; } }
          `}</style>
        </div>
      )}
    </>
  );
}
