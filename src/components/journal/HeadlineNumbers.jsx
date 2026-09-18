"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { headline } from "@/lib/calc";
import { rupee, rfmt, pct, days } from "@/lib/format";
import Money from "@/components/Money";
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

const OPEN_KEY = "ledgerr:headline-numbers-open";

const sign = (v) => (!isFinite(v) ? "" : v > 0 ? "pos" : v < 0 ? "neg" : "");

export default function HeadlineNumbers({ closed, banking = [], openingCapital, flows = [] }) {
  /* Remembered per browser. Read in the initializer: this renders only after
     the session resolves on the client, so an effect would only add a flash of
     the wrong state. Guarded, since blocked storage throws. */
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; }
  });
  const setOpenRemembered = (v) => {
    setOpen(v);
    try { localStorage.setItem(OPEN_KEY, v ? "1" : "0"); } catch {}
  };
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
  /* Charges, and MTF interest and pledge fees where there were any — named
     separately, because they are different costs and only one is trading's. */
  /* MTF is named as taken out only when it was: set to show it as an expense
     only, it is still named, as not taken out. */
  const afterCosts = `After ${rupee(h.charges)} charges`
    + (h.margin > 0
      ? h.marginCounted !== false
        ? ` and ${rupee(h.margin)} MTF`
        : ` · ${rupee(h.margin)} MTF shown separately, not taken out`
      : "");

  const mtfNote = "Interest with pledge and unpledge charges, on MTF shares sold so far. "
    + (h.marginCounted !== false
      ? "Already taken out of P&L and R"
      : "Shown as an expense only — not taken out of P&L or R");

  /* Named because it is now said twice — on the tile and on the figure. */
  const chargeShare = isFinite(h.netPnl) && h.netPnl + h.charges > 0
    ? `${pct((h.charges / (h.netPnl + h.charges)) * 100, 1)} of gross profit`
    : "Brokerage, STT, exchange, SEBI, stamp, GST, DP";

  const bands = [
    {
      label: "In money and percent",
      cells: [
        /* The charges hint rides on the FIGURE, not just the tile, because the
           figure now has a hover of its own and a nested title wins whichever
           one the pointer happens to be over. Folded, both facts survive. */
        { label: "Net P&L",
          value: <Money v={h.netPnl} note={afterCosts} />,
          tone: sign(h.netPnl), hint: afterCosts },
        /*
          NO RETURN PERCENTAGE HERE, DELIBERATELY.

          Two lived here: cumulative return on the Settings account size, and
          the annual rate on the capital actually at work. Side by side they
          both began "Return on capital", answered different questions on
          different denominators, and moved in opposite directions when that
          Settings field was edited — one swinging with it, one immune. A
          glance cannot tell those apart, and this block is the glance.

          Both now live on the Performance sheet, where CAGR opens the row and
          "Return on capital at work" sits in Capital Deployment against the
          committed figure it divides by. Net P&L below still answers "how
          much"; "how well" is a question worth a screen rather than a tile.
        */
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
            <Money v={h.avgRisk} />
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
        { label: "Charges", value: <Money v={h.charges} note={chargeShare} />, tone: "neg",
          hint: chargeShare },
        /* Beside Charges because both are what trading cost, and only for
           someone who has bought on margin — a tile reading ₹0 for everybody
           else would be a question they never asked. One figure: MTF means the
           interest with the pledge and unpledge charges, never split out. */
        ...(h.margin > 0 ? [{
          label: "MTF",
          value: <Money v={h.margin} note={mtfNote} />,
          tone: "neg", hint: mtfNote,
        }] : []),
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

  const tileCount = bands.reduce((a, b) => a + b.cells.length, 0);

  return (
    <section>
      {/*
        * FOLDED BY DEFAULT. The summary paragraph above already states the
        * figures most people come for — expectancy, win rate, total R, net P&L,
        * the deepest drawdown and the worst run — and twenty-one tiles under it
        * said most of them a second time. They are one click away for anyone
        * who wants the full sheet, and the click is remembered.
        *
        * The two stop warnings below sit OUTSIDE the fold on purpose. They
        * qualify every R figure on the page, the paragraph's included, and
        * each links to where it gets fixed; a caveat you have to open a panel
        * to find is not a caveat.
        */}
      <div className="hn-top">
        <div className="eyebrow">Headline numbers</div>
        <button type="button" className="btn ghost sm" aria-expanded={open}
                onClick={() => setOpenRemembered(!open)}>
          <ChevronDown size={12} style={{ transform: open ? "rotate(180deg)" : "none" }} />
          {open ? "Hide the numbers" : `All ${tileCount} numbers`}
        </button>
      </div>

      {open && bands.map((band) => (
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
          so the R figures on this page show what your record would look like at that risk
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

      {open && quality !== null && (
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
        .hn-top { display: flex; justify-content: space-between; align-items: center;
                  gap: 12px; margin-bottom: 9px; }
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
