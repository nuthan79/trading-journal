"use client";

import { useMemo } from "react";
import LedgerPlot from "./LedgerPlot";
import Distribution from "./Distribution";
import Tile from "./Tile";
import HeadlineNumbers from "./HeadlineNumbers";
import OpenPositions from "./OpenPositions";
import { rupee, rfmt, pct } from "@/lib/format";
import { EXCHANGES } from "@/lib/constants";

export default function Dashboard({ S, closed, open, accountSize, diary, flows, onMarked }) {
  const pnlByExchange = useMemo(() => {
    const g = { NSE: 0, BSE: 0 };
    closed.forEach((t) => { if (isFinite(t.pnl)) g[t.exchange] += t.pnl; });
    return g;
  }, [closed]);

  const openRiskR = useMemo(
    () => open.reduce((a, t) => a + (isFinite(t.riskPct) ? t.riskPct : 0), 0),
    [open]
  );

  const lastEntry = diary[0];

  return (
    <>
      <div className="sec"><HeadlineNumbers closed={closed} openingCapital={accountSize} flows={flows} /></div>

      <div className="sec"><LedgerPlot rows={closed} /></div>

      <div className="sec grid4">
        <Tile label="Expectancy" value={S.n ? rfmt(S.expectancy) : "—"}
              tone={S.n && S.expectancy >= 0 ? "pos" : S.n ? "neg" : ""}
              sub={S.n ? `across ${S.n} closed trades` : "log a closed trade"} />
        <Tile label="Win rate" value={S.n ? pct(S.winRate, 0) : "—"}
              sub={S.n ? `payoff ${isFinite(S.payoff) ? S.payoff.toFixed(1) : "∞"} : 1` : "—"} />
        <Tile label="Profit factor" value={S.n ? (isFinite(S.profitFactor) ? S.profitFactor.toFixed(2) : "∞") : "—"}
              sub={S.n ? `max drawdown ${S.maxDD.toFixed(1)}R` : "—"} />
        <Tile label="Open risk" value={pct(openRiskR, 2)}
              tone={openRiskR > 6 ? "neg" : ""}
              sub={`${open.length} position${open.length === 1 ? "" : "s"} live`} />
      </div>

      <div className="sec grid2">
        <Distribution rows={closed} />
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 14 }}>Realised P&amp;L by exchange</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {EXCHANGES.map((ex) => (
              <div key={ex} style={{ display: "flex", justifyContent: "space-between",
                                    alignItems: "baseline", borderBottom: "1px solid var(--rule)", paddingBottom: 12 }}>
                <div>
                  <div className="disp" style={{ fontSize: 13 }}>{ex}</div>
                  <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 2 }}>
                    {closed.filter((t) => t.exchange === ex).length} closed
                  </div>
                </div>
                <div className={`mono ${pnlByExchange[ex] >= 0 ? "pos" : "neg"}`} style={{ fontSize: 19 }}>
                  {rupee(pnlByExchange[ex])}
                </div>
              </div>
            ))}
            <div style={{ fontSize: 11.5, color: "var(--ink3)", lineHeight: 1.6 }}>
              Account size {rupee(accountSize)}. Every performance number in this
              journal is measured in R, which keeps setups comparable regardless of
              position size.
            </div>
          </div>
        </div>
      </div>

      <div className="sec">
        <OpenPositions open={open} onMarked={onMarked} />
      </div>

      {lastEntry && (
        <div className="sec">
          <div className="sechead"><div className="eyebrow">Latest from the diary</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>{lastEntry.entry_date}</div></div>
          <div className="card">
            <div className="chips" style={{ marginBottom: 8 }}>
              {(lastEntry.emotions || []).map((e) => <span key={e} className="chip">{e}</span>)}
            </div>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.65,
                          maxHeight: 120, overflow: "hidden" }}>{lastEntry.body}</div>
          </div>
        </div>
      )}
    </>
  );
}
