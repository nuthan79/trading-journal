"use client";

import { useMemo } from "react";
import { stats } from "@/lib/calc";
import { money } from "@/lib/format";
import { isExecutionError } from "@/lib/constants";

/**
 * THE REPORT. A whole-book review, written the way a research note is.
 *
 * WHY IT IS NOT THE OTHER SCREENS. What works cuts the record ten ways and
 * leaves the reading to you. Process says which stage is leaking. This asks a
 * different question again: taken as one document, what does the book say?
 * That is a thing you read twice a quarter, not a thing you check — so it is
 * allowed to be long, to lead with a conclusion, and to look unlike the rest
 * of the app.
 *
 * IT HAS ITS OWN VISUAL LANGUAGE, ON PURPOSE. Panels on a grey ground, a mono
 * face for every figure, a tag over each section and a verdict under it. The
 * app proper is an instrument you use at speed and its restraint is right for
 * that; a report is read, and reading wants contrast, rhythm and a place for
 * the eye to rest. Everything here is scoped under `.rp` so none of it leaks
 * into a screen that did not ask for it.
 *
 * EVERY FIGURE IS COMPUTED FROM THE BOOK IN FRONT OF IT. The document this
 * was modelled on was written once, by hand, about one export — its sentences
 * name specific trades and a specific month. Nothing here may do that: it has
 * to hold for any book on any day, which is why the prose states what the
 * numbers are and leaves the judgement to the reader wherever a rule cannot
 * carry it honestly.
 */

const n = (v) => (v === "" || v == null ? NaN : Number(v));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const pct = (v, dp = 0) => (Number.isFinite(v) ? `${v.toFixed(dp)}%` : "—");
const rr = (v, dp = 2) => (Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(dp)}R` : "—");

/** Shortened money for a chart label, where the full string will not fit. */
const short = (v) => {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${s}₹${Math.round(a / 1e3)}k`;
  return `${s}₹${Math.round(a)}`;
};

const day = (t) => (t?.exit_date ? String(t.exit_date).slice(0, 10) : "");

/**
 * An entry mistake, as opposed to a regret about the exit.
 *
 * `Sold too early` and `Undersized` are tagged on WINNERS and mean the
 * opposite thing — counted among mistakes they would drag the very split this
 * report is built around into nonsense. isExecutionError already draws that
 * line for the mistake tables, and drawing it twice is how two screens come to
 * disagree about what a mistake is.
 */
const ENTRY_REGRETS = new Set(["Sold too early", "Sold a little late", "Undersized"]);
const entryMistakes = (t) =>
  (t?.mistakes || []).filter((m) => isExecutionError(m) && !ENTRY_REGRETS.has(m));

/* ------------------------------------------------------------------ */

/** The running total, and how far below its own peak it has been. */
function curve(closed) {
  const rows = closed.filter(day).slice().sort((a, b) => (day(a) < day(b) ? -1 : 1));
  let cum = 0, peak = 0;
  return rows.map((t) => {
    cum += n(t.pnl) || 0;
    peak = Math.max(peak, cum);
    return { date: day(t), cum, dd: cum - peak };
  });
}

function Curve({ points }) {
  if (points.length < 2) return null;
  const W = 900, H = 250, DH = 70, PL = 66, PR = 14, T = 12;
  const iw = W - PL - PR;
  const hi = Math.max(...points.map((p) => p.cum), 0);
  const lo = Math.min(...points.map((p) => p.cum), 0);
  const span = hi - lo || 1;
  const x = (i) => PL + (i / (points.length - 1)) * iw;
  const y = (v) => T + H * (hi - v) / span;

  const worstDd = Math.min(...points.map((p) => p.dd));
  const ddSpan = Math.abs(worstDd) || 1;
  const dy = (v) => T + H + 34 + (Math.abs(v) / ddSpan) * DH;

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.cum).toFixed(1)}`).join("");
  const area = `${line}L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
  const ddPath = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${dy(p.dd).toFixed(1)}`).join("")
    + `L${x(points.length - 1).toFixed(1)},${dy(0)}L${x(0).toFixed(1)},${dy(0)}Z`;

  /* Four gridlines, on round money rather than on even fractions of the
     range — "₹5L" is a number somebody holds in their head and "₹4.83L" is
     not. */
  const step = Math.pow(10, Math.floor(Math.log10(span / 3)));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => span / s <= 4) || step;
  const ticks = [];
  for (let v = Math.ceil(lo / nice) * nice; v <= hi; v += nice) ticks.push(v);

  return (
    <svg viewBox={`0 0 ${W} ${H + DH + 60}`} className="rp-svg">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)}
                stroke={v === 0 ? "var(--rp-ink)" : "var(--rp-grid)"} strokeWidth={v === 0 ? 1.4 : 1} />
          <text x={PL - 9} y={y(v) + 4} textAnchor="end" className="rp-ax">{short(v)}</text>
        </g>
      ))}
      <path d={area} fill="var(--rp-pos)" fillOpacity="0.08" />
      <path d={line} fill="none" stroke="var(--rp-pos)" strokeWidth="2" />
      <path d={ddPath} fill="var(--rp-neg)" fillOpacity="0.18" />
      <text x={PL - 9} y={dy(0) + 4} textAnchor="end" className="rp-ax">0</text>
      <text x={PL - 9} y={dy(worstDd) + 4} textAnchor="end" className="rp-ax">{short(worstDd)}</text>
      <text x={PL} y={H + DH + 52} className="rp-ax">{points[0].date}</text>
      <text x={W - PR} y={H + DH + 52} textAnchor="end" className="rp-ax">
        {points[points.length - 1].date}
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */

/**
 * THE SAME BOOK THROUGH EACH SCREEN.
 *
 * Every other cut in the app splits the record into groups that add back up to
 * it. This does the opposite: it asks what would be left if you had only taken
 * the trades matching one condition, and then two together. Conditions that
 * are worth anything compound — and the ones that do not are just as useful to
 * see, which is why the whole ladder is shown rather than the best row.
 *
 * It is NOT a backtest and the copy says so. These are the trades that were
 * actually taken; nobody knows which of the excluded ones would have been
 * skipped in real time, or what would have been taken instead.
 */
function screens(closed) {
  const scored = closed.filter((t) => Number.isFinite(t.r));
  const clean = (t) => entryMistakes(t).length === 0;
  const stage2 = (t) => String(t.weinstein_stage || "") === "2";
  const held = (t) => Number.isFinite(n(t.heldDays)) && n(t.heldDays) >= 21;

  const rows = [
    ["Every closed trade", () => true],
    ["No entry mistake logged", clean],
    ["Weinstein stage 2", stage2],
    ["Held 21 days or more", held],
    ["Stage 2, no entry mistake", (t) => stage2(t) && clean(t)],
    ["No entry mistake, held 21+", (t) => clean(t) && held(t)],
  ];

  return rows.map(([label, f]) => {
    const g = scored.filter(f);
    const s = stats(g);
    return {
      label, n: g.length,
      winRate: s.n ? s.winRate : NaN,
      expectancy: s.n ? s.expectancy : NaN,
      net: sum(g.map((t) => n(t.pnl) || 0)),
    };
  });

  /*
    A SCREEN THAT CHANGES NOTHING IS NOT A SCREEN. On a book with no mistake
    tags, "no entry mistake logged" matches every trade and prints the first
    row again; so does every pair built on it. Rows are kept only where the
    condition actually excluded something the row above had, which leaves the
    ladder honest on a half-filled book instead of implying six findings where
    there is one.
  */
  const out = [];
  for (const r of rows) {
    if (!r.n) continue;
    if (out.length && out.some((k) => k.n === r.n)) continue;
    out.push(r);
  }
  return out;
}

/* ------------------------------------------------------------------ */

export default function Report({ closed = [], accountSize = 0 }) {
  const pts = useMemo(() => curve(closed), [closed]);
  const s = useMemo(() => stats(closed.filter((t) => Number.isFinite(t.r))), [closed]);
  const rows = useMemo(() => screens(closed), [closed]);

  const net = useMemo(() => sum(closed.map((t) => n(t.pnl) || 0)), [closed]);
  const worstDd = pts.length ? Math.min(...pts.map((p) => p.dd)) : 0;
  const ddPct = accountSize > 0 ? (worstDd / accountSize) * 100 : NaN;

  const split = useMemo(() => {
    const scored = closed.filter((t) => Number.isFinite(t.r));
    const a = scored.filter((t) => entryMistakes(t).length === 0);
    const b = scored.filter((t) => entryMistakes(t).length > 0);
    return { a: { n: a.length, s: stats(a), net: sum(a.map((t) => n(t.pnl) || 0)) },
             b: { n: b.length, s: stats(b), net: sum(b.map((t) => n(t.pnl) || 0)) } };
  }, [closed]);

  if (closed.length < 10) {
    return (
      <div className="rp">
        <div className="rp-empty">
          A report needs a record to read. Come back with a few dozen closed trades —
          the cuts below need enough in each group to mean anything, and on ten they
          would just be describing luck.
        </div>
        <Styles />
      </div>
    );
  }

  const figs = [
    [money(net), "Net realised"],
    [rr(s.expectancy), "Expectancy"],
    [pct(s.winRate, 1), "Win rate"],
    [Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "—", "Profit factor"],
    [rr(s.totalR, 1), "Total R"],
    [Number.isFinite(ddPct) ? pct(ddPct, 1) : short(worstDd), "Worst drawdown"],
    [`${closed.length}`, "Closed trades"],
  ];

  const best = rows.reduce((m, r) => (r.expectancy > (m?.expectancy ?? -Infinity) ? r : m), null);

  return (
    <div className="rp">
      <header className="rp-head">
        <p className="rp-eyebrow">
          {pts.length ? `${pts[0].date} – ${pts[pts.length - 1].date} · ` : ""}
          {closed.length} closed trades
        </p>
        <h1>Your book, read as one document.</h1>
        <p className="rp-sub">
          Everything here is computed from the trades you have logged. Where a figure
          rests on a field you have not been filling in, the section says so rather than
          quietly leaving those trades out.
        </p>
      </header>

      <div className="rp-figs">
        {figs.map(([v, l]) => (
          <div className="rp-fig" key={l}>
            <b data-neg={String(v).startsWith("−") || String(v).startsWith("-") ? 1 : 0}>{v}</b>
            <span>{l}</span>
          </div>
        ))}
      </div>

      <section className="rp-sec">
        <p className="rp-tag">01 · The record</p>
        <h2>{money(net)} realised, worst drawdown {Number.isFinite(ddPct) ? pct(Math.abs(ddPct), 1) : short(worstDd)}</h2>
        <p className="rp-lede">
          Cumulative realised P&amp;L by exit date, with the distance below its own peak
          underneath it. Every step is a closed position.
        </p>
        <Curve points={pts} />
        <div className="rp-legend">
          <span><i data-c="pos" /> Cumulative realised</span>
          <span><i data-c="neg" /> Drawdown from peak</span>
        </div>
        <p className="rp-verdict">
          <b>{rr(s.totalR, 1)} over {closed.length} trades, {pct(s.winRate, 1)} of them won.</b>{" "}
          A shallow drawdown next to a long climb usually means the risk per trade is
          small rather than the losses rare — the win rate beside it is what tells you
          which.
        </p>
      </section>

      <section className="rp-sec">
        <p className="rp-tag" data-bad={split.b.n && split.b.s.expectancy < split.a.s.expectancy ? 1 : 0}>
          02 · The filter you already have
        </p>
        <h2>
          {split.b.n === 0
            ? "No entry mistake logged on any trade"
            : `Trades you tagged with an entry mistake return ${rr(split.b.s.expectancy)}`}
        </h2>
        <p className="rp-lede">
          Split by whether you logged a mistake about the ENTRY. Regrets about the exit —
          sold too early, sold a little late, undersized — are left out: they are tagged
          on winners and mean the opposite thing.
        </p>
        {split.b.n === 0 ? (
          <p className="rp-note">
            Nothing to split yet. This becomes the most useful section in the report the
            moment you start tagging what went wrong on the entries that failed.
          </p>
        ) : (
          <table className="rp-t">
            <thead>
              <tr><th>Group</th><th>Trades</th><th>Win rate</th><th>Expectancy</th><th>Net</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>No entry mistake</td><td>{split.a.n}</td>
                <td>{pct(split.a.s.winRate, 0)}</td><td>{rr(split.a.s.expectancy)}</td>
                <td>{money(split.a.net)}</td>
              </tr>
              <tr data-bad="1">
                <td>One or more</td><td>{split.b.n}</td>
                <td>{pct(split.b.s.winRate, 0)}</td><td>{rr(split.b.s.expectancy)}</td>
                <td>{money(split.b.net)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {split.b.n > 0 && (
          <p className="rp-verdict" data-bad="1">
            <b>The note you write after the trade is a working filter.</b> It runs after
            the money is committed rather than before — which is the whole of the
            opportunity, and the whole of the difficulty.
          </p>
        )}
      </section>

      <section className="rp-sec">
        <p className="rp-tag">03 · Through each screen</p>
        <h2>What the book looks like with one condition applied</h2>
        <p className="rp-lede">
          Not groups that add back up to the book — each row is the whole record with one
          condition applied, and then two together. Conditions worth anything compound.
        </p>
        <table className="rp-t">
          <thead>
            <tr><th>Screen</th><th>Trades</th><th>Win rate</th><th>Expectancy</th><th>Net</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} data-hl={best && r.label === best.label ? 1 : 0}>
                <td>{r.label}</td>
                <td>{r.n}</td>
                <td>{pct(r.winRate, 0)}</td>
                <td>{rr(r.expectancy)}</td>
                <td>{money(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="rp-verdict">
          <b>This is not a backtest.</b> These are trades you actually took. Nobody knows
          which of the excluded ones you would have skipped in real time, or what you
          would have taken instead — the ladder shows which conditions travelled with
          your good trades, not what following them would have paid.
        </p>
      </section>

      <Styles />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Styles() {
  return (
    <style jsx global>{`
      /*
        THE REPORT'S OWN LANGUAGE, scoped under .rp so it reaches nothing else.
        Panels on a grey ground, mono for every figure, a tag over each section
        and a verdict under it. The app is an instrument read at speed; this is
        a document, and a document wants contrast and rhythm.
      */
      .rp {
        --rp-ground: #E9EDF1; --rp-panel: #FFF; --rp-ink: #12202E; --rp-muted: #647A8C;
        --rp-grid: #D4DCE4; --rp-rule: #C3CDD7;
        --rp-pos: #0F766E; --rp-neg: #B02E26; --rp-acc: #E08700; --rp-accs: #FBEDD2;
        background: var(--rp-ground); color: var(--rp-ink);
        margin: 0 -20px; padding: 0 24px 80px;
        font-size: 15px; line-height: 1.55;
      }
      .rp-head { padding: 40px 0 26px; border-bottom: 2px solid var(--rp-ink); }
      .rp-eyebrow {
        font-family: var(--mono, ui-monospace, monospace); font-size: 11px;
        letter-spacing: 0.16em; text-transform: uppercase; color: var(--rp-muted); margin: 0 0 14px;
      }
      .rp h1 {
        font-weight: 700; font-size: clamp(27px, 4.4vw, 44px); line-height: 1.05;
        letter-spacing: -0.025em; margin: 0 0 14px; max-width: 20ch;
      }
      .rp-sub { max-width: 64ch; color: #33475A; margin: 0; font-size: 14.5px; }

      /* Bordered per cell rather than a grid of gaps over a coloured
         background: seven figures in a six-wide row left the seventh alone
         beside a slab of the rule colour, which read as a missing tile. */
      .rp-figs {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
        border-bottom: 1px solid var(--rp-rule); margin-bottom: 24px;
      }
      .rp-fig {
        background: var(--rp-ground); padding: 16px 14px 14px;
        border-top: 1px solid var(--rp-rule); border-right: 1px solid var(--rp-rule);
      }
      .rp-fig:first-child { border-left: 1px solid var(--rp-rule); }
      .rp-fig b {
        display: block; font-family: var(--mono, ui-monospace, monospace); font-weight: 600;
        font-size: 22px; letter-spacing: -0.02em; line-height: 1; margin-bottom: 7px;
      }
      .rp-fig b[data-neg="1"] { color: var(--rp-neg); }
      .rp-fig span {
        font-size: 10.5px; color: var(--rp-muted); letter-spacing: 0.05em;
        text-transform: uppercase; font-family: var(--mono, ui-monospace, monospace);
      }

      .rp-sec {
        background: var(--rp-panel); border: 1px solid var(--rp-rule);
        margin-bottom: 24px; padding: 26px 28px 22px;
      }
      .rp-tag {
        font-family: var(--mono, ui-monospace, monospace); font-size: 11px;
        letter-spacing: 0.14em; text-transform: uppercase; color: var(--rp-acc); margin: 0 0 8px;
      }
      .rp-tag[data-bad="1"] { color: var(--rp-neg); }
      .rp-sec h2 {
        font-weight: 600; font-size: 21px; letter-spacing: -0.015em; margin: 0 0 8px;
        line-height: 1.25;
      }
      .rp-lede { color: #33475A; margin: 0 0 20px; max-width: 76ch; font-size: 14.5px; }
      .rp-note { color: var(--rp-muted); margin: 0; font-size: 14px; max-width: 76ch; }
      .rp-verdict {
        margin: 20px 0 0; padding: 13px 15px; background: var(--rp-accs);
        border-left: 3px solid var(--rp-acc); font-size: 14px; max-width: 86ch;
      }
      .rp-verdict[data-bad="1"] { background: #FBEAE8; border-left-color: var(--rp-neg); }

      .rp-svg { display: block; width: 100%; height: auto; overflow: visible; }
      .rp-ax { font-family: var(--mono, ui-monospace, monospace); font-size: 10.5px; fill: var(--rp-muted); }
      .rp-legend {
        display: flex; flex-wrap: wrap; gap: 16px; margin-top: 12px;
        font-family: var(--mono, ui-monospace, monospace); font-size: 11px; color: var(--rp-muted);
      }
      .rp-legend i {
        display: inline-block; width: 11px; height: 11px; margin-right: 6px;
        vertical-align: -1px; border-radius: 1px;
      }
      .rp-legend i[data-c="pos"] { background: var(--rp-pos); }
      .rp-legend i[data-c="neg"] { background: var(--rp-neg); opacity: 0.5; }

      .rp-t {
        width: 100%; border-collapse: collapse;
        font-family: var(--mono, ui-monospace, monospace); font-size: 12.5px; margin-top: 4px;
      }
      .rp-t th {
        text-align: right; font-weight: 500; color: var(--rp-muted); font-size: 10px;
        letter-spacing: 0.08em; text-transform: uppercase; padding: 0 0 9px;
        border-bottom: 1px solid var(--rp-rule);
      }
      .rp-t th:first-child, .rp-t td:first-child { text-align: left; }
      .rp-t td { text-align: right; padding: 9px 0; border-bottom: 1px solid #EDF1F4; }
      .rp-t tr[data-hl="1"] td { background: var(--rp-accs); font-weight: 600; }
      .rp-t tr[data-bad="1"] td { background: #FBEAE8; }

      .rp-empty {
        background: var(--rp-panel); border: 1px solid var(--rp-rule);
        padding: 28px 30px; margin-top: 28px; max-width: 70ch; color: #33475A;
      }
      @media (max-width: 760px) {
        .rp { margin: 0 -14px; padding: 0 14px 56px; }
        .rp-sec { padding: 20px 16px; }
      }
    `}</style>
  );
}
