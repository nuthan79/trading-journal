"use client";

import { useMemo, useState } from "react";
import {
  edge, projection, scenarios, arithmeticFinal, matrix, MATRIX_WIN_RATES,
  OPTIMISTIC_EXPECTANCY,
} from "@/lib/expectancy";
import { rupee, rfmt, pct, signedPct } from "@/lib/format";

/**
 * The edge calculator, given away.
 *
 * WHY THIS ONE AND NOT A BROKERAGE CALCULATOR. Every broker ships a charges
 * calculator on their own domain, so ours would be the ninth result nobody
 * clicks. Nobody ships this: the question "is my system actually profitable"
 * is the one traders most need answered and least often can, and answering it
 * requires the R framing this whole app is built on. A visitor who works out
 * here that 60% winners at 0.5R is a losing system has just been taught why a
 * journal measured in R exists — which no landing page copy achieves.
 *
 * IT IS ALSO THE HONEST VERSION. Two things comparable calculators get wrong:
 * the projection compounds geometrically rather than arithmetically (see
 * `expectancy.js`), and the break-even win rate sits next to the win rate
 * rather than buried, because that pair is the entire verdict.
 *
 * PREFILL IS THE PRODUCT. `prefill` is unused by the public page and is the
 * reason this takes props at all: the in-app version passes numbers derived
 * from real closed trades, so the same screen stops being a what-if and starts
 * being a measurement. That is the upgrade being sold, and it is worth building
 * as one component rather than two that quietly disagree about what an average
 * win is.
 */

const DEFAULTS = {
  winRate: 45, avgWin: 2, avgLoss: 1,
  tradesPerMonth: 8, riskPct: 1, capital: 500000,
};

const YEARS = 10;

/** Plain number, no unit — `rfmt` already appends its own sign and "R", so it
 *  is only correct where exactly "+2.0R" is wanted and wrong everywhere else. */
const n1 = (v, dp = 1) => (Number.isFinite(v) ? v.toFixed(dp) : "—");

/** A slider with its number beside it. Both matter: the slider is for exploring
 *  and the readout is for checking, and a slider without a value is a toy. */
function Slide({ label, hint, value, onChange, min, max, step, fmt, from }) {
  return (
    <label className="ec-f">
      <span className="ec-lab">
        {label}
        {/* The badge that makes the in-app version obviously different from
            this one — same component, real numbers. */}
        {from ? <i className="ec-from">{from}</i> : null}
        <b>{fmt ? fmt(value) : value}</b>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function Stat({ label, value, note, tone }) {
  return (
    <div className="ec-stat">
      <span>{label}</span>
      <b className={tone || ""}>{value}</b>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

/**
 * The growth curve.
 *
 * Hand-drawn SVG rather than a charting library, because this page is served to
 * logged-out visitors and a chart library would be a bigger download than the
 * rest of the page put together. Three polylines and some axis labels do not
 * need 90KB of abstraction.
 */
function Curve({ series, years }) {
  const W = 720, H = 250, PAD = { l: 86, r: 14, t: 12, b: 26 };

  /*
    THE AXIS FOLLOWS THE BASE CASE, NOT THE HIGHEST LINE.

    Scaling to the tallest series is the obvious choice and it destroys the
    chart: five points of win rate is a multiplicative difference over ten
    years, so the optimistic line can finish thousands of times above the
    others and flatten both of them onto the zero line — a chart showing one
    vertical wall and nothing else. The base case is what the reader came for,
    so it sets the scale and anything taller is clamped to the top edge and
    called out underneath, rather than being allowed to squash the answer.
  */
  const baseFinal = (series.find((s) => s.key === "base") || series[0]).final;
  const trueMax = Math.max(...series.flatMap((s) => s.points.map((p) => p.value)), 1);
  const max = Math.min(trueMax, Math.max(baseFinal * 2.5, 1));
  const clipped = trueMax > max * 1.001;

  const x = (yr) => PAD.l + (yr / years) * (W - PAD.l - PAD.r);
  const y = (v) => H - PAD.b - (Math.min(v, max) / max) * (H - PAD.t - PAD.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  return (
    <div className="ec-chartwrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="ec-chart" role="img"
           aria-label={`Projected account value over ${years} years`}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="ec-gl" />
            {/* One decimal, not zero. The ticks are evenly spaced fractions of
                the maximum, so rounding them to whole crores prints 2.7 as
                "₹3 Cr" directly below "₹4 Cr" and the gridlines read as
                unevenly spaced when they are not. */}
            <text x={PAD.l - 8} y={y(t) + 3.5} className="ec-axis" textAnchor="end">
              {t === 0 ? "₹0" : rupee(t, { decimals: 1 })}
            </text>
          </g>
        ))}
        {Array.from({ length: years + 1 }, (_, i) => i).map((yr) => (
          <text key={yr} x={x(yr)} y={H - 8} className="ec-axis" textAnchor="middle">
            {yr === 0 ? "now" : `Y${yr}`}
          </text>
        ))}
        {series.map((s) => (
          <polyline
            key={s.key} className={`ec-line ec-line-${s.key}`} fill="none"
            points={s.points.map((p) => `${x(p.year)},${y(p.value)}`).join(" ")}
          />
        ))}
      </svg>
      {clipped ? (
        <p className="ec-clip">
          The optimistic line runs off the top. Scaled to fit it, the other two
          would sit flat on zero.
        </p>
      ) : null}
    </div>
  );
}

export default function ExpectancyCalculator({ prefill = null, sampleSize = 0 }) {
  const base = useMemo(() => ({ ...DEFAULTS, ...(prefill || {}) }), [prefill]);
  const [v, setV] = useState(base);
  const set = (k) => (x) => setV((p) => ({ ...p, [k]: x }));
  const dirty = JSON.stringify(v) !== JSON.stringify(base);

  const e = useMemo(() => edge(v), [v]);
  const proj = useMemo(() => projection(v, YEARS), [v]);
  const scen = useMemo(() => scenarios(v, YEARS), [v]);
  const grid = useMemo(() => matrix(v), [v]);
  const arith = useMemo(() => arithmeticFinal(v, YEARS), [v]);

  /** Shown against inputs that came from real trades. Absent on the public
   *  page, which is the visible difference between guessing and knowing. */
  const from = prefill ? "your trades" : null;
  const rr = e.avgWin / e.avgLoss;

  return (
    <div className="ec">
      <div className="ec-cols">
        {/* ---- inputs ------------------------------------------------- */}
        <div className="ec-panel">
          <div className="ec-panelhead">
            <h2>Your system</h2>
            <p>
              {prefill
                ? `Filled in from ${sampleSize} closed trades. Move anything to ask what if.`
                : "Six numbers. Move any of them and everything below recalculates."}
            </p>
          </div>

          <Slide label="Win rate" value={v.winRate} onChange={set("winRate")}
                 min={0} max={100} step={1} fmt={(x) => `${x}%`} from={from}
                 hint="Percentage of trades that end in profit." />

          <Slide label="Average win" value={v.avgWin} onChange={set("avgWin")}
                 min={0.1} max={10} step={0.1} fmt={(x) => `${n1(x)}R`} from={from}
                 hint="A 2R win made twice what the trade risked." />

          <Slide label="Average loss" value={v.avgLoss} onChange={set("avgLoss")}
                 min={0.1} max={5} step={0.1} fmt={(x) => `−${n1(x)}R`} from={from}
                 hint="1R means losses stop where planned. Above 1R means they don't." />

          <Slide label="Trades per month" value={v.tradesPerMonth}
                 onChange={set("tradesPerMonth")} min={1} max={40} step={1} from={from} />

          {/* Ranges to 20% deliberately, though nobody sensible trades there.
              At 10% the worst reachable case still leaves half the account
              standing, which quietly makes ruin look impossible; at 20% a 5R
              average loss ends the account in one trade and the page says so.
              Being able to slide into the wall is the lesson. */}
          <Slide label="Risk per trade" value={v.riskPct} onChange={set("riskPct")}
                 min={0.1} max={20} step={0.1} fmt={(x) => `${n1(x)}%`}
                 hint="Percentage of the account lost if the stop is hit. Most swing traders sit between 0.5% and 2%." />

          <label className="ec-f">
            <span className="ec-lab">Starting capital<b>{rupee(v.capital)}</b></span>
            <input
              className="ec-cap" inputMode="numeric" value={v.capital}
              onChange={(ev) =>
                set("capital")(parseFloat(ev.target.value.replace(/[^\d.]/g, "")) || 0)}
            />
          </label>

          {dirty ? (
            <button type="button" className="ec-reset" onClick={() => setV(base)}>
              Reset
            </button>
          ) : null}
        </div>

        {/* ---- the verdict -------------------------------------------- */}
        <div className="ec-results">
          <div className={`ec-hero ${e.positive ? "ok" : "bad"}`}>
            <span>Expectancy per trade</span>
            <b>{rfmt(e.expectancyR, 2)}</b>
            <small>
              {e.positive
                ? `Every trade is worth ${n1(e.expectancyPct, 2)}% of the account, on average.`
                : `Every trade costs ${n1(Math.abs(e.expectancyPct), 2)}% of the account, on average.`}
            </small>
          </div>

          {/* The most useful sentence on the page. A win rate means nothing
              until it is set against the one this reward:risk requires, and
              that comparison is the thing people get wrong. */}
          <p className={`ec-verdict ${e.positive ? "ok" : "bad"}`}>
            {e.positive ? (
              <>
                At {n1(rr)}:1 reward to risk you need to win{" "}
                <b>{pct(e.breakevenWinRate, 1)}</b> of the time just to break even.
                You win <b>{pct(e.winRate, 0)}</b> — {n1(e.edgeOverBreakeven)} points
                of real edge.
              </>
            ) : (
              <>
                At {n1(rr)}:1 reward to risk you need to win{" "}
                <b>{pct(e.breakevenWinRate, 1)}</b> of the time to break even, and you
                win <b>{pct(e.winRate, 0)}</b>. This system loses money — and no amount
                of position sizing fixes that.
              </>
            )}
          </p>

          <div className="ec-stats">
            <Stat label="Break-even win rate" value={pct(e.breakevenWinRate, 1)}
                  note={`You are ${n1(Math.abs(e.edgeOverBreakeven))} points ${e.edgeOverBreakeven >= 0 ? "above" : "below"}`}
                  tone={e.edgeOverBreakeven >= 0 ? "ok" : "bad"} />
            <Stat label="Profit factor"
                  value={e.profitFactor == null ? "—" : n1(e.profitFactor, 2)}
                  note={e.profitFactor == null ? "No losing trades"
                        : `₹${n1(e.profitFactor, 2)} earned per ₹1 lost`}
                  tone={e.profitFactor != null && e.profitFactor >= 1 ? "ok" : "bad"} />
            <Stat label="Per month" value={rfmt(e.monthlyR, 1)}
                  note={`${signedPct(e.monthlyR * e.riskPct, 1)} of the account`}
                  tone={e.monthlyR >= 0 ? "ok" : "bad"} />
            <Stat label="Per year" value={rfmt(e.annualR, 0)}
                  note={`${Math.round(e.tradesPerMonth * 12)} trades`}
                  tone={e.annualR >= 0 ? "ok" : "bad"} />
          </div>
        </div>
      </div>

      {/* ---- the grid ------------------------------------------------- */}
      <h2 className="ec-h2">Which systems make money</h2>
      <p className="ec-sub">
        Expectancy in R for every win rate and reward:risk pair, with losses held at
        1R. Green makes money, red does not, and the boundary between them is the one
        line in trading that cannot be argued with. Your combination is outlined.
      </p>
      <div className="ec-gridwrap">
        <table className="ec-matrix">
          <thead>
            <tr>
              <th className="ec-corner">R:R</th>
              {MATRIX_WIN_RATES.map((w) => <th key={w}>{w}%</th>)}
            </tr>
          </thead>
          <tbody>
            {grid.map((row) => (
              <tr key={row.rr}>
                <th>{n1(row.rr)}:1</th>
                {row.cells.map((c) => (
                  <td key={c.winRate}
                      className={`${c.positive ? "pos" : "neg"}${c.isHere ? " here" : ""}`}
                      style={{ "--i": c.intensity }}
                      title={`${c.winRate}% win rate at ${n1(c.rr)}:1 — ${rfmt(c.expectancy, 2)} per trade`}>
                    {c.expectancy >= 0 ? "+" : ""}{n1(c.expectancy, 2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- the projection ------------------------------------------- */}
      <h2 className="ec-h2">What that compounds to</h2>
      <p className="ec-sub">
        {rupee(v.capital)} at {n1(v.riskPct)}% risk per trade,{" "}
        {Math.round(proj.tradesPerYear)} trades a year, for {YEARS} years — assuming
        the edge above holds the entire time.
      </p>

      {/* Cautions without withholding. An expectancy this high is rare rather
          than impossible, so every figure still shows — but it is almost always
          a remembered win rate rather than an exceptional edge, and saying so
          here is more useful than letting the projection imply otherwise. */}
      {!proj.ruin && !proj.implausible && e.expectancyR > OPTIMISTIC_EXPECTANCY ? (
        <p className="ec-soft">
          <b>{rfmt(e.expectancyR, 2)} a trade is exceptional.</b> Systems that work
          well usually land between 0.2R and 0.5R, so treat everything below as the
          best case rather than the expected one. If these numbers came from memory
          instead of a trade log, the average loss is the one most likely to be
          flattering — the trades where a stop got moved are exactly the ones that do
          not come to mind.
        </p>
      ) : null}

      {proj.ruin ? (
        <p className="ec-ruin">
          At {n1(v.riskPct)}% risk, an average loss of {n1(v.avgLoss)}R takes the whole
          account in a single trade. There is nothing left to compound.
        </p>
      ) : proj.implausible ? (
        /*
          Refusing to print the number is the honest answer, and the more
          useful one. These inputs compound to figures with more digits than
          there is money, and a tool that reports that with a straight face
          looks broken — which discredits every correct number beside it.
          Naming the specific input that is doing the damage turns a dead end
          into the lesson the page exists to teach.
        */
        <div className="ec-ruin ec-impl">
          <p>
            <b>Past here the number stops meaning anything.</b> These inputs compound
            at {Math.round(proj.cagr).toLocaleString("en-IN")}% a year, which turns{" "}
            {rupee(v.capital)} into a figure no account has reached. It is
            arithmetically correct and it would tell you nothing, so it is not shown.
          </p>
          <p>
            The usual culprit is the average win. Yours is <b>{n1(v.avgWin)}R</b> —
            every winner making {n1(v.avgWin)} times what the trade risked, held up
            across {Math.round(proj.totalTrades)} trades. Systems that work well
            average nearer 1.5R to 3R, because the outsized winners are rare and
            everything else gets cut small.
          </p>
          <p>
            A {n1(v.winRate, 0)}% win rate alongside it compounds the problem. Above
            roughly 55%, the usual explanation is that losers are being held rather
            than stopped — which surfaces later as an average loss well beyond 1R,
            not as a better win rate. Put in what your last hundred trades actually
            did and the projection starts being worth reading.
          </p>
        </div>
      ) : (
        <>
          <div className="ec-top">
            <Stat label={`After ${YEARS} years`} value={rupee(proj.final)}
                  note={`from ${rupee(v.capital)}`}
                  tone={proj.final >= v.capital ? "ok" : "bad"} />
            <Stat label="CAGR" value={pct(proj.cagr, 1)} note="compound annual growth"
                  tone={proj.cagr >= 0 ? "ok" : "bad"} />
            <Stat label="Total return" value={signedPct(proj.totalReturnPct, 0)}
                  note={`over ${proj.totalTrades} trades`}
                  tone={proj.totalReturnPct >= 0 ? "ok" : "bad"} />
            <Stat label="Total R earned" value={rfmt(e.annualR * YEARS, 0)}
                  note="before compounding" tone={e.annualR >= 0 ? "ok" : "bad"} />
          </div>

          <Curve series={scen} years={YEARS} />

          <div className="ec-scen">
            {scen.map((s) => (
              <div key={s.key} className={`ec-sc ${s.key === "base" ? "on" : ""}`}>
                <span className={`ec-dot ec-dot-${s.key}`} />
                <b>{s.label}</b>
                <i>{s.note}</i>
                <em>{rupee(s.final)}</em>
                <small>{pct(s.cagr, 1)} a year</small>
              </div>
            ))}
          </div>

          <div className="ec-miles">
            {[1, 3, 5, YEARS].map((yr) => {
              const p = proj.points[yr];
              return (
                <div key={yr}>
                  <span>Year {yr}</span>
                  <b>{rupee(p.value)}</b>
                  <small>{p.trades} trades</small>
                </div>
              );
            })}
          </div>

          {/* The correction nobody else makes, stated as a number rather than a
              caveat — it is the reason to trust the rest of the page. */}
          <p className="ec-drag">
            Compounded arithmetically — expectancy × trades, the way most projections
            do it — the same inputs would show <b>{rupee(arith)}</b>. The{" "}
            <b>{rupee(Math.abs(arith - proj.final))}</b> difference is volatility drag:
            a +1R and a −1R do not cancel, because the loss is taken on a smaller
            account than the win that preceded it. The figure above is the one an
            account actually follows.
          </p>
        </>
      )}

      {/* Not boilerplate. A ten-year growth number is exactly the sort of thing
          that gets screenshotted out of context, and every line here is a real
          reason the number will not happen. */}
      <div className="ec-caveat">
        <h3>What this is not</h3>
        <ul>
          <li>
            <b>Not a forecast.</b> It is arithmetic on numbers you typed. Move the win
            rate five points and the ten-year figure changes several-fold — which is
            the honest measure of how much confidence it deserves.
          </li>
          <li>
            <b>It assumes the edge never changes.</b> Real edges decay, markets rotate
            between trending and choppy, and a strategy that worked for three years
            can stop working in a month.
          </li>
          <li>
            <b>It assumes you never deviate.</b> The maths holds only if every signal
            is taken at the same risk — including the ones after four losses in a row,
            which is where systems actually break.
          </li>
          <li>
            <b>Charges and taxes are excluded.</b> Brokerage, STT, stamp duty and DP
            charges come off every trade, and capital gains tax comes off the result.
          </li>
          <li>
            <b>Averages hide drawdowns.</b> A positive-expectancy system still has
            losing streaks. This curve is a smooth line; the account it describes is
            not.
          </li>
        </ul>
      </div>

      {/*
        GLOBAL, PREFIXED — deliberately, not laziness.

        `Slide`, `Stat` and `Curve` are separate component functions, and
        styled-jsx's default scoping only reaches markup rendered by the
        component that declares the block. Scoped, every selector below that
        targets their elements silently does nothing — which is exactly what
        happened first time round, and it renders as an unstyled pile rather
        than as an error. Every class here carries the `ec-` prefix, so global
        is safe.
      */}
      <style jsx global>{`
        .ec { margin: 6px 0 0; }
        .ec-cols {
          display: grid; grid-template-columns: 300px 1fr; gap: 22px;
          align-items: start;
        }
        @media (max-width: 780px) { .ec-cols { grid-template-columns: 1fr; } }

        .ec-panel {
          border: 1px solid var(--rule); border-radius: 3px; padding: 16px 15px;
          background: var(--card);
        }
        .ec-panelhead { margin-bottom: 16px; }
        .ec-panelhead h2 { font-size: 14px; margin: 0 0 5px; font-weight: 600; }
        .ec-panelhead p {
          font-size: 11.5px; line-height: 1.6; color: var(--ink3); margin: 0;
        }

        .ec-f { display: block; margin-bottom: 15px; }
        .ec-lab {
          display: flex; align-items: baseline; gap: 7px;
          font-size: 12px; color: var(--ink2); margin-bottom: 5px;
        }
        .ec-lab b {
          margin-left: auto; font-size: 13px; color: var(--ink);
          font-variant-numeric: tabular-nums; white-space: nowrap;
        }
        .ec-from {
          font-style: normal; font-size: 8.5px; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--ink3);
          border: 1px solid var(--rule); border-radius: 2px; padding: 1px 4px;
        }
        .ec-f small {
          display: block; font-size: 10.5px; line-height: 1.5;
          color: var(--ink3); margin-top: 4px;
        }
        .ec-f input[type="range"] {
          width: 100%; display: block; accent-color: var(--ink); margin: 0;
        }
        .ec-cap {
          width: 100%; font: inherit; font-size: 13px; padding: 6px 8px;
          border: 1px solid var(--rule); border-radius: 3px;
          background: var(--bg); color: var(--ink);
        }
        .ec-reset {
          font: inherit; font-size: 11.5px; color: var(--ink2); cursor: pointer;
          background: none; border: 1px solid var(--rule); border-radius: 3px;
          padding: 6px 10px; width: 100%;
        }
        .ec-reset:hover { color: var(--ink); }

        .ec-hero {
          border: 1px solid var(--rule); border-radius: 3px; padding: 20px 18px;
          text-align: center; margin-bottom: 12px;
        }
        .ec-hero.ok { background: #F1F7F2; border-color: #CADFCE; }
        .ec-hero.bad { background: #FBF1F0; border-color: #E4C8C5; }
        .ec-hero > span {
          display: block; font-family: 'Archivo', sans-serif; font-size: 9.5px;
          letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink3);
        }
        .ec-hero > b {
          display: block; font-size: 40px; line-height: 1.1; margin: 6px 0 4px;
          font-variant-numeric: tabular-nums;
        }
        .ec-hero.ok > b { color: #2E6B3E; }
        .ec-hero.bad > b { color: #A33A30; }
        .ec-hero > small { font-size: 12px; color: var(--ink2); }

        .ec-verdict {
          font-size: 13px; line-height: 1.7; margin: 0 0 14px;
          padding: 11px 13px; border-radius: 3px; color: var(--ink2);
          border-left: 2px solid var(--rule); background: var(--card);
        }
        .ec-verdict.ok { border-left-color: #6FA57C; }
        .ec-verdict.bad { border-left-color: #C2695D; }
        .ec-verdict b { color: var(--ink); }

        .ec-stats, .ec-top {
          display: grid; grid-template-columns: repeat(4, 1fr);
          border: 1px solid var(--rule); border-radius: 3px; background: var(--card);
        }
        .ec-top { margin: 0 0 16px; }
        @media (max-width: 620px) {
          .ec-stats, .ec-top { grid-template-columns: repeat(2, 1fr); }
        }
        .ec-stat {
          padding: 11px 13px; border-right: 1px solid var(--rule);
          display: flex; flex-direction: column; gap: 3px; min-width: 0;
        }
        .ec-stat:last-child { border-right: 0; }
        .ec-stat > span {
          font-family: 'Archivo', sans-serif; font-size: 9.5px;
          letter-spacing: 0.11em; text-transform: uppercase; color: var(--ink3);
        }
        .ec-stat > b { font-size: 16px; font-variant-numeric: tabular-nums; }
        .ec-stat > b.ok { color: #2E6B3E; }
        .ec-stat > b.bad { color: #A33A30; }
        .ec-stat > small { font-size: 10.5px; color: var(--ink3); line-height: 1.45; }

        .ec-h2 { font-size: 17px; margin: 40px 0 7px; font-weight: 600; }
        .ec-sub {
          font-size: 13px; line-height: 1.7; color: var(--ink2);
          margin: 0 0 16px; max-width: 68ch;
        }

        .ec-gridwrap { overflow-x: auto; max-width: 100%; }
        .ec-matrix {
          border-collapse: collapse; font-size: 11.5px; min-width: 560px;
          width: 100%; font-variant-numeric: tabular-nums;
        }
        .ec-matrix th {
          font-family: 'Archivo', sans-serif; font-size: 10px;
          letter-spacing: 0.06em; color: var(--ink3); font-weight: 600;
          padding: 6px 4px; text-align: center;
        }
        .ec-matrix tbody th { text-align: right; padding-right: 9px; white-space: nowrap; }
        .ec-matrix .ec-corner { text-align: left; }
        .ec-matrix td {
          text-align: center; padding: 7px 4px; border: 1px solid var(--bg);
          color: var(--ink2);
        }
        /* Tinted by magnitude so the shape of the break-even boundary is
           visible at a glance, capped so the extremes do not flatten the rest. */
        .ec-matrix td.pos { background: rgba(94, 152, 110, calc(0.09 + var(--i) * 0.5)); }
        .ec-matrix td.neg { background: rgba(190, 96, 82, calc(0.07 + var(--i) * 0.42)); }
        .ec-matrix td.here {
          outline: 2px solid var(--ink); outline-offset: -2px;
          font-weight: 700; color: var(--ink);
        }

        .ec-chartwrap {
          border: 1px solid var(--rule); border-radius: 3px; background: var(--card);
          padding: 10px 8px; margin-bottom: 14px; overflow-x: auto;
        }
        .ec-chart { width: 100%; min-width: 480px; height: auto; display: block; }
        .ec-chart .ec-gl { stroke: var(--rule); stroke-width: 1; }
        .ec-chart .ec-axis {
          font-size: 9px; fill: var(--ink3); font-family: 'Archivo', sans-serif;
        }
        .ec-chart .ec-line { stroke-width: 1.8; }
        .ec-chart .ec-line-low { stroke: #C2695D; }
        .ec-chart .ec-line-base { stroke: #4A5B8C; stroke-width: 2.4; }
        .ec-chart .ec-line-high { stroke: #5E986E; }

        .ec-scen { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        @media (max-width: 620px) { .ec-scen { grid-template-columns: 1fr; } }
        .ec-sc {
          border: 1px solid var(--rule); border-radius: 3px; padding: 11px 13px;
          display: grid; grid-template-columns: auto 1fr; gap: 2px 8px;
          align-items: center; background: var(--card);
        }
        .ec-sc.on { border-color: var(--ink3); }
        .ec-sc b { font-size: 12.5px; }
        .ec-sc i {
          grid-column: 1 / -1; font-style: normal; font-size: 10.5px; color: var(--ink3);
        }
        .ec-sc em {
          grid-column: 1 / -1; font-style: normal; font-size: 17px; margin-top: 5px;
          font-variant-numeric: tabular-nums;
        }
        .ec-sc small { grid-column: 1 / -1; font-size: 11px; color: var(--ink3); }
        .ec-dot { width: 9px; height: 9px; border-radius: 50%; display: block; }
        .ec-dot-low { background: #C2695D; }
        .ec-dot-base { background: #4A5B8C; }
        .ec-dot-high { background: #5E986E; }

        .ec-miles {
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
          margin-top: 12px;
        }
        @media (max-width: 620px) { .ec-miles { grid-template-columns: repeat(2, 1fr); } }
        .ec-miles > div {
          border: 1px solid var(--rule); border-radius: 3px; padding: 10px 12px;
          background: var(--card); display: flex; flex-direction: column; gap: 3px;
        }
        .ec-miles span {
          font-family: 'Archivo', sans-serif; font-size: 9.5px;
          letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink3);
        }
        .ec-miles b { font-size: 15px; font-variant-numeric: tabular-nums; }
        .ec-miles small { font-size: 10.5px; color: var(--ink3); }

        .ec-drag, .ec-ruin {
          font-size: 12.5px; line-height: 1.72; color: var(--ink2);
          margin: 16px 0 0; max-width: 70ch;
        }
        .ec-drag b { color: var(--ink); }
        .ec-ruin {
          border-left: 2px solid #C2695D; padding: 11px 13px;
          background: #FBF1F0; border-radius: 3px;
        }
        .ec-soft {
          font-size: 12.5px; line-height: 1.7; color: var(--ink2);
          border-left: 2px solid #C9A227; background: #FBF7EA;
          padding: 11px 13px; border-radius: 3px; margin: 0 0 16px; max-width: 70ch;
        }
        .ec-soft b { color: var(--ink); }
        .ec-impl { margin-top: 0; }
        .ec-impl p { margin: 0 0 10px; }
        .ec-impl p:last-child { margin-bottom: 0; }
        .ec-impl b { color: var(--ink); }
        .ec-clip {
          font-size: 11px; color: var(--ink3); margin: 6px 2px 2px; line-height: 1.5;
        }

        .ec-caveat { margin-top: 34px; border-top: 1px solid var(--rule); padding-top: 18px; }
        .ec-caveat h3 {
          font-family: 'Archivo', sans-serif; font-size: 10px; letter-spacing: 0.16em;
          text-transform: uppercase; color: var(--ink3); margin: 0 0 10px;
          font-weight: 600;
        }
        .ec-caveat ul {
          margin: 0; padding-left: 18px; max-width: 70ch;
          font-size: 12.5px; line-height: 1.7; color: var(--ink2);
        }
        .ec-caveat li { margin-bottom: 8px; }
        .ec-caveat b { color: var(--ink); font-weight: 600; }
      `}</style>
    </div>
  );
}
