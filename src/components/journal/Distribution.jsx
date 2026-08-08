"use client";

import { useMemo } from "react";
import { rfmt } from "@/lib/format";

/**
 * Distribution of R outcomes — the shape a Monte Carlo would resample from.
 *
 * TWO SERIES, ONE PICTURE. The bars are total R; the line is how many trades
 * produced it.
 *
 * They disagree by design in a breakout system, and the disagreement is the
 * whole finding: most trades land on the left, most of the money comes from
 * the far right. Nine trades past 5R can outweigh fifty small losses.
 *
 * This was a toggle first, and the toggle was worse. Flipping between two
 * states asks you to remember the other one and do the comparison in your
 * head; drawn together, the lines simply cross and the asymmetry is visible
 * without being described.
 *
 * A second AXIS is fine here where a second NUMBER above each bar was not.
 * The objection to the number was that it competed with the bar height in the
 * same visual channel — the height said one bucket was biggest while the
 * figure beside it said another was. A line is its own channel with its own
 * scale, and nothing about it can be mistaken for the bar it crosses.
 *
 * GEOMETRY. The columns carry their own padding instead of the row carrying a
 * flex gap, so column i occupies exactly [i/n, (i+1)/n] of the width and its
 * centre is (i + 0.5)/n. With a gap that arithmetic needs the pixel width,
 * which the line would have to measure; without one the percentages are exact
 * and the dots sit on the bars at any size.
 */
export default function Distribution({ rows }) {
  const buckets = useMemo(() => {
    const defs = [
      { k: "≤ -1R", t: (r) => r <= -1 }, { k: "-1 to -0.5", t: (r) => r > -1 && r <= -0.5 },
      { k: "-0.5 to 0", t: (r) => r > -0.5 && r <= 0 }, { k: "0 to 1R", t: (r) => r > 0 && r <= 1 },
      { k: "1 to 2R", t: (r) => r > 1 && r <= 2 }, { k: "2 to 3R", t: (r) => r > 2 && r <= 3 },
      { k: "3 to 5R", t: (r) => r > 3 && r <= 5 }, { k: "> 5R", t: (r) => r > 5 },
    ];
    return defs.map((d) => {
      // Only trades with a computable R belong in an R histogram at all — one
      // without a stop has no bucket, and summing NaN would blank the row.
      const hit = rows.filter((x) => isFinite(x.r) && d.t(x.r));
      return {
        k: d.k,
        n: hit.length,
        r: hit.reduce((a, x) => a + x.r, 0),
        win: d.k.indexOf("-") !== 0 && !d.k.startsWith("≤"),
      };
    });
  }, [rows]);

  const n = buckets.length;
  // Bars are magnitude: a bar has no sign and the colour already carries it.
  const maxR = Math.max(1, ...buckets.map((b) => Math.abs(b.r)));
  const maxN = Math.max(1, ...buckets.map((b) => b.n));

  const BAND = 84;                       // bar height, as a share of its column
  // The line lives in its own box, offset below the value labels, so 100 here
  // is that box rather than the whole plot. A few units of headroom keep the
  // topmost dot's stroke inside it.
  const pt = (b, i) => [
    ((i + 0.5) / n) * 100,
    100 - (b.n / maxN) * 94,
  ];
  const line = buckets.map(pt).map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");

  const winners = buckets.filter((b) => b.r > 0);
  const grossWin = winners.reduce((a, b) => a + b.r, 0);
  const tail = winners.slice(-3);
  const tailR = tail.reduce((a, b) => a + b.r, 0);
  const tailN = tail.reduce((a, b) => a + b.n, 0);
  const restR = buckets.reduce((a, b) => a + b.r, 0) - tailR;

  return (
    <div className="card">
      <div className="dist-head">
        <div className="eyebrow">R distribution</div>
        <div className="dist-legend">
          <span><i className="dist-sw dist-sw-r" />Total R</span>
          <span><i className="dist-sw dist-sw-n" />Trades<i className="dist-dim"> · right</i></span>
        </div>
      </div>

      <div className="dist-plot">
        {buckets.map((b) => (
          <div key={b.k} className="dist-col">
            <div className="mono dist-val">{b.n ? rfmt(b.r, 1) : ""}</div>
            <div className="dist-bar"
                 data-win={b.win ? 1 : 0}
                 style={{ height: `${(Math.abs(b.r) / maxR) * BAND}%`, minHeight: b.n ? 3 : 0 }} />
          </div>
        ))}

        {/* The line is SVG; the dots are not.
            preserveAspectRatio="none" stretches the viewBox to the container —
            about six to one here — and a circle drawn in it comes out a wide
            ellipse. vector-effect fixes the stroke WIDTH, not the geometry, so
            it rescues the polyline and does nothing for a circle. HTML dots
            positioned by percentage stay round at any size. */}
        <div className="dist-over">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline points={line} fill="none" stroke="var(--steel)"
                      strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          </svg>
          {buckets.map((b, i) => {
            const [x, y] = pt(b, i);
            return (
              <i key={b.k} className="dist-dot"
                 style={{ left: `${x}%`, top: `${y}%` }}
                 title={`${b.n} ${b.n === 1 ? "trade" : "trades"} · ${rfmt(b.r, 1)}`} />
            );
          })}
        </div>

        <div className="dist-yr">
          <span>{maxN}</span>
          <span>0</span>
        </div>
      </div>

      <div className="dist-axis">
        {buckets.map((b) => (
          <div key={b.k} className="mono dist-x">
            {b.k}
            <i className="dist-n">{b.n || "—"}</i>
          </div>
        ))}
      </div>

      {grossWin > 0 && tail.length > 0 && (
        <div className="hint" style={{ marginTop: 9 }}>
          {tailN} trades in the top {tail.length} buckets made {rfmt(tailR, 1)} —{" "}
          {Math.round((tailR / grossWin) * 100)}% of everything the winners produced.
          Every other trade together comes to {rfmt(restR, 1)}.
        </div>
      )}

      <style jsx>{`
        .dist-head {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; flex-wrap: wrap; margin-bottom: 14px;
        }
        .dist-legend { display: flex; gap: 14px; font-size: 11px; color: var(--ink2); }
        .dist-legend span { display: inline-flex; align-items: center; gap: 5px; }
        .dist-sw { width: 12px; height: 2px; border-radius: 1px; display: inline-block; }
        .dist-sw-r { background: var(--long); }
        .dist-sw-n { background: var(--steel); }
        .dist-dim { font-style: normal; color: var(--ink3); }

        /* The right gutter holds the trade-count scale, so the plot itself
           stops short of it and the line's percentages stay honest. */
        .dist-plot {
          position: relative; display: flex; align-items: flex-end;
          height: 118px; padding-right: 26px;
        }
        /* Padding, not a flex gap — see the note at the top of this file. */
        .dist-col {
          flex: 1; padding: 0 3px; height: 100%;
          display: flex; flex-direction: column;
          align-items: center; justify-content: flex-end;
        }
        /* Above the overlay, on the card's own colour. A low count puts its
           dot near the baseline, which is exactly where a short bar's label
           sits — without this the line runs straight through the digits. */
        .dist-val {
          font-size: 11px; color: var(--ink2); margin-bottom: 4px;
          position: relative; z-index: 2;
          background: var(--card); padding: 0 3px; border-radius: 2px;
        }
        .dist-bar {
          width: 100%; border-radius: 1px 1px 0 0; opacity: 0.85;
          background: var(--short);
        }
        .dist-bar[data-win="1"] { background: var(--long); }

        /* Explicit width. With left and right set but width:auto an SVG falls
           back to its intrinsic size instead of stretching, which drew the
           whole series inside the first quarter of the chart.
           The top offset clears the R labels above the bars, so the line
           occupies the same band the bars do rather than crossing their
           numbers. */
        .dist-over {
          position: absolute; left: 0; top: 21px;
          width: calc(100% - 26px); height: calc(100% - 21px);
          pointer-events: none;
        }
        .dist-over svg { width: 100%; height: 100%; overflow: visible; display: block; }
        .dist-dot {
          position: absolute; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px;
          border-radius: 50%; background: var(--card);
          border: 1.4px solid var(--steel); pointer-events: auto;
        }
        .dist-yr {
          position: absolute; right: 0; top: 21px; bottom: 0; width: 24px;
          display: flex; flex-direction: column; justify-content: space-between;
          align-items: flex-end; font-size: 10px; color: var(--steel);
          font-variant-numeric: tabular-nums;
        }

        .dist-axis {
          display: flex; margin-top: 7px;
          border-top: 1px solid var(--rule); padding: 7px 26px 0 0;
        }
        .dist-x {
          flex: 1; padding: 0 3px; text-align: center;
          font-size: 11px; color: var(--ink3);
        }
        /* The count under its own bucket. The line gives the shape; this gives
           the number, without a label per point colliding with the R above. */
        .dist-n {
          display: block; font-style: normal; font-size: 10px;
          color: var(--steel); margin-top: 2px;
        }
      `}</style>
    </div>
  );
}
