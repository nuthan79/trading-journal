"use client";

import { useMemo, useState } from "react";
import { rfmt } from "@/lib/format";

/**
 * Distribution of R outcomes — the shape a Monte Carlo would resample from.
 *
 * WHY THIS COUNTS TWO WAYS.
 *
 * A histogram of trades answers "where do my outcomes land". It cannot answer
 * "where does my R come from", and in a breakout system those have different
 * answers by design: the left of the chart holds most of the trades and the
 * far right holds most of the money. Nine trades past 5R can outweigh fifty
 * small losses, and counting by frequency hides that completely.
 *
 * Weighting by R rather than annotating with it. Putting both numbers above
 * one bar reads as clutter and, worse, as a contradiction — the height says
 * one bucket is the big one while the second figure says another is. Letting
 * the bars re-height means the number above always matches what you are
 * looking at, and flipping between the two makes the asymmetry the point
 * rather than a footnote.
 */
export default function Distribution({ rows }) {
  const [by, setBy] = useState("trades");

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

  const byR = by === "r";
  // Magnitude, because losing buckets are negative and a bar has no sign —
  // the colour already carries that.
  const value = (b) => (byR ? Math.abs(b.r) : b.n);
  const max = Math.max(1, ...buckets.map(value));

  /**
   * The tail's share, measured against GROSS profit rather than net.
   *
   * Against the net figure the first version read "+147.0R of +119.8R — 123%",
   * because the numerator is what the best buckets made and the denominator
   * had the losses already taken out of it. Two different quantities, and the
   * nonsense showed. Gross is the honest denominator: of everything the
   * winners produced, this is the part that came from the far right.
   */
  const winners = buckets.filter((b) => b.r > 0);
  const grossWin = winners.reduce((a, b) => a + b.r, 0);
  const tail = winners.slice(-3);
  const tailR = tail.reduce((a, b) => a + b.r, 0);
  const tailN = tail.reduce((a, b) => a + b.n, 0);
  const netR = buckets.reduce((a, b) => a + b.r, 0);
  const restR = netR - tailR;

  return (
    <div className="card">
      <div className="dist-head">
        <div className="eyebrow">R distribution</div>
        <div className="seg">
          <button data-on={!byR ? 1 : 0} onClick={() => setBy("trades")}>Trades</button>
          <button data-on={byR ? 1 : 0} onClick={() => setBy("r")}>Total R</button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 118 }}>
        {buckets.map((b) => (
          <div key={b.k} style={{ flex: 1, display: "flex", flexDirection: "column",
                                  alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink2)", marginBottom: 4 }}>
              {b.n ? (byR ? rfmt(b.r, 1) : b.n) : ""}
            </div>
            <div style={{ width: "100%", height: `${(value(b) / max) * 84}%`,
                          minHeight: b.n ? 3 : 0,
                          background: b.win ? "var(--long)" : "var(--short)",
                          opacity: 0.85, borderRadius: "1px 1px 0 0" }} />
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 7, borderTop: "1px solid var(--rule)", paddingTop: 7 }}>
        {buckets.map((b) => (
          <div key={b.k} className="mono dist-x">{b.k}</div>
        ))}
      </div>

      {/* Said once, under the chart, rather than repeated over every bar. */}
      {byR && grossWin > 0 && tail.length > 0 && (
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
        /* Was 9px and too small to read at a glance — the bucket edges are the
           one thing on this chart you cannot infer from the shape. */
        .dist-x { flex: 1; text-align: center; font-size: 11px; color: var(--ink3); }
      `}</style>
    </div>
  );
}
