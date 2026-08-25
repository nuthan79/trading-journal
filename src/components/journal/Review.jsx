"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, track } from "@/lib/db";
import { reviewFindings, reviewThesis } from "@/lib/analysis";
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
/**
 * Keys whose generated label is technically correct and useless.
 *
 * `label()` turns camelCase into words, which gets "Sd risk %" and "Coeff
 * variation" and "Over2pct" — variable names with spaces in. These are the
 * ones a reader would have to already know the code to understand.
 */
const KEY_NAMES = {
  sdRiskPct: "Spread of risk",
  coeffVariation: "How spread out",
  over2pct: "Trades over 2%",
  avgRiskPct: "Average risk",
  minRiskPct: "Smallest risk",
  maxRiskPct: "Largest risk",
  firstQuarterAvg: "First quarter",
  lastQuarterAvg: "Most recent quarter",
  changePct: "Change",
  beyondStopCount: "Past the stop",
  beyondStopPct: "Share past the stop",
  medianLossR: "Typical loss",
  worstLossR: "Worst loss",
  avgOverrunR: "Average overrun",
  taggedIgnoredStop: 'Tagged "ignored the stop"',
  sizeOutcomeCorrelation: "Size vs outcome",
  avgRiskAfterLoss: "Risk after a loss",
  avgRiskAfterWin: "Risk after a win",
  differencePct: "Difference",
  sampleAfterLoss: "Trades after a loss",
};

function label(key) {
  if (KEY_NAMES[key]) return KEY_NAMES[key];
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
 * Two shapes, three findings, no chart library.
 *
 * WHY NOT ONE PER FINDING. Fourteen bespoke SVGs is what the page that
 * inspired this did, and it could — it was drawn once, by hand, for one
 * export. This has to render whatever a live account contains, so every chart
 * is a shape with a contract rather than a drawing: give `strip` a list of
 * values and a line, give `bars` a list of labelled values.
 *
 * COLOURS COME FROM THE FINDING'S SEVERITY, not from a palette of their own.
 * The card already carries that colour on its left edge; a chart that
 * introduced a second one would make the reader work out whether the two mean
 * the same thing.
 */

/** Values on one axis with a line drawn through it. The whole point is how
 *  many sit past the line, so the region beyond it is tinted and those points
 *  take the finding's colour. */
function StripChart({ data, color }) {
  const W = 640, H = 132, PAD = 34, BASE = 84;
  const vs = data.points.map((p) => p.v);
  const lo = Math.min(...vs, data.threshold) - 0.25;
  const hi = Math.max(...vs, 0) + 0.15;
  const x = (v) => PAD + ((v - lo) / (hi - lo)) * (W - PAD * 2);
  const tx = x(data.threshold);
  const past = data.points.filter((p) => p.past).length;

  /* Points can land on the same value, so they stack upward instead of
     overprinting — an overlap would hide exactly the count being claimed. */
  const seen = new Map();
  const placed = data.points.map((p) => {
    const key = Math.round(x(p.v));
    const tier = seen.get(key) || 0;
    seen.set(key, tier + 1);
    return { ...p, cx: x(p.v), cy: BASE - tier * 11 };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rv-chart" role="img"
         aria-label={`${past} of ${data.points.length} past ${data.thresholdLabel}`}>
      {/* Everything worse than the line, shaded — the area the finding is about. */}
      {/* The area past the line, named inside itself — a tint with no label
          is decoration, and the count in it is the entire finding. */}
      <rect x={PAD} y={14} width={Math.max(0, tx - PAD)} height={BASE + 6 - 14}
            fill={color} opacity="0.08" />
      {past > 0 && (
        <text x={PAD + 6} y={28} className="rv-chart-val" fill={color}>
          {past} past your stop
        </text>
      )}
      <line x1={PAD} x2={W - PAD} y1={BASE + 6} y2={BASE + 6}
            stroke="var(--rule)" strokeWidth="1" />
      <line x1={tx} x2={tx} y1={12} y2={BASE + 14} stroke={color}
            strokeWidth="1.5" strokeDasharray="4 3" />
      <text x={tx} y={H - 22} textAnchor="middle" className="rv-chart-lbl" fill={color}>
        {data.thresholdLabel} · {String(data.threshold).replace("-", "\u2212")}{data.unit}
      </text>
      {placed.map((p, i) => (
        <circle key={i} cx={p.cx} cy={p.cy} r="5"
                fill={p.past ? color : "var(--card)"}
                stroke={p.past ? color : "var(--ink3)"} strokeWidth="1.6">
          <title>{`${p.label}: ${String(p.v).replace("-", "\u2212")}${data.unit}`}</title>
        </circle>
      ))}
      <text x={PAD} y={H - 22} className="rv-chart-lbl">bigger losses</text>
      <text x={W - PAD} y={H - 22} textAnchor="end" className="rv-chart-lbl">
        {`break even · 0${data.unit}`}
      </text>
    </svg>
  );
}

/** Labelled horizontal bars. Reads left to right like the sentence it
 *  replaces, and holds long labels — an exit reason is words, not a number. */
function BarsChart({ data, color }) {
  const rows = data.rows;
  /* PAD_R holds the value label, which is the widest thing on the row —
     "+3.12R · 10" ran past the viewBox at 58 and lost its count. */
  const W = 640, ROW = 30, PAD_L = 132, PAD_R = 84;
  const H = rows.length * ROW + 22;
  const vals = rows.map((r) => r.value);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const x = (v) => PAD_L + ((v - lo) / span) * (W - PAD_L - PAD_R);
  const zero = x(0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rv-chart" role="img"
         aria-label={rows.map((r) => `${r.label} ${r.value}${data.unit}`).join(", ")}>
      <line x1={zero} x2={zero} y1={4} y2={rows.length * ROW + 2}
            stroke="var(--rule)" strokeWidth="1" />
      {rows.map((r, i) => {
        const y = i * ROW + 6, h = ROW - 14;
        const x0 = Math.min(zero, x(r.value)), w = Math.abs(x(r.value) - zero);
        /* The weakest row is the finding on the exit-method card, so it is the
           one drawn solid; everything else recedes. Where no row is flagged
           (the size buckets) they share one weight and the shape does the
           talking. */
        const strong = r.worst || (r.worst === undefined && r.value === Math.min(...vals));
        return (
          <g key={i}>
            <text x={PAD_L - 10} y={y + h - 2} textAnchor="end" className="rv-chart-lbl">
              {r.label}
            </text>
            <rect x={x0} y={y} width={Math.max(2, w)} height={h}
                  fill={color} opacity={strong ? 0.9 : 0.42} rx="1" />
            <text x={Math.max(zero, x(r.value)) + 8} y={y + h - 2} className="rv-chart-val">
              {r.value > 0 ? "+" : ""}{r.value.toFixed(2).replace("-", "−")}{data.unit}
              {r.n != null && <tspan className="rv-chart-lbl"> · {r.n}</tspan>}
            </text>
          </g>
        );
      })}
      {data.axisNote && (
        <text x={PAD_L} y={H - 3} className="rv-chart-lbl">{data.axisNote}</text>
      )}
    </svg>
  );
}

/** A value per trade, in order, with the claim drawn across it as lines.
 *  Dots not a path: these are separate decisions, not a continuous quantity,
 *  and joining them would invent a journey between two trades that had none. */
function SeriesChart({ data, color }) {
  /* PAD_R carries the band label, which is a value AND a phrase — "0.39% your
     average" lost its last word at 96. */
  const W = 640, H = 150;
  const PAD_L = 40, PAD_R = 138, TOP = 14, BASE = 112;
  /* Points may be plain numbers or {v, win}. */
  const pts = data.points.map((p) => (typeof p === "number" ? { v: p, win: null } : p));
  const bands = data.bands || [];
  const hi = Math.max(...pts.map((p) => p.v), ...bands.map((b) => b.value)) * 1.08;
  const x = (i) => PAD_L + (i / Math.max(1, pts.length - 1)) * (W - PAD_L - PAD_R);
  const y = (v) => BASE - (v / (hi || 1)) * (BASE - TOP);
  const won = pts.filter((p) => p.win === true).length;
  const lost = pts.filter((p) => p.win === false).length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rv-chart" role="img"
         aria-label={`Risk per trade across ${pts.length} trades`}>
      <line x1={PAD_L} x2={W - PAD_R} y1={BASE} y2={BASE} stroke="var(--rule)" />
      <text x={PAD_L - 6} y={TOP + 4} textAnchor="end" className="rv-chart-lbl">
        {hi.toFixed(2)}{data.unit}
      </text>
      <text x={PAD_L - 6} y={BASE + 4} textAnchor="end" className="rv-chart-lbl">0</text>
      {/* Coloured by outcome, not by severity — the one place on this screen a
          second colour earns itself, because it carries a fact the shape
          cannot: whether the bet worked. Green and red are already what gain
          and loss mean everywhere else in the app, so nothing new is being
          taught. A trade with no R stays grey rather than guessing. */}
      {pts.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.v)} r="2.6"
                fill={p.win === null ? "var(--ink3)" : p.win ? "var(--long)" : "var(--short)"}
                opacity={p.win === null ? 0.35 : 0.65} />
      ))}
      {/* Drawn after the points so the claim sits on top of its evidence. */}
      {bands.map((b, i) => (
        <g key={i}>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(b.value)} y2={y(b.value)}
                stroke={color} strokeWidth={b.strong ? 2 : 1.4}
                strokeDasharray={b.strong ? "" : "5 4"} opacity={b.strong ? 1 : 0.6} />
          <text x={W - PAD_R + 8} y={y(b.value) + 4}
                className={b.strong ? "rv-chart-val" : "rv-chart-lbl"}
                fill={b.strong ? color : "var(--ink3)"}>
            {b.value}{data.unit} {b.label}
          </text>
        </g>
      ))}
      {/* Note and legend share one baseline — stacked, they sat on top of the
          figure caption below and the two lines overlapped. The legend starts
          after the note, measured off its own length rather than a guessed
          offset, since the note differs per finding. */}
      {data.axisNote && (
        <text x={PAD_L} y={H - 6} className="rv-chart-lbl">{data.axisNote}</text>
      )}
      {data.pointLegend && (won > 0 || lost > 0) && (() => {
        const after = PAD_L + (data.axisNote ? data.axisNote.length * 5.35 + 26 : 0);
        return (
          <g>
            <circle cx={after + 4} cy={H - 10} r="3.4" fill="var(--long)" opacity="0.65" />
            <text x={after + 13} y={H - 6} className="rv-chart-lbl">{won} won</text>
            <circle cx={after + 74} cy={H - 10} r="3.4" fill="var(--short)" opacity="0.65" />
            <text x={after + 83} y={H - 6} className="rv-chart-lbl">{lost} lost</text>
          </g>
        );
      })()}
    </svg>
  );
}

function FindingChart({ chart, color }) {
  if (!chart) return null;
  if (chart.type === "strip") return <StripChart data={chart} color={color} />;
  if (chart.type === "bars") return <BarsChart data={chart} color={color} />;
  if (chart.type === "series") return <SeriesChart data={chart} color={color} />;
  return null;
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
          {/* The chart is the centre of the card, not an illustration under
              it. The figures that used to sit here in boxes now read as its
              caption — the same numbers, but a legend for something you can
              already see rather than three tiles to be taken on trust. */}
          {f.chart && <FindingChart chart={f.chart} color={sev.color} />}
          {f.figures.length > 0 && (
            <p className="rv-cap">
              {f.figures.map((g, i) => (
                <span key={i}>
                  <b style={{ color: sev.color }}>{g.value}</b> {g.label}
                </span>
              ))}
            </p>
          )}
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

  /**
   * One sentence about the whole record, above everything.
   *
   * The screen used to open on a market-regime strip and a list of empty
   * fields — housekeeping — and left the reader to assemble a verdict from
   * eleven cards sorted by severity. Every finding said something true and
   * nothing said what the record amounted to.
   */
  const thesis = useMemo(
    () => reviewThesis(closed, result.findings, stats),
    [closed, result, stats]
  );

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
      {thesis && (
        <header className="rv-thesis">
          <p className="rv-thesis-eyebrow">
            {thesis.trades} closed trades · {thesis.expectancy > 0 ? "+" : ""}
            {thesis.expectancy}R average · {thesis.winRate}% of them won
          </p>
          <h2 className="rv-thesis-h" data-tone={thesis.tone}>
            {thesis.edge}.{" "}
            {thesis.subject
              ? <>The thing in the way is <em>{thesis.subject}</em>.</>
              : <>Nothing here is working against you.</>}
          </h2>
          {thesis.thin && (
            <p className="rv-thesis-note">
              Read this lightly — under thirty closed trades, none of it separates
              a method from a run of luck.
            </p>
          )}
        </header>
      )}
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

        /* Full width of the card, height from its own viewBox — these are
           drawn to be read at a glance, so they get the room. */
        /*
          The thesis, set as a page opens rather than as another card. It sits
          outside the severity groups on purpose — it is about the record, not
          about one check, and putting it in a bordered box would file it as
          the twelfth finding.
        */
        .rv-thesis { margin: 0 0 18px; }
        .rv-thesis-eyebrow {
          font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase;
          color: var(--ink3); margin: 0 0 10px;
          font-variant-numeric: tabular-nums;
        }
        .rv-thesis-h {
          font-family: 'Archivo', sans-serif; font-stretch: 125%; font-weight: 600;
          font-size: clamp(21px, 3.1vw, 31px); line-height: 1.15;
          letter-spacing: -0.02em; margin: 0; max-width: 22ch;
          text-wrap: balance; color: var(--ink);
        }
        /* Only the SUBJECT is coloured — the clause naming what is wrong. The
           edge verdict stays in ink so the sentence does not read as two
           competing alarms. */
        .rv-thesis-h em { font-style: normal; color: var(--brass); }
        .rv-thesis-h[data-tone="bad"] em { color: var(--short); }
        .rv-thesis-note {
          font-size: 12.5px; color: var(--ink3); margin: 10px 0 0; max-width: 60ch;
        }

        .rv-chart { display: block; width: 100%; height: auto; margin: 14px 0 0; }
        .rv-chart-lbl {
          font-size: 10.5px; fill: var(--ink3);
          letter-spacing: 0.02em;
        }
        .rv-chart-val {
          font-size: 11.5px; fill: var(--ink); font-weight: 600;
          font-variant-numeric: tabular-nums;
        }

        /* The chart's caption. One line, wrapping, rather than a row of tiles:
           these numbers now label something visible instead of standing in
           for it. */
        /* Centred: it is the chart's caption, and left-aligned under a
           full-width drawing it read as the start of the paragraph below
           rather than as a label for the picture above. */
        .rv-cap {
          display: flex; flex-wrap: wrap; justify-content: center;
          gap: 4px 18px;
          margin: 10px 0 0; font-size: 11px; color: var(--ink3);
          letter-spacing: 0.03em;
        }
        .rv-cap b {
          font-size: 13px; font-variant-numeric: tabular-nums;
          letter-spacing: -0.01em;
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
