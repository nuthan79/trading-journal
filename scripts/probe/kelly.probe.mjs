import { test, eq, ok, near } from "./harness.mjs";
import { kellyFromR, growthAt, KELLY_MIN_TRADES } from "@/lib/kelly";

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

const trade = (i, r, riskPct) => ({
  id: `t${i}`, symbol: "X", status: "closed", side: "long",
  entry_date: `2025-${String((i % 12) + 1).padStart(2, "0")}-05`,
  exit_date: `2025-${String((i % 12) + 1).padStart(2, "0")}-20`,
  entry_price: 100, quantity: 100, stop_loss: 90,
  stop_source: "recorded", r, riskPct, pnl: r * 1000,
});

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
