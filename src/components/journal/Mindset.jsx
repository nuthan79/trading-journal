"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  emotionEdge, emotionSpread, emotionFlow, mindsetProfile, coverage,
  errorsByEntryState, THIN_EMOTION,
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

function Axis({ a }) {
  const has = Number.isFinite(a.score);
  return (
    <div className="ms-axis">
      <div className="ms-axis-top">
        <b>{a.label}</b>
        <span className="mono">{has ? Math.round(a.score) : "—"}</span>
      </div>
      <div className="ms-bar"><i style={{ width: `${has ? a.score : 0}%` }} /></div>
      <small>{a.basis}</small>
    </div>
  );
}

/**
 * Entry state → outcome → exit state.
 *
 * Hand-drawn, like the growth curve on the Edge tab and for the same reason:
 * this is three columns of rectangles and some ribbons, and a charting library
 * would be a bigger download than the screen it draws.
 */
function Flow({ flow }) {
  const W = 760, PAD = 12, COL = 128, MID_W = 116;
  const rows = Math.max(flow.entryNodes.length, flow.exitNodes.length, 2);
  const H = Math.max(230, rows * 34 + PAD * 2);

  const totalEntry = flow.entryNodes.reduce((a, n) => a + n.count, 0) || 1;
  const totalExit = flow.exitNodes.reduce((a, n) => a + n.count, 0) || 1;
  const usable = H - PAD * 2;

  /* Each node gets height in proportion to its trades, with a floor so a
     single-trade state is still clickable-thin rather than invisible. */
  const stack = (nodes, total) => {
    let y = PAD;
    return nodes.map((n) => {
      const h = Math.max(9, (n.count / total) * (usable - nodes.length * 5));
      const box = { ...n, y, h };
      y += h + 5;
      return box;
    });
  };
  const left = stack(flow.entryNodes, totalEntry);
  const right = stack(flow.exitNodes, totalExit);

  const wins = flow.outcome.wins, losses = flow.outcome.losses;
  const midTotal = wins + losses || 1;
  const midH = usable - 10;
  const winH = Math.max(16, (wins / midTotal) * midH);
  const lossH = Math.max(16, (losses / midTotal) * midH);
  const mid = {
    win: { y: PAD, h: winH },
    loss: { y: PAD + winH + 10, h: lossH },
  };

  const lx = PAD + COL, mx = W / 2 - MID_W / 2, mx2 = W / 2 + MID_W / 2, rx = W - PAD - COL;

  /* Ribbons leave each node stacked in order, so a state feeding both outcomes
     shows two bands rather than one overlapping smear. */
  const cursor = new Map();
  const take = (key, amount) => {
    const at = cursor.get(key) || 0;
    cursor.set(key, at + amount);
    return at;
  };

  const ribbon = (x1, y1, x2, y2, thick, cls, key) => (
    <path key={key} className={cls} d={
      `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}
       L ${x2} ${y2 + thick} C ${(x1 + x2) / 2} ${y2 + thick}, ${(x1 + x2) / 2} ${y1 + thick}, ${x1} ${y1 + thick} Z`} />
  );

  return (
    <div className="ms-flowwrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="ms-flow" role="img"
           aria-label="Entry state to outcome to exit state">
        {left.map((n) => {
          const outs = flow.entryLinks.filter((l) => l.from === n.key);
          return outs.map((l) => {
            const t = (l.count / n.count) * n.h;
            const y1 = n.y + take(`L${n.key}`, t);
            const y2 = mid[l.to].y + take(`M${l.to}in`, (l.count / (l.to === "win" ? wins : losses)) * mid[l.to].h);
            return ribbon(lx, y1, mx, y2,
              (l.count / (l.to === "win" ? wins : losses)) * mid[l.to].h,
              `ms-rib ms-rib-${l.to}`, `${n.key}-${l.to}`);
          });
        })}
        {right.map((n) => {
          const ins = flow.exitLinks.filter((l) => l.to === n.key);
          return ins.map((l) => {
            const src = l.from === "win" ? wins : losses;
            const t = (l.count / src) * mid[l.from].h;
            const y1 = mid[l.from].y + take(`M${l.from}out`, t);
            const y2 = n.y + take(`R${n.key}`, (l.count / n.count) * n.h);
            return ribbon(mx2, y1, rx, y2, (l.count / n.count) * n.h,
              `ms-rib ms-rib-${l.from}`, `${l.from}-${n.key}`);
          });
        })}

        {left.map((n) => (
          <g key={n.key}>
            <rect x={PAD} y={n.y} width={COL} height={n.h} rx={2}
                  className="ms-node" style={{ fill: stateColor(n.key) }} />
            <text x={PAD + 7} y={n.y + n.h / 2 + 3.5} className="ms-nodetext">
              {n.key} <tspan className="ms-nodecount">{n.count}</tspan>
            </text>
          </g>
        ))}
        <g>
          <rect x={mx} y={mid.win.y} width={MID_W} height={mid.win.h} rx={2} className="ms-mid ms-mid-win" />
          <text x={W / 2} y={mid.win.y + mid.win.h / 2 + 3.5} textAnchor="middle" className="ms-midtext">
            {wins} won
          </text>
          <rect x={mx} y={mid.loss.y} width={MID_W} height={mid.loss.h} rx={2} className="ms-mid ms-mid-loss" />
          <text x={W / 2} y={mid.loss.y + mid.loss.h / 2 + 3.5} textAnchor="middle" className="ms-midtext">
            {losses} lost
          </text>
        </g>
        {right.map((n) => (
          <g key={n.key}>
            <rect x={rx} y={n.y} width={COL} height={n.h} rx={2} className="ms-node ms-node-exit" />
            <text x={rx + 7} y={n.y + n.h / 2 + 3.5} className="ms-nodetext">
              {n.key} <tspan className="ms-nodecount">{n.count}</tspan>
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function Mindset({ closed = [] }) {
  const cov = useMemo(() => coverage(closed), [closed]);
  const edge = useMemo(() => emotionEdge(closed), [closed]);
  const spread = useMemo(() => emotionSpread(closed), [closed]);
  const flow = useMemo(() => emotionFlow(closed), [closed]);
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

      {/* ---- the journey ------------------------------------------------ */}
      {cov.ready ? (
        <div className="sec">
          <div className="sechead">
            <div className="eyebrow">Entry state → outcome → exit state</div>
            <span className="ms-src">{cov.both} trades carry both ends</span>
          </div>
          <Flow flow={flow} />
        </div>
      ) : (
        <div className="sec">
          <div className="eyebrow" style={{ marginBottom: 8 }}>Entry state → outcome → exit state</div>
          <p className="ms-note">
            {cov.both === 0
              ? "No trade yet carries both an entry and an exit feeling."
              : `Only ${cov.both} ${cov.both === 1 ? "trade carries" : "trades carry"} both ends.`}{" "}
            The flow needs about {THIN_EMOTION} to be worth drawing — below that it is a
            diagram, not a finding.
          </p>
        </div>
      )}

      {/* ---- the profile ------------------------------------------------ */}
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
          <div className="ms-axes">
            {profile.axes.map((a) => <Axis key={a.key} a={a} />)}
          </div>
          <p className="ms-note" style={{ marginTop: 12 }}>
            Each is a percentage of trades meeting a stated test, not a weighting
            chosen to make the shape look interesting. There is no fifth axis for
            pattern recognition because there is no honest way to compute one from a
            trade log, and a made-up score would discredit the four beside it.
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

        .ms-flowwrap {
          border: 1px solid var(--rule); border-radius: 3px; background: var(--card);
          padding: 8px; overflow-x: auto;
        }
        .ms-flow { width: 100%; min-width: 620px; height: auto; display: block; }
        .ms-node { opacity: 0.9; }
        .ms-node-exit { fill: var(--ink3); }
        .ms-nodetext {
          font-family: 'Archivo', sans-serif; font-size: 9.5px; fill: #fff;
          font-weight: 600;
        }
        .ms-nodecount { opacity: 0.75; }
        .ms-mid-win { fill: var(--long); }
        .ms-mid-loss { fill: var(--short); }
        .ms-midtext {
          font-family: 'Archivo', sans-serif; font-size: 10.5px; fill: #fff; font-weight: 600;
        }
        /* Ribbons carry the OUTCOME's colour, not the state's: the question the
           diagram answers is which feelings led to which results. */
        .ms-rib { opacity: 0.16; }
        .ms-rib-win { fill: var(--long); }
        .ms-rib-loss { fill: var(--short); }

        .ms-axes {
          display: grid; gap: 16px 30px;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        }
        .ms-axis-top {
          display: flex; justify-content: space-between; align-items: baseline;
          font-size: 13px; margin-bottom: 6px;
        }
        .ms-axis-top span { color: var(--ink); font-size: 15px; }
        .ms-bar {
          height: 5px; background: var(--rule); border-radius: 3px; overflow: hidden;
        }
        .ms-bar i { display: block; height: 100%; background: var(--ink); }
        .ms-axis small {
          display: block; font-size: 11px; color: var(--ink3); margin-top: 6px;
        }
      `}</style>
    </>
  );
}
