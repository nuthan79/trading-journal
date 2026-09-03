"use client";

import { useMemo } from "react";
import { headline, annualisedReturn } from "@/lib/calc";
import { rupee, rfmt, pct, signedPct, days } from "@/lib/format";
import { hasRealStop } from "@/lib/stops";

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

/** The annualised-return tile, which names its own method. */
function annualisedCell(a) {
  const label = a.method === "xirr" ? "XIRR" : "CAGR";
  if (!isFinite(a.rate)) {
    return {
      label: a.method === "xirr" ? "XIRR" : "CAGR",
      value: "—",
      hint: a.method === "too-short"
        ? `Needs ${a.minDays} days of history — annualising a shorter record `
          + "says more about the arithmetic than about the trading"
        : a.method === "no-capital"
        ? "Set your account size in Settings and this fills in"
        : "Not enough history yet",
    };
  }
  const years = a.years >= 1
    ? `${a.years.toFixed(1)} years`
    : `${Math.round(a.days)} days`;
  return {
    label,
    value: signedPct(a.rate * 100),
    tone: sign(a.rate),
    hint: a.method === "xirr"
      ? `Money-weighted over ${years}, counting ${a.flows} deposit`
        + `${a.flows === 1 ? "" : "s"} or withdrawal${a.flows === 1 ? "" : "s"}`
        + `${a.marked ? ", open positions at market" : ""}`
      : `Compounded over ${years}${a.marked ? ", open positions at market" : ""}`
        + ". No deposits or withdrawals recorded, so this is also the XIRR",
  };
}

export default function HeadlineNumbers({ closed, banking = [], all = [], openingCapital, flows = [] }) {
  const h = useMemo(
    () => headline(closed, { openingCapital, flows, banking }),
    [closed, banking, openingCapital, flows]
  );

  /**
   * Measured over EVERY position, open ones included.
   *
   * Not `closed` and not `banking`: this is the only figure on the block that
   * asks what the account is worth rather than what the trading produced, and
   * a position bought last week with no sale in it still holds capital and
   * still carries a mark.
   */
  const ann = useMemo(
    () => annualisedReturn(all.length ? all : closed, { openingCapital, flows }),
    [all, closed, openingCapital, flows]
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
  /* Both kinds sit out of the R figures, so both belong in the caveat under
     them — an assumed stop and no stop at all are different answers to the
     same question and neither yields a 1R. */
  const assumed = closed.filter((t) => !hasRealStop(t)).length;

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
          hint: "Cumulative, not annualised — the tile beside this one annualises it" },
        /**
         * THE SAME RETURN, PER YEAR — the figure people ask for by name.
         *
         * Labelled by the method actually used, never by the more impressive
         * word. With no deposits or withdrawals recorded the two cash flows
         * are the opening balance and today's value, XIRR reduces to CAGR
         * exactly, and calling it XIRR would be a bigger name for the same
         * arithmetic. Record a deposit and it becomes a real money-weighted
         * XIRR and relabels itself.
         *
         * A short record gets the reason instead of a number: annualising six
         * weeks says more about the exponent than about the trading.
         */
        annualisedCell(ann),
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
      /* Nine across on a wide page is a 160px tile — much narrower than
         either neighbour, and the reason this row read as crowded. Five puts
         it on two lines at 279px, exactly matching the band below it.

         The money band stays on one row of seven: breaking it to five would
         leave an orphan pair on a second line, which is worse than a tile
         eighty pixels narrower. Nine wanted splitting, seven does not. */
      cols: 5,
      cells: [
        rCell("Total R", rfmt(h.totalR), { tone: sign(h.totalR) }),
        rCell("Expectancy", rfmt(h.expectancy), {
          tone: sign(h.expectancy),
          hint: "Average R per trade — the number that travels between traders",
        }),
        /*
          Sits beside Expectancy on purpose, and it is what makes the rest of
          this band legible: "+1.03R a trade" says nothing until you know what
          an R is worth. Everything above it is money, everything around it is
          R, and this is the rate between them.

          It also completes the row. Nine tiles in a five-column grid left one
          empty box; ten fills both lines exactly, which is the difference
          between a grid and a grid with a hole in it.

          MEASURED, NOT INFERRED — see `avgRisk` in calc.js. netPnl ÷ totalR
          lands nearby and is a different figure: R-weighted, and after charges.
        */
        rCell("Risk per trade", (
          <>
            {rupee(h.avgRisk)}
            {isFinite(h.avgRiskPct) && (
              <span className="hn-sub"> · {pct(h.avgRiskPct, 2)}</span>
            )}
          </>
        ), {
          /*
            WHAT THIS IS NOT: what one R is worth. The old hint said that, and
            it invited exactly the arithmetic it fails — average risk × total R
            does not come back to net P&L, and cannot, unless every trade
            risked the same. The two differ by n × covariance(R, risk), which
            on a compounding account is large and negative: risk grows with the
            balance while the early, richest R was earned on the smallest
            positions.

            So the hint now carries the spread instead, which is the thing
            actually worth knowing — and it says the opposite when sizing has
            been consistent, because a trader doing it right should be told so
            rather than warned about a problem they do not have.
          */
          hint: h.riskVaries
            ? `Most trades risked between ${rupee(h.riskLo)} and ${rupee(h.riskHi)}. ` +
              `1R has grown with the account, so a +2R early on and a +2R lately ` +
              `are different amounts of money — total R adds them as though they ` +
              `were the same.`
            : "The average money put at risk on a trade. Your sizing is consistent, " +
              "so 1R means much the same throughout your record.",
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
          <div className="hn-grid" style={{ "--n": band.cols || band.cells.length }}>
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
        /* A second figure in the same tile, subordinate to the first. The
           rupee number is the answer; the percentage is the same answer in the
           unit the rest of the board uses, and should not compete with it. */
        .hn-sub { font-size: 0.68em; color: var(--ink3); }
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
