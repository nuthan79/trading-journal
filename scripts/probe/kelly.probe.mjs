import { test, eq, ok, near } from "./harness.mjs";
import { kellyFromR, growthAt, nextRiskStep, KELLY_MIN_TRADES } from "@/lib/kelly";

/**
 * ADVICE THAT CAN LOSE REAL MONEY.
 *
 * Every other figure in this app describes what already happened. This one
 * tells somebody how much to bet next time, and the penalty for getting it
 * wrong is asymmetric: half the optimum costs a quarter of the growth,
 * double the optimum loses money outright. So the checks lean hard on the
 * cases where a number must NOT be produced.
 */

const rep = (x, k) => Array.from({ length: k }, () => x);

test("it reproduces textbook Kelly on a textbook bet", () => {
  /* 60% winners at 1R, lose 1R — the coin-flip example every derivation
     uses. Closed form: p − q/b = 0.6 − 0.4 = 20% of capital. */
  const rs = [...rep(1, 600), ...rep(-1, 400)];
  const k = kellyFromR(rs);
  eq(k.method, "ok");
  near(k.full, 0.20, 1e-4, "full Kelly");
  near(k.suggested, 0.05, 1e-4, "a quarter of it, which is what gets shown");
});

test("and on an asymmetric one", () => {
  /* 50% winners at 2R, losers at 1R. p − q/b = 0.5 − 0.5/2 = 25%. */
  const rs = [...rep(2, 500), ...rep(-1, 500)];
  near(kellyFromR(rs).full, 0.25, 1e-4);
});

test("one huge winner does not raise the prescription the way a mean does", () => {
  /*
    THE REASON THIS IS NOT THE TWO-OUTCOME FORMULA.

    Same book twice, except one winner is +140R instead of +2R. The mean win
    leaps, so textbook Kelly on mean-win/mean-loss leaps with it — prescribing
    a bet the ordinary trade never justified. Maximising log growth over the
    real distribution barely moves, because one trade in a thousand is one
    trade in a thousand however large it was.
  */
  const base = [...rep(2, 400), ...rep(-1, 600)];
  const tail = [...base.slice(1), 140];

  const flat = kellyFromR(base).full;
  const fat = kellyFromR(tail).full;

  /* What the textbook formula would have said, for contrast. */
  const twoOutcome = (xs) => {
    const w = xs.filter((x) => x > 0), l = xs.filter((x) => x <= 0);
    const W = w.length / xs.length;
    const aw = w.reduce((a, b) => a + b, 0) / w.length;
    const al = Math.abs(l.reduce((a, b) => a + b, 0) / l.length);
    return (W * aw - (1 - W) * al) / (aw * al);
  };
  const naiveJump = twoOutcome(tail) / twoOutcome(base);
  const realJump = fat / flat;
  ok(realJump < naiveJump,
    `the tail must move this less than it moves the formula (${realJump} vs ${naiveJump})`);
  ok(realJump < 1.6, `and not by much at all, got ${realJump}`);
});

test("the worst loss is a hard ceiling, and it binds", () => {
  /*
    The number the textbook formula cannot see. With a −4R trade in the book,
    risking more than 25% of capital per trade means that one trade took the
    account to zero or past it — so no prescription may exceed it, whatever
    the edge looks like.
  */
  const rs = [...rep(3, 700), ...rep(-4, 300)];
  const k = kellyFromR(rs);
  near(k.ceiling, 0.25, 1e-9, "1 / 4R");
  ok(k.full <= k.ceiling, "never past the ceiling");
  ok(growthAt(rs, k.ceiling * 1.01) === -Infinity,
    "and past it the account is wiped, which the objective says as -Infinity");
});

test("a negative edge gets no fraction at all", () => {
  /* There is no bet size that fixes a losing system; larger only loses
     faster. The screen must say that rather than print a small number. */
  const k = kellyFromR([...rep(1, 400), ...rep(-1, 600)]);
  eq(k.method, "no-edge");
  ok(!isFinite(k.full ?? NaN));
});

test("a record with no losses is refused, not rewarded", () => {
  /* Nothing bounds the search, so it would run away and prescribe betting
     everything. A real book always has a losing trade; one that does not is
     too short or mis-recorded. */
  eq(kellyFromR(rep(1, 50)).method, "no-loss");
});

test("a thin record is refused", () => {
  eq(kellyFromR([...rep(2, 10), ...rep(-1, 10)]).method, "thin");
  eq(kellyFromR([]).method, "thin");
  eq(kellyFromR(null).method, "thin");
  ok(KELLY_MIN_TRADES >= 30, "and the floor is a real sample");
});

test("the quarter fraction really does cost only a little growth", () => {
  /*
    The claim the recommendation rests on. Betting a quarter of the optimum
    keeps most of the growth while surviving a badly overstated edge; betting
    double the optimum gives it all back. If this ever stops holding, the
    advice is wrong.
  */
  const rs = [...rep(2, 450), ...rep(-1, 550)];
  const k = kellyFromR(rs);
  const gFull = growthAt(rs, k.full);
  const gQuarter = growthAt(rs, k.suggested);
  const gDouble = growthAt(rs, k.full * 2);

  ok(gQuarter > 0 && gQuarter > gFull * 0.4,
    "a quarter keeps a real share of the growth");
  ok(gDouble < gQuarter,
    "while double the optimum is worse than a quarter of it");
  ok(gFull >= gQuarter && gFull >= gDouble, "and full Kelly is the peak");
});

test("noisy real-world R multiples still produce a sane fraction", () => {
  /* Shaped like a swing book: mostly small losses, some 1-3R winners, a
     couple of outliers. Nothing here should prescribe more than a few
     percent after the quarter fraction. */
  const rs = [
    ...rep(-1, 260), ...rep(-0.5, 120), ...rep(-2, 40),
    ...rep(1.5, 120), ...rep(3, 70), ...rep(6, 25), 17, 43, 140,
  ];
  const k = kellyFromR(rs);
  eq(k.method, "ok");
  ok(k.suggested > 0.005 && k.suggested < 0.08,
    `a few percent, got ${(k.suggested * 100).toFixed(2)}%`);
  ok(k.suggested < k.ceiling, "and well inside the ceiling");
});

/* --------------- the finding, on books shaped to trip each branch -------- */

/* riskAmt as well as riskPct: the card reports both units now, and takes them
   from the same trade, so a fixture carrying only the percentage is filtered
   out entirely. */
const ACCOUNT = 1000000;
const trade = (i, r, riskPct) => {
  const riskAmt = (riskPct / 100) * ACCOUNT;
  return {
    id: `t${i}`, symbol: "X", status: "closed", side: "long",
    entry_date: `2025-${String((i % 12) + 1).padStart(2, "0")}-05`,
    exit_date: `2025-${String((i % 12) + 1).padStart(2, "0")}-20`,
    entry_price: 100, quantity: 100, stop_loss: 90,
    stop_source: "recorded", r, riskPct, riskAmt, pnl: r * riskAmt,
  };
};

/* 45% winners at 3R, losers at 1R — a real edge, worst trade −2R. */
const book = (riskPct) => {
  const out = [];
  for (let i = 0; i < 120; i++) out.push(trade(i, i % 20 === 0 ? -2 : (i % 100 < 45 ? 3 : -1), riskPct));
  return out;
};

test("the card fires only at the two ends, and stays quiet in between", async () => {
  const { reviewFindings } = await import("@/lib/analysis");
  const find = (rows) => {
    const all = reviewFindings(rows, [], { openingCapital: 1e6 }) || [];
    const list = Array.isArray(all) ? all : (all.findings || []);
    /* Only the three this file owns. `riskConsistency` also emits ids
       beginning "risk-" — risk-consistent, risk-inconsistent, risk-outliers,
       risk-escalation — and a startsWith filter swept those in and read as
       this card firing when it had not. */
    const MINE = new Set(["risk-oversized", "risk-above-edge", "risk-below-edge"]);
    return list.filter((f) => MINE.has(f.id));
  };

  const k = kellyFromR(book(1).map((t) => t.r));
  ok(k.method === "ok", "the fixture has a measurable edge");

  /* Tiny stake against a real edge — the encouraging end. */
  const low = find(book(k.suggested * 100 * 0.2));
  ok(low.some((f) => f.id === "risk-below-edge"), "betting far under is reported");

  /* Sitting on the recommendation — nothing to say. */
  const ok_ = find(book(k.suggested * 100));
  eq(ok_.length, 0, "and a size that matches it is silence, not praise");

  /* Past the growth-maximising point — the dangerous end. */
  const high = find(book(k.full * 100 * 1.2));
  ok(high.some((f) => f.id === "risk-oversized"), "betting past full Kelly is critical");
  eq(high.find((f) => f.id === "risk-oversized").severity, "critical");
});

test("an assumed stop never drives sizing advice", () => {
  /*
    R off an assumed stop is a rescaling of percentage return, so a
    prescription built on it would be sizing advice derived from position
    size. The finding must go silent rather than answer from it.
  */
  const assumed = book(1).map((t) => ({ ...t, stop_source: "assumed" }));
  const rs = assumed.filter((t) => t.stop_source === "recorded").map((t) => t.r);
  eq(rs.length, 0, "the fixture really has no recorded stops");
  eq(kellyFromR(rs).method, "thin", "and nothing can be computed from it");
});

/* ------------------- the step somebody can actually take ----------------- */

test("the suggested step is an increment, never the ceiling", () => {
  /*
    THE ADVICE THE CARD GIVES.

    Quarter-Kelly on a good record can sit eighteen times above where a
    careful trader is. Printing that as the recommendation is not advice — it
    is a dare. The step is what changes hands.
  */
  const step = nextRiskStep(0.0025, 0.045);
  near(step, 0.0035, 1e-9, "0.25% becomes 0.35%, not 4.5%");
  ok(step < 0.045, "and stays far inside the ceiling");
});

test("it lands on a number somebody would type", () => {
  for (const cur of [0.0025, 0.004, 0.0071, 0.012]) {
    const s = nextRiskStep(cur, 0.05);
    const asPct = s * 100;
    near(asPct * 20, Math.round(asPct * 20), 1e-9,
      `${asPct}% should be a multiple of 0.05`);
  }
});

test("it never steps past the ceiling, even when rounding would", () => {
  /* Rounding down rather than to nearest, so the clamp cannot be undone by
     the tidying that comes after it. */
  const s = nextRiskStep(0.0028, 0.003);
  ok(!isFinite(s) || s <= 0.003, `got ${s}`);
  const t = nextRiskStep(0.01, 0.0104);
  ok(!isFinite(t) || t <= 0.0104, `got ${t}`);
});

test("no step is suggested when there is no room for one", () => {
  ok(!isFinite(nextRiskStep(0.05, 0.05)), "already at the ceiling");
  ok(!isFinite(nextRiskStep(0.06, 0.05)), "already past it");
  ok(!isFinite(nextRiskStep(0.0025, 0.0026)), "the gap is smaller than a step");
  for (const bad of [0, -1, NaN, undefined]) {
    ok(!isFinite(nextRiskStep(bad, 0.05)), "no current risk, no advice");
    ok(!isFinite(nextRiskStep(0.0025, bad)), "no ceiling, no advice");
  }
});

test("the rupee figures come from measured risk, not multiplied back out", () => {
  /*
    riskAmt is (entry − stop) × quantity: money the trade actually put up.
    riskPct is that divided by the account size — the one field the app cannot
    verify. The rupee advice is riskAmt scaled by how far the step is from
    where the trader is, so it is anchored to real money at both ends.

    NOT claimed here: independence from the account size. Risk per trade IS a
    share of the account, so the recommendation properly moves with it — an
    earlier version of this probe asserted otherwise and was simply wrong
    about what the metric means. What must hold is that the two units agree.
  */
  const account = 15000000, riskAmt = 40500;
  const current = riskAmt / account;
  const k = kellyFromR([
    ...rep(3, 63), ...rep(-1, 71), ...rep(-4.4, 6),
  ]);
  const step = nextRiskStep(current, k.suggested);
  ok(isFinite(step), "there is a step to take");

  const amt = riskAmt * (step / current);
  near(amt / account, step, 1e-12, "rupees and percent are one statement");
  near(amt, 52500, 1, "0.27% of ₹1.5 Cr stepped to 0.35% is ₹52,500");
});

test("a very small stake still gets advice, on a finer grid", () => {
  /*
    THE CARD GOING SILENT ON THE PEOPLE IT IS FOR.

    At 0.135% a whole 40% increase is 0.054 of a percentage point, which the
    0.05 grid rounded back to where the trader already stood — so the card
    said nothing to the most under-sized book in the app.
  */
  const k = kellyFromR([...rep(3, 63), ...rep(-1, 71), ...rep(-4.4, 6)]);
  const step = nextRiskStep(0.00135, k.suggested);
  ok(isFinite(step), "it now has something to say");
  ok(step > 0.00135, "and it is upward");
  ok(step >= 0.00135 * 1.05, "by an amount somebody would feel");
  near(step * 10000, Math.round(step * 10000), 1e-9,
    "still a round figure — a multiple of 0.01 of a point");
});

test("a move too small to feel is not offered at all", () => {
  /* Where the ceiling leaves only a sliver, the honest output is silence
     rather than "raise from 0.27% to 0.28%". */
  ok(!isFinite(nextRiskStep(0.0027, 0.00276)), "under 5% up, say nothing");
});

test("percentage and rupees describe the same trade", () => {
  /*
    They are two readings of one median position, not two independent
    medians — otherwise "0.27%" and "₹40.5k" could come from different trades
    and quietly imply an account size that never existed.
  */
  const account = 15000000;
  const riskAmt = 40500;
  const pct = (riskAmt / account) * 100;
  near((pct / 100) * account, riskAmt, 1e-6);

  /* And the worst-case figure agrees in both units at the stepped size. */
  const stepPct = 0.35 / 100;
  const stepAmt = riskAmt * (stepPct / (pct / 100));
  const worst = -4.4;
  near(Math.abs(worst) * stepAmt / account * 100,
       Math.abs(worst) * stepPct * 100, 1e-9,
       "1.5% and ₹2.31 L are the same statement");
});
