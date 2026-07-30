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

  // Every R figure needs a stop to divide by. Where one is missing the tile
  // says so rather than showing a number built on a guess — and rather than
  // the whole board disappearing, which is what used to happen.
  const hasR = h.nWithR > 0;
  const needStop = `${h.nNeedStop} trade${h.nNeedStop === 1 ? "" : "s"} still need a stop`;
  const rCell = (label, value, extra = {}) =>
    hasR ? { label, value, ...extra } : { label, value: "—", hint: needStop };

  // Counted here rather than in calc.js: it qualifies how these numbers should
  // be read, and nothing downstream computes with it.
  const assumed = closed.filter((t) => t.stop_source === "assumed").length;

  /**
   * Three bands, because these numbers answer three different questions and
   * reading them as one wall of twenty-one invites comparing figures that
   * don't belong together.
   *
   * Money and percent is what happened. R is the same story told against the
   * risk taken, and is the only band an assumed stop can move. The last one is
   * neither — what the trading cost and how consistent it was.
   *
   * It also settles "Avg loss" appearing twice: once as a share of position
   * size and once in R. Same word, different question, and now visibly so.
   */
  const bands = [
    {
      label: "In money and percent",
      cells: [
        { label: "Net P&L", value: rupee(h.netPnl), tone: sign(h.netPnl),
          hint: `After ${rupee(h.charges)} of charges` },
        { label: "Return on capital", value: pct(h.returnOnCapital), tone: sign(h.returnOnCapital),
          hint: "Cumulative, not annualised" },
        { label: "Win rate", value: pct(h.winRateByCount, 0),
          hint: `${h.n} closed trade${h.n === 1 ? "" : "s"}, counted` },
        { label: "Avg gain", value: pct(h.avgGainPct), tone: "pos",
          hint: "On the winners, as a percentage of position size" },
        { label: "Avg loss", value: pct(h.avgLossPct), tone: "neg",
          hint: "On the losers, as a percentage of position size" },
        { label: "Max DD (%)", value: pct(h.maxDDPct), tone: "neg",
          hint: `${rupee(h.maxDDAmt)} at the worst point — what you actually had to sit through` },
        { label: "Avg hold", value: days(h.avgHold) },
      ],
    },
    {
      label: assumed > 0 ? "In R — against an assumed stop" : "In R",
      cells: [
        rCell("Total R", rfmt(h.totalR), { tone: sign(h.totalR) }),
        rCell("Expectancy", rfmt(h.expectancy), {
          tone: sign(h.expectancy),
          hint: "Average R per trade — the number that travels between traders",
        }),
        rCell("Profit factor", isFinite(h.profitFactor) ? h.profitFactor.toFixed(2) : "∞"),
        rCell("Payoff ratio", isFinite(h.payoff) ? h.payoff.toFixed(2) : "∞", {
          hint: "Average win divided by average loss",
        }),
        rCell("Avg win", rfmt(h.avgWin), { tone: "pos" }),
        rCell("Avg loss", rfmt(-h.avgLoss), { tone: "neg" }),
        rCell("Max DD (R)", hasR ? `${h.maxDD.toFixed(2)}R` : "—", {
          tone: "neg", hint: "Deepest peak-to-trough run in risk units",
        }),
        rCell("Best trade", rfmt(h.best), { tone: "pos" }),
        rCell("Worst trade", rfmt(h.worst), { tone: "neg" }),
      ],
    },
    {
      label: "What it cost, and how steady",
      cells: [
        { label: "Charges", value: rupee(h.charges), tone: "neg",
          hint: isFinite(h.netPnl) && h.netPnl + h.charges > 0
            ? `${pct((h.charges / (h.netPnl + h.charges)) * 100, 1)} of gross profit`
            : "Brokerage, STT, exchange, SEBI, stamp, GST, DP" },
        { label: "Green months", value: `${h.months.green}/${h.months.total}` },
        { label: "Green quarters", value: `${h.quarters.green}/${h.quarters.total}` },
        rCell("Best run", h.bestW ? `${h.bestW}d` : "—", {
          hint: "Trading days in a row that finished up — days, not trades, " +
                "because several positions often close together",
        }),
        rCell("Worst run", h.worstL ? `${h.worstL}d` : "—", {
          tone: h.worstL >= 6 ? "neg" : "",
          hint: "Trading days in a row that finished down",
        }),
      ],
    },
  ];

  // The honest quality measure: return earned per unit of drawdown endured
  const quality = isFinite(h.quality) ? h.quality : null;

  return (
    <section>
      <div className="eyebrow" style={{ marginBottom: 9 }}>Headline numbers</div>

      {bands.map((band) => (
        <div key={band.label} className="hn-band">
          <div className="hn-band-l">{band.label}</div>
          {/* Its own column count, so each band is one clean row on a wide
              screen instead of wrapping around whatever the widest needs. */}
          <div className="hn-grid" style={{ "--n": band.cells.length }}>
            {band.cells.map((c, i) => <Cell key={i} {...c} />)}
          </div>
        </div>
      ))}

      {/* Said once, near the numbers it qualifies. Every R above is a straight
          rescaling of percentage return when the stop was assumed — worth
          knowing before anyone reads expectancy as a measurement. */}
      {assumed > 0 && (
        <div className="hn-foot">
          <b>{assumed} of {h.n}</b> trade{assumed === 1 ? " uses" : "s use"} an assumed stop,
          so the R figures above show what your record would look like at that risk
          rather than what you actually risked.{" "}
          <a href="/stops" className="hn-link">Replace them</a> as you work out what
          you really used.
        </div>
      )}

      {h.nNeedStop > 0 && (
        <div className="hn-foot">
          {h.nWithR > 0
            ? <>The R figures cover {h.nWithR} of {h.n} trades — </>
            : <>Everything above is measured in money and percent. </>}
          <a href="/stops" className="hn-link">
            {h.nNeedStop} still {h.nNeedStop === 1 ? "needs" : "need"} a stop
          </a>
          {" "}before R, expectancy and the review can include {h.nNeedStop === 1 ? "it" : "them"}.
        </div>
      )}

      {quality !== null && (
        <div className="hn-foot">
          <span className="mono" style={{ fontWeight: 500 }}>
            {quality === Infinity ? "∞" : quality.toFixed(2)}
          </span>{" "}
          total R per unit of drawdown
          {h.nWithR < 30 && <> · {h.nWithR} trades with a stop is still a small sample</>}
        </div>
      )}

      <style jsx global>{`
        /* Separators are drawn by the cells, not by a ruled background showing
           through the gaps: twenty cells never fill the last row, and a ruled
           background turns that leftover into a grey slab. A 1px spread over a
           1px gap means neighbouring cells share one line, so the grid can
           reflow to any column count without nth-child arithmetic. */
        .hn-band { margin-bottom: 12px; }
        .hn-band:last-of-type { margin-bottom: 0; }
        .hn-band-l {
          font-family: 'Archivo', sans-serif; font-size: 9px; font-weight: 600;
          letter-spacing: 0.11em; text-transform: uppercase; color: var(--ink3);
          margin-bottom: 5px;
        }
        .hn-grid {
          display: grid;
          grid-template-columns: repeat(var(--n, 9), minmax(0, 1fr));
          gap: 1px;
          background: #FFFFFF;
          border: 1px solid var(--rule);
          border-radius: 3px;
          overflow: hidden;
        }
        .hn-cell {
          padding: 13px 12px 12px;
          background: #FFFFFF;
          box-shadow: 0 0 0 1px var(--rule);
          min-width: 0;
        }

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
        .hn-link {
          color: var(--brass);
          text-decoration: none;
          border-bottom: 1px dotted currentColor;
        }
        .hn-link:hover { color: var(--ink); }
        .hn-empty {
          border: 1px solid var(--rule); background: var(--card);
          border-radius: 3px; padding: 34px 20px; text-align: center;
        }
        .hn-empty p {
          font-size: 13px; color: var(--ink3);
          max-width: 340px; margin: 8px auto 0;
        }

        /* Below full width the bands stop trying to hold their own shape and
           all reflow to the same count. Separators follow by themselves, and a
           part-filled last row is white rather than a gap, because the cells
           draw their own edges. */
        @media (max-width: 1120px) {
          .hn-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
        }
        @media (max-width: 720px) {
          .hn-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .hn-v { font-size: 17px; }
        }
      `}</style>
    </section>
  );
}
