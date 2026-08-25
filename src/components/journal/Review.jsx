"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, track } from "@/lib/db";
import { reviewFindings } from "@/lib/analysis";
import { classifyRegime, regimeIndex, REGIME_LABEL } from "@/lib/market";
import { signedPct } from "@/lib/format";
import Link from "next/link";
import { setupGaps } from "@/lib/gaps";

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

/**
 * Turn a key into a label. `topDecileSharePct` reads as "Top decile share %".
 *
 * Words are lowercased after the first, because a row of Title Case Everywhere
 * reads like a form and these are sentences about someone's trading. Single
 * capitals and all-caps stay as they are, which keeps R and FY intact.
 */
function label(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    // And between a run of capitals and the word that follows it, or
    // `tradesWithAFeeling` splits as "with AFeeling" and prints "afeeling".
    // One rule catches camelCase; it takes two to catch all of it.
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_]+/)
    .map((w, i) => {
      if (/^pct$/i.test(w)) return "%";
      if (/^[A-Z0-9]+$/.test(w)) return w;
      return i === 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase();
    })
    .join(" ")
    .replace(/ %/, " %");
}

/**
 * Units come from the key, and only where the key says so plainly.
 *
 * A suffix invented by inference is worse than none: a number labelled % that
 * is not one misleads in a way raw JSON never did. So only `…Pct`, `…Rate`,
 * `…R` and `expectancy` get a unit, and everything else is printed as it is.
 * The fix for a bare number is to name the key better, not to guess harder.
 */
function value(key, v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v !== "number") return String(v);
  const k = String(key);
  if (/Pct$/.test(k) || /Rate$/i.test(k)) return `${v}%`;
  if (k === "r" || /[a-z]R$/.test(k) || k === "expectancy") {
    return `${v > 0 ? "+" : ""}${v}R`;
  }
  return Number.isInteger(v) ? v.toLocaleString("en-IN") : String(v);
}

const isRow = (v) => v && typeof v === "object" && !Array.isArray(v);

/** A table from a list of like-shaped objects, columns taken from the union. */
function EvTable({ rows, firstCol }) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r.data)))];
  return (
    <div className="rv-ev-scroll">
      <table className="rv-ev-table">
        <thead>
          <tr>
            {firstCol && <th>{firstCol}</th>}
            {cols.map((c) => <th key={c} className="num">{label(c)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {firstCol && <th scope="row">{r.name}</th>}
              {cols.map((c) => (
                <td key={c} className="num">
                  {r.data[c] === undefined ? "—" : value(c, r.data[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The evidence behind a finding, as something to read.
 *
 * It used to be `JSON.stringify(evidence, null, 2)` in a <pre>. That is
 * developer output: braces, quoted keys, camelCase, and a reader left to work
 * out that "topDecileSharePct" is a percentage. The numbers were always the
 * interesting part of these findings and they were the hardest part to look at.
 *
 * Four shapes cover every check: plain numbers, a list of like objects, an
 * object of objects (a matrix, one row per regime), and an object of plain
 * numbers. Anything unforeseen falls back to compact JSON rather than
 * disappearing — a finding that showed nothing would be worse than one that
 * showed something ugly.
 */
function Evidence({ data }) {
  const entries = Object.entries(data || {});
  if (!entries.length) return null;

  const flat = entries.filter(([, v]) => !v || typeof v !== "object");
  const blocks = entries.filter(([, v]) => v && typeof v === "object");

  return (
    <div className="rv-ev">
      {flat.length > 0 && (
        <dl className="rv-ev-facts">
          {flat.map(([k, v]) => (
            <div key={k}>
              <dt>{label(k)}</dt>
              <dd className="mono">{value(k, v)}</dd>
            </div>
          ))}
        </dl>
      )}

      {blocks.map(([k, v]) => {
        // A list of like-shaped things: the five biggest trades, say.
        if (Array.isArray(v) && v.length && isRow(v[0])) {
          return (
            <div key={k} className="rv-ev-block">
              <div className="rv-ev-cap">{label(k)}</div>
              <EvTable rows={v.map((d) => ({ data: d }))} />
            </div>
          );
        }
        if (Array.isArray(v)) {
          return (
            <div key={k} className="rv-ev-block">
              <div className="rv-ev-cap">{label(k)}</div>
              <div className="rv-ev-list mono">{v.join(" · ") || "—"}</div>
            </div>
          );
        }
        const inner = Object.entries(v);
        // An object of objects — one row each, keyed by name.
        if (inner.length && inner.every(([, iv]) => isRow(iv))) {
          return (
            <div key={k} className="rv-ev-block">
              <div className="rv-ev-cap">{label(k)}</div>
              <EvTable firstCol="" rows={inner.map(([name, d]) => ({ name: label(name), data: d }))} />
            </div>
          );
        }
        // An object of plain numbers.
        if (inner.length && inner.every(([, iv]) => !iv || typeof iv !== "object")) {
          return (
            <div key={k} className="rv-ev-block">
              <div className="rv-ev-cap">{label(k)}</div>
              <dl className="rv-ev-facts">
                {inner.map(([ik, iv]) => (
                  <div key={ik}>
                    <dt>{label(ik)}</dt>
                    <dd className="mono">{value(ik, iv)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        }
        return (
          <div key={k} className="rv-ev-block">
            <div className="rv-ev-cap">{label(k)}</div>
            <pre className="mono rv-ev-raw">{JSON.stringify(v, null, 2)}</pre>
          </div>
        );
      })}
    </div>
  );
}

/**
 * A finding, read as a page rather than a paragraph.
 *
 * ORDER IS THE POINT. What was measured, then the numbers, then the reasoning,
 * then what it means. The old card put all four in one dense paragraph and led
 * with the arithmetic — "18 of 54 losing trades (33%) closed worse than −1.15R,
 * averaging −1.42R" — which asks somebody to parse a sentence to learn
 * something a number could have shown them, and buries the conclusion at the
 * end where it reads as an afterthought.
 *
 * THE FIGURES ARE LIFTED OUT OF THE PROSE, NOT ADDED TO IT. Every one already
 * appeared in the detail text; they are the same facts, given a size that
 * matches how much they matter.
 *
 * THE VERDICT IS THE PART PEOPLE CAME FOR, so it is last and it is marked. A
 * finding that measures something and never says what to do about it is a
 * statistic, not a review.
 *
 * FALLS BACK CLEANLY. A finding with no `figures` renders the way it always
 * did, so the eight not yet rewritten are unaffected.
 */
function FindingCard({ f, n }) {
  const sev = SEVERITY[f.severity] || SEVERITY.watch;
  const rich = Array.isArray(f.figures) && f.figures.length > 0;

  return (
    <div className="rv-card" style={{ borderLeftColor: sev.color }}>
      <div className="rv-card-head">
        <span className="rv-tag" style={{ color: sev.color, borderColor: sev.color }}>{sev.label}</span>
        <div className="rv-title">{f.title}</div>
      </div>

      {rich ? (
        <>
          {f.lede && <p className="rv-lede">{f.lede}</p>}
          <div className="rv-figs">
            {f.figures.map((g, i) => (
              <div className="rv-fig" key={i}>
                <b style={{ color: sev.color }}>{g.value}</b>
                <span>{g.label}</span>
              </div>
            ))}
          </div>
          {f.detail && <p className="rv-detail">{f.detail}</p>}
          {f.verdict && (
            <p className="rv-verdict" style={{ borderLeftColor: sev.color }}>
              {/* Named, because an unlabelled box of bold text reads as an
                  alert. This one is the answer, not the alarm. */}
              <b className="rv-verdict-cap">What it means</b>
              {f.verdict}
            </p>
          )}
        </>
      ) : (
        <p className="rv-detail">{f.detail}</p>
      )}

      {f.evidence && (
        <details className="rv-evidence">
          <summary>{rich ? "Check the numbers" : "Evidence"}</summary>
          <Evidence data={f.evidence} />
        </details>
      )}
    </div>
  );
}

export default function Review({ closed, stats, all, diary }) {
  /**
   * Setup fields the form no longer asks for by default.
   *
   * Folding them away only works if something eventually asks. Left alone the
   * "Base pattern" cut does not break, it hollows — one huge "Not recorded"
   * row with the real patterns as slivers beside it, and nobody ever decides
   * to lose it. This is the asking.
   */
  const gaps = useMemo(() => setupGaps(closed), [closed]);
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
    () => reviewFindings(closed, { regimes, stats, all, diary }),
    [closed, regimes, stats, all, diary]
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

      {gaps.length > 0 && (
        <div className="rv-gaps">
          <div className="eyebrow" style={{ marginBottom: 6 }}>Worth filling in</div>
          <p className="rv-gaps-lead">
            These are read off the chart, so they can be added any time — but until they
            are, the cut on the performance sheet that uses them is mostly one
            &ldquo;Not recorded&rdquo; row.
          </p>
          {gaps.map((g) => (
            <div key={g.key} className="rv-gap">
              <span>
                <b>{g.missing}</b> of {g.total} closed trades have no {g.label} recorded
                <span className="rv-dim"> · weakens {g.cut}</span>
              </span>
              <Link className="rv-gap-go" href={`/trades?missing=${g.key}`}>
                Show them →
              </Link>
            </div>
          ))}
        </div>
      )}

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
        .rv-gaps {
          border: 1px solid var(--rule); background: var(--card);
          border-radius: 3px; padding: 13px 15px; margin-bottom: 18px;
        }
        .rv-gaps-lead {
          font-size: 11.5px; color: var(--ink3); line-height: 1.6;
          margin: 0 0 9px; max-width: 620px; text-wrap: pretty;
        }
        .rv-gap {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--ink2);
          padding: 5px 0; border-top: 1px solid var(--rule);
        }
        .rv-gap:first-of-type { border-top: 0; }
        .rv-gap b { font-weight: 500; color: var(--ink); }
        .rv-gap-go {
          font-size: 11.5px; color: var(--brass); text-decoration: none;
          white-space: nowrap;
        }
        .rv-gap-go:hover { color: var(--ink); }
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

        /*
          The lede sits above the numbers and explains what is about to be
          counted, in words that assume nothing. It is the sentence that makes
          the difference between a screen you read and a screen you skim past
          because it opened with "−1.15R".
        */
        .rv-lede {
          font-size: 13.5px; line-height: 1.6; color: var(--ink2);
          margin: 9px 0 0; max-width: 68ch;
        }

        /*
          Hairline gaps rather than borders: the 1px background showing through
          a grid gap draws the dividers for free and keeps them from
          accumulating at the edges, where two adjacent borders would double.
        */
        .rv-figs {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
          gap: 1px; background: var(--rule);
          border: 1px solid var(--rule); border-radius: 3px;
          margin: 14px 0 0; overflow: hidden;
        }
        .rv-fig { background: var(--card); padding: 11px 12px 10px; }
        .rv-fig b {
          display: block; font-size: 21px; line-height: 1;
          letter-spacing: -0.02em; margin-bottom: 5px;
          font-variant-numeric: tabular-nums;
        }
        .rv-fig span {
          font-size: 10px; letter-spacing: 0.07em; text-transform: uppercase;
          color: var(--ink3); line-height: 1.35; display: block;
        }

        /*
          Tinted, not just ruled. The severity colour is already on the card's
          left edge; repeating it here is what ties the conclusion to the
          judgement rather than leaving it as one more paragraph.
        */
        .rv-verdict {
          margin: 14px 0 0; padding: 11px 13px;
          background: var(--paper); border-left: 3px solid var(--rule);
          font-size: 13.5px; line-height: 1.6; color: var(--ink);
          max-width: 72ch;
        }
        .rv-verdict-cap {
          display: block; font-size: 10px; letter-spacing: 0.09em;
          text-transform: uppercase; color: var(--ink3);
          margin-bottom: 4px; font-weight: 600;
        }

        .rv-evidence { margin-top: 10px; }
        .rv-evidence summary {
          cursor: pointer; font-size: 10.5px; font-weight: 600; letter-spacing: 0.09em;
          text-transform: uppercase; color: var(--ink3);
        }
        .rv-evidence summary:hover { color: var(--ink2); }
        .rv-ev { margin-top: 9px; }
        .rv-ev-block { margin-top: 12px; }
        .rv-ev-block:first-child { margin-top: 0; }
        .rv-ev-cap {
          font-family: 'Archivo', sans-serif; font-size: 9px; font-weight: 600;
          letter-spacing: 0.11em; text-transform: uppercase; color: var(--ink3);
          margin-bottom: 5px;
        }

        /* Facts read as pairs, so they wrap into as many columns as fit rather
           than being pinned to a count that is wrong on some screen. */
        /* Separators drawn by the cells, not by a ruled background showing
           through the gaps. Eight facts across seven columns leaves one alone
           on the last row, and a ruled background turns that leftover into a
           grey slab. A 1px spread over a 1px gap means neighbours share one
           line, so any number of cells wraps cleanly. Same trick as the
           headline numbers, for the same reason. */
        .rv-ev-facts {
          display: grid; gap: 1px; margin: 0;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          background: var(--card); border: 1px solid var(--rule); border-radius: 2px;
          overflow: hidden;
        }
        .rv-ev-facts > div {
          background: var(--card); padding: 7px 10px; min-width: 0;
          box-shadow: 0 0 0 1px var(--rule);
        }
        /* Labels wrap; values do not. A name is still a name over two lines,
           where "Everything else median he…" is not — and shortening the keys
           to fit a column width would be letting the CSS name the data. */
        .rv-ev-facts dt {
          font-size: 10px; color: var(--ink3); letter-spacing: 0.04em;
          line-height: 1.35; text-wrap: pretty;
        }
        .rv-ev-facts dd {
          margin: 2px 0 0; font-size: 13px; color: var(--ink);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        /* Its own scroller: a wide matrix must not widen the card and push the
           whole review sideways. */
        .rv-ev-scroll { overflow-x: auto; border: 1px solid var(--rule); border-radius: 2px; }
        /* Sized to its contents, not stretched to the card. Three columns
           pulled to full width put the symbol at one edge and the date at the
           other with a corridor between them; the scroller handles a matrix
           that genuinely is wide. */
        .rv-ev-table { width: auto; border-collapse: collapse; font-size: 11.5px; }
        .rv-ev-table th, .rv-ev-table td {
          padding: 6px 10px; text-align: left; white-space: nowrap;
          border-bottom: 1px solid var(--rule);
        }
        .rv-ev-table thead th {
          font-family: 'Archivo', sans-serif; font-size: 9px; font-weight: 600;
          letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink3);
          background: var(--paper);
        }
        .rv-ev-table tbody tr:last-child th,
        .rv-ev-table tbody tr:last-child td { border-bottom: 0; }
        .rv-ev-table tbody th { font-weight: 500; color: var(--ink2); }
        .rv-ev-table .num { text-align: right; font-variant-numeric: tabular-nums; }
        .rv-ev-table tbody td { color: var(--ink); font-family: var(--mono, monospace); }

        .rv-ev-list { font-size: 11.5px; color: var(--ink2); }
        .rv-ev-raw {
          background: var(--paper); border: 1px solid var(--rule); border-radius: 2px;
          padding: 10px 12px; margin: 0; font-size: 11px; line-height: 1.6;
          overflow-x: auto; color: var(--ink2);
        }

      `}</style>
    </div>
  );
}
