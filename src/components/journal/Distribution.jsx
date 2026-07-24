"use client";

import { useMemo } from "react";

/** Distribution of R outcomes — the shape a Monte Carlo would resample from. */
export default function Distribution({ rows }) {
  const buckets = useMemo(() => {
    const defs = [
      { k: "≤ -1R", t: (r) => r <= -1 }, { k: "-1 to -0.5", t: (r) => r > -1 && r <= -0.5 },
      { k: "-0.5 to 0", t: (r) => r > -0.5 && r <= 0 }, { k: "0 to 1R", t: (r) => r > 0 && r <= 1 },
      { k: "1 to 2R", t: (r) => r > 1 && r <= 2 }, { k: "2 to 3R", t: (r) => r > 2 && r <= 3 },
      { k: "3 to 5R", t: (r) => r > 3 && r <= 5 }, { k: "> 5R", t: (r) => r > 5 },
    ];
    return defs.map((d) => ({ k: d.k, n: rows.filter((x) => d.t(x.r)).length, win: d.k.indexOf("-") !== 0 && !d.k.startsWith("≤") }));
  }, [rows]);

  const max = Math.max(1, ...buckets.map((b) => b.n));
  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 14 }}>R distribution</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 118 }}>
        {buckets.map((b) => (
          <div key={b.k} style={{ flex: 1, display: "flex", flexDirection: "column",
                                  alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink2)", marginBottom: 4 }}>
              {b.n || ""}
            </div>
            <div style={{ width: "100%", height: `${(b.n / max) * 84}%`, minHeight: b.n ? 3 : 0,
                          background: b.win ? "var(--long)" : "var(--short)", opacity: 0.85, borderRadius: "1px 1px 0 0" }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 7, borderTop: "1px solid var(--rule)", paddingTop: 7 }}>
        {buckets.map((b) => (
          <div key={b.k} className="mono" style={{ flex: 1, textAlign: "center", fontSize: 9, color: "var(--ink3)" }}>
            {b.k}
          </div>
        ))}
      </div>
    </div>
  );
}
