"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  emotionEdge, emotionSpread, mindsetProfile, coverage,
  errorsByEntryState, exitMismatch, THIN_EMOTION, MIN_MISMATCH,
} from "@/lib/mindset";
import { isConstructiveEntry } from "@/lib/constants";
import { rfmt, pct } from "@/lib/format";

/**
 * How the trading felt, set against what it returned.
 *
 * THE PAGE IS ONE FINDING AND ITS SUPPORTING CAST. That finding is expectancy
 * by entry state: if the trades taken while chasing lose money and the ones
 * taken while patient make it, that is a rule the trader can apply tomorrow.
 * The flow diagram and the profile are ways of looking at it, and they are
 * arranged underneath it rather than above it, because a picture placed first
 * gets admired and a number placed first gets used.
 *
 * WHAT IT REFUSES TO DO. It does not score anything it cannot count — the
 * reference design had a "pattern recognition" axis and there is no honest way
 * to compute that from a trade log, so it is absent rather than invented. It
 * does not infer a feeling that was never recorded. And it says what every
 * figure is drawn from, because a flow diagram built on four trades is a
 * curiosity and presenting it as a finding is how a feature stops being
 * believed.
 */

/* Reactive states are drawn warm, settled ones cool. Not red/green: a state is
   not a result, and colouring "Anxious" like a loss prejudges a trade that may
   have been perfectly good. */
const stateColor = (e) => (isConstructiveEntry(e) ? "var(--long)" : "var(--brass)");

/** Higher is better on all four, so the arc may be colour-coded — but muted,
 *  because a habit score is a thing to work on rather than an alarm. */
const scoreTone = (s) => (s >= 80 ? "var(--long)" : s >= 55 ? "var(--brass)" : "var(--short)");
const TREND_MARK = { up: "▲", down: "▼", flat: "—" };

/**
 * One habit as a dial.
 *
 * The arc is drawn with stroke-dasharray on a circle rather than as an SVG
 * path, which keeps it to two elements and makes the sweep exactly
 * proportional with no trigonometry to get wrong. Rotated −90° so it starts at
 * twelve o'clock, which is the only place a gauge can start without looking
 * like a mistake.
 */
function Gauge({ a }) {
  const has = Number.isFinite(a.score);
  const score = has ? a.score : 0;
  const R = 34, C = 2 * Math.PI * R;
  const tone = has ? scoreTone(score) : "var(--ink3)";

  return (
    <div className="ms-gauge">
      <svg viewBox="0 0 84 84" className="ms-dial" role="img"
           aria-label={`${a.label}: ${has ? Math.round(score) : "not measurable"} out of 100`}>
        <circle cx="42" cy="42" r={R} className="ms-track" />
        {has ? (
          <circle cx="42" cy="42" r={R} className="ms-arc"
                  stroke={tone}
                  strokeDasharray={`${(score / 100) * C} ${C}`} />
        ) : null}
        <text x="42" y="44" textAnchor="middle" className="ms-dialnum"
              style={{ fill: has ? "var(--ink)" : "var(--ink3)" }}>
          {has ? Math.round(score) : "—"}
        </text>
        <text x="42" y="55" textAnchor="middle" className="ms-dialmax">/ 100</text>
      </svg>

      <b className="ms-gname">{a.label}</b>
      <span className="ms-gband">{a.band || "Not measurable"}</span>
      {/* Only shown once both halves of the record have enough trades to be
          compared. No trend is a truthful answer; an arrow drawn from three
          trades is not. */}
      {a.trend ? (
        <span className={`ms-gtrend ms-gtrend-${a.trend.direction}`}>
          {TREND_MARK[a.trend.direction]} {a.trend.label}
          {a.trend.direction !== "flat"
            ? ` ${a.trend.delta > 0 ? "+" : "−"}${Math.abs(Math.round(a.trend.delta))}`
            : ""}
        </span>
      ) : (
        <span className="ms-gtrend ms-gtrend-none">not enough history to trend</span>
      )}
      <small className="ms-gbasis">{a.basis}</small>
    </div>
  );
}

export default function Mindset({ closed = [] }) {
  const cov = useMemo(() => coverage(closed), [closed]);
  const edge = useMemo(() => emotionEdge(closed), [closed]);
  const spread = useMemo(() => emotionSpread(closed), [closed]);
  const mismatch = useMemo(() => exitMismatch(closed), [closed]);
  const profile = useMemo(() => mindsetProfile(closed), [closed]);
  const errs = useMemo(() => errorsByEntryState(closed), [closed]);

  if (!cov.closed) {
    return (
      <div className="sec card empty">
        <div className="eyebrow">Mindset</div>
        <p>This reads how you felt taking and closing each trade, and sets it against
          what the trade returned. It needs closed trades to read.</p>
      </div>
    );
  }

  /* Nothing recorded yet is the normal state on the day this ships — every
     existing trade predates the fields. Say what to do, not that it is empty. */
  if (!cov.entry && !cov.exit) {
    return (
      <div className="sec card empty">
        <div className="eyebrow">Mindset</div>
        <p>
          None of your {cov.closed} closed trades has a recorded feeling yet — the
          fields are new, so nothing before today could have one.
        </p>
        <p>
          Log the next trade and you will be asked how you feel taking it, and again
          when you close it. After about {THIN_EMOTION} of each, this page can start
          telling you whether the state you were in changed what you earned. Nothing
          is inferred, so old trades stay blank rather than being guessed at.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* ---- the habits, first ------------------------------------------
          Moved above the finding: these four are the standing state of how
          the trading is being conducted, and they are what somebody opening
          this tab wants to see before reading an argument about one slice of
          it. The finding below is the diagnosis; this is the vital signs. */}
      {profile ? (
        <div className="sec">
          <div className="sechead">
            <div className="eyebrow">Habits, counted</div>
            <span className="ms-src">
              {profile.overall != null
                ? `${profile.overall} overall, across ${profile.measuredAxes} of 4 measures`
                : "nothing measurable yet"}
            </span>
          </div>
          <div className="ms-gauges">
            {profile.axes.map((a) => <Gauge key={a.key} a={a} />)}
          </div>
          <p className="ms-note" style={{ marginTop: 14 }}>
            Each is a percentage of trades meeting a stated test, not a weighting
            chosen to make the shape look interesting. Trends compare the recent half
            of your record against the earlier half, and stay silent until both halves
            have enough trades to be worth comparing. There is no fifth measure for
            pattern recognition because there is no honest way to compute one from a
            trade log, and a made-up score would discredit the four beside it.
          </p>
        </div>
      ) : null}

      {/* ---- the finding ------------------------------------------------ */}
      <div className="sec">
        <div className="sechead">
          <div className="eyebrow">What your state was worth</div>
          <span className="ms-src">
            {cov.entry} of {cov.measurable} trades carry an entry state
          </span>
        </div>

        {spread ? (
          <p className="ms-headline">
            Your <b style={{ color: "var(--long)" }}>{spread.best.emotion.toLowerCase()}</b> trades
            average <b>{rfmt(spread.best.expectancy, 2)}</b>. Your{" "}
            <b style={{ color: "var(--short)" }}>{spread.worst.emotion.toLowerCase()}</b> trades
            average <b>{rfmt(spread.worst.expectancy, 2)}</b> —
            a gap of <b>{rfmt(spread.gapR, 2)}</b> a trade.
            {spread.costOfWorst != null ? (
              /* Magnitude, not a signed R. "cost −6.3R" is a double negative
                 that reads as a gain on second glance. */
              <> Those {spread.worst.n} trades cost <b>{spread.costOfWorst.toFixed(1)}R</b> between them.</>
            ) : null}
          </p>
        ) : (
          <p className="ms-note">
            Not enough yet to compare states — a state needs {THIN_EMOTION} trades before
            its average means anything. The table below shows what has been recorded.
          </p>
        )}

        <div className="ms-tablewrap">
          <table className="ms-table">
            <thead>
              <tr>
                <th>Entry state</th><th className="num">Trades</th>
                <th className="num">Expectancy</th><th className="num">Win rate</th>
                <th className="num">Total R</th><th></th>
              </tr>
            </thead>
            <tbody>
              {edge.map((r) => (
                <tr key={r.emotion} data-thin={r.isThin ? 1 : 0}>
                  <td>
                    <span className="ms-dot" style={{ background: stateColor(r.emotion) }} />
                    <b>{r.emotion}</b>
                  </td>
                  <td className="num mono">{r.n}</td>
                  <td className={`num mono ${r.expectancy >= 0 ? "pos" : "neg"}`}>
                    {rfmt(r.expectancy, 2)}
                  </td>
                  <td className="num mono">{pct(r.winRate, 0)}</td>
                  <td className={`num mono ${r.totalR >= 0 ? "pos" : "neg"}`}>
                    {rfmt(r.totalR, 1)}
                  </td>
                  <td className="ms-thin">{r.isThin ? `only ${r.n} — not yet reliable` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- the mechanism ---------------------------------------------- */}
      {errs.length > 0 ? (
        <div className="sec">
          <div className="eyebrow" style={{ marginBottom: 8 }}>Where the errors come from</div>
          <p className="ms-note">
            Execution errors grouped by the state you were in. This is the mechanism
            behind the table above — the state itself does not lose money, the thing
            it makes you do does.
          </p>
          <div className="ms-errs">
            {errs.slice(0, 8).map((e) => (
              <div key={`${e.emotion}-${e.mistake}`} className="ms-err">
                <span className="ms-dot" style={{ background: stateColor(e.emotion) }} />
                <b>{e.emotion}</b>
                <span className="ms-arrow">→</span>
                <span className="ms-errname">{e.mistake}</span>
                <em className="mono">×{e.count}</em>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ---- where the feeling disagreed with the result ---------------
          This replaced a Sankey of entry state → outcome → exit state. The
          diagram looked substantial and said nothing: the right-hand half was
          almost entirely determined by the outcome — losses flow to frustrated,
          regret and angry, which is not news — so it occupied the largest area
          on the page carrying close to zero information, with ribbons crossing
          too often to trace a single path anyway.

          The disagreement is the whole signal. Relief on a winner, regret on a
          winner, calm on a loss: each says something the trade's own numbers
          cannot. */}
      {mismatch.length > 0 ? (
        <div className="sec">
          <div className="sechead">
            <div className="eyebrow">Where the feeling didn&rsquo;t match the result</div>
            <span className="ms-src">{cov.exit} of {cov.measurable} trades carry an exit state</span>
          </div>
          <div className="ms-finds">
            {mismatch.map((f) => (
              <div key={f.key} className={`ms-find ms-find-${f.tone}`}>
                <div className="ms-find-head">
                  <b>{f.title}</b>
                  <em className="mono">{f.n}</em>
                </div>
                <p>{f.detail}</p>
                {/* Without this a finding is only the tag read back to whoever
                    typed it. With it, it is a claim with a number behind it. */}
                {f.evidence ? <p className="ms-find-ev">{f.evidence}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : cov.exit > 0 ? (
        <div className="sec">
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Where the feeling didn&rsquo;t match the result
          </div>
          <p className="ms-note">
            Nothing to report — your exit feelings have so far tracked your results,
            which is the ordinary case. This looks for the exceptions: regret on a
            winner, relief on a winner, calm on a loss. Each needs {MIN_MISMATCH} trades
            before it is worth saying.
          </p>
        </div>
      ) : null}

      {cov.assumedStops > 0 ? (
        <p className="ms-note">
          {cov.assumedStops} closed {cov.assumedStops === 1 ? "trade is" : "trades are"} excluded
          throughout: the stop was assumed at import rather than recorded, so the R would be
          arithmetic against a number nobody chose. Correct{" "}
          {cov.assumedStops === 1 ? "it" : "them"} in the <Link href="/stops">stops queue</Link>.
        </p>
      ) : null}

      <style jsx global>{`
        .ms-src { font-size: 11.5px; color: var(--ink3); }
        .ms-headline {
          font-size: 15px; line-height: 1.7; color: var(--ink2);
          margin: 0 0 16px; max-width: var(--note-w);
        }
        .ms-headline b { color: var(--ink); font-weight: 600; }
        .ms-note {
          font-size: 12.5px; line-height: 1.7; color: var(--ink3);
          margin: 0 0 12px; max-width: var(--note-w);
        }

        .ms-tablewrap { overflow-x: auto; max-width: 100%; }
        .ms-table { border-collapse: collapse; width: 100%; min-width: 560px; font-size: 12.5px; }
        .ms-table th {
          font-family: 'Archivo', sans-serif; font-size: 10px; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--ink3); font-weight: 600;
          text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--rule);
        }
        .ms-table td {
          padding: 9px 10px; border-bottom: 1px solid var(--rule); color: var(--ink2);
        }
        .ms-table .num { text-align: right; }
        .ms-table tr[data-thin="1"] td { color: var(--ink3); }
        .ms-dot {
          width: 8px; height: 8px; border-radius: 50%;
          display: inline-block; margin-right: 8px;
        }
        .ms-thin { font-size: 11px; color: var(--ink3); white-space: nowrap; }

        .ms-errs {
          display: grid; gap: 8px 22px;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        }
        .ms-err {
          display: flex; align-items: center; gap: 8px; font-size: 12.5px;
          color: var(--ink2); border-left: 1px solid var(--rule); padding-left: 11px;
        }
        .ms-err b { color: var(--ink); }
        .ms-arrow { color: var(--ink3); }
        .ms-errname { flex: 1 1 auto; min-width: 0; }
        .ms-err em { font-style: normal; color: var(--ink3); }

        /* Findings, not a chart. Left-ruled in the tone of the finding so the
           good one is distinguishable at a glance without being a green box
           shouting congratulations. */
        .ms-finds {
          display: grid; gap: 12px 22px;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        }
        .ms-find {
          border-left: 2px solid var(--rule); padding: 2px 0 2px 13px;
        }
        .ms-find-warn { border-left-color: #C9A227; }
        .ms-find-good { border-left-color: var(--long); }
        .ms-find-head {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 10px; margin-bottom: 4px;
        }
        .ms-find-head b { font-size: 13px; color: var(--ink); }
        .ms-find-head em {
          font-style: normal; font-size: 12px; color: var(--ink3);
        }
        .ms-find p {
          font-size: 12.5px; line-height: 1.7; color: var(--ink2); margin: 0;
        }
        .ms-find-ev {
          margin-top: 5px !important; color: var(--ink3) !important;
          font-size: 12px !important;
        }

        .ms-gauges {
          display: grid; gap: 18px;
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        }
        .ms-gauge {
          border: 1px solid var(--rule); border-radius: 3px; background: var(--card);
          padding: 16px 14px 14px; text-align: center;
          display: flex; flex-direction: column; align-items: center; gap: 2px;
        }
        .ms-dial { width: 108px; height: 108px; display: block; margin-bottom: 8px; }
        /* Rotated so the sweep starts at twelve o'clock. Applied to the circles
           rather than the svg so the numbers inside stay upright. */
        .ms-dial circle {
          fill: none; transform: rotate(-90deg); transform-origin: 42px 42px;
        }
        .ms-track { stroke: var(--rule); stroke-width: 7; }
        .ms-arc { stroke-width: 7; stroke-linecap: round; }
        .ms-dialnum {
          font-family: 'Archivo', sans-serif; font-stretch: 125%; font-weight: 600;
          font-size: 21px;
        }
        .ms-dialmax {
          font-family: 'Archivo', sans-serif; font-size: 8px; fill: var(--ink3);
        }
        .ms-gname { font-size: 13px; color: var(--ink); }
        .ms-gband {
          font-family: 'Archivo', sans-serif; font-size: 9.5px;
          letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink3);
        }
        .ms-gtrend { font-size: 11px; margin-top: 4px; }
        .ms-gtrend-up { color: var(--long); }
        .ms-gtrend-down { color: var(--short); }
        .ms-gtrend-flat { color: var(--ink3); }
        .ms-gtrend-none { color: var(--ink3); opacity: 0.75; font-style: italic; }
        .ms-gbasis {
          font-size: 10.5px; color: var(--ink3); line-height: 1.5; margin-top: 6px;
        }
      `}</style>
    </>
  );
}
