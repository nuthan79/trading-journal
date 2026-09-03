import { test, eq, ok, near } from "./harness.mjs";
import { annualisedReturn, xirr, cagr, returnQuality } from "@/lib/calc";
import { describeAnnualised } from "@/lib/format";
import { derivePosition } from "@/lib/positions";

/**
 * THE FIGURE PEOPLE TRUST WITHOUT CHECKING.
 *
 * "19% a year" is read as a fact about the trader. It is arithmetic over four
 * inputs — opening balance, closing value, elapsed time, and any money that
 * moved in between — and getting any of them wrong produces a confident,
 * plausible, wrong number. So each is pinned separately.
 */

const mk = (t) => {
  const d = derivePosition(t, 5e6);
  return { ...t, ...d, status: t.status, exits: t.exits };
};

/* Doubled the money in exactly two years: 100% total, 41.42% a year. */
const DOUBLED = mk({ id: "d", symbol: "X", side: "long", status: "closed",
  entry_date: "2024-09-03", entry_price: 100, quantity: 10000,
  stop_loss: 90, stop_source: "recorded", charges: 0,
  exit_date: "2026-09-03", exit_price: 200,
  exits: [{ exit_date: "2026-09-03", quantity: 10000, price: 200, charges: 0 }] });

const AT = new Date("2026-09-03T00:00:00Z");

test("no deposits: it is CAGR, and says so", () => {
  const a = annualisedReturn([DOUBLED], { openingCapital: 1e6, flows: [], asOf: AT });
  eq(a.method, "cagr");
  near(a.base, 1e6, 0.01);
  near(a.closing, 2e6, 0.01, "a million made on a million");
  near(a.years, 2, 0.01);
  near(a.rate, Math.SQRT2 - 1, 1e-6, "doubling in two years is 41.42% a year");
});

test("and that CAGR is exactly what XIRR would return", () => {
  /* The claim the label rests on: with two cash flows the solver and the
     closed form are the same number, so running the solver would be theatre
     and calling it XIRR would be a bigger word for the same arithmetic. */
  const solved = xirr([
    { date: "2024-09-03", amount: -1e6 },
    { date: "2026-09-03", amount: 2e6 },
  ]);
  near(solved, cagr(1e6, 2e6, 2), 1e-4);
  near(solved, annualisedReturn([DOUBLED],
    { openingCapital: 1e6, flows: [], asOf: AT }).rate, 1e-4);
});

test("a deposit makes it a real XIRR, money-weighted", () => {
  /*
    The same closing value, but half the capital only arrived at the end —
    so the money-weighted return must be HIGHER than the naive one. This is
    the whole reason XIRR exists, and the check that the sign convention is
    the right way round: a deposit is money leaving your pocket, negative.
  */
  const a = annualisedReturn([DOUBLED], { openingCapital: 1e6, asOf: AT,
    flows: [{ flow_date: "2026-06-03", amount: 500000 }] });
  eq(a.method, "xirr");
  eq(a.flows, 1);
  near(a.closing, 2.5e6, 0.01, "the deposit is in the closing balance");
  const naive = cagr(1.5e6, 2.5e6, 2);
  ok(a.rate > naive,
    `late capital must not be charged two years of compounding (${a.rate} vs ${naive})`);
  ok(a.rate > 0.30 && a.rate < 0.60, `plausible, got ${a.rate}`);
});

test("money paid in before the first trade is opening balance, not a flow", () => {
  /* Otherwise the account looks like it started at zero and every rupee of
     it reads as profit. */
  const a = annualisedReturn([DOUBLED], { openingCapital: 0, asOf: AT,
    flows: [{ flow_date: "2024-09-01", amount: 1e6 }] });
  eq(a.method, "cagr", "nothing moved DURING the record");
  eq(a.flows, 0);
  near(a.base, 1e6, 0.01);

  /*
    AND THE CLOCK STARTS WHEN THE MONEY DID, not when the first trade was
    taken. The deposit landed two days before it, so this is 732 days and a
    hair under the 41.42% that doubling in exactly two years gives.

    That is the honest reading and matches what a broker's own XIRR does:
    cash sitting idle in the account is capital committed and earning
    nothing, and hiding those two days would flatter every record that
    funded itself before it started trading.
  */
  eq(a.days, 732);
  near(a.rate, cagr(1e6, 2e6, 732 / 365), 1e-9);
  ok(a.rate < Math.SQRT2 - 1, "idle days cost a little, they do not pay");
});

test("open positions are marked to market, not carried at cost", () => {
  /* The decision this tile turns on: a book of winners still held must show
     up in the return, or the figure only moves on the day you sell. */
  const held = mk({ id: "h", symbol: "Y", side: "long", status: "open",
    entry_date: "2024-09-03", entry_price: 100, quantity: 10000,
    stop_loss: 90, stop_source: "recorded", charges: 0, last_price: 200,
    exits: [] });
  const a = annualisedReturn([held], { openingCapital: 1e6, flows: [], asOf: AT });
  near(a.unrealised, 1e6, 0.01);
  near(a.closing, 2e6, 0.01, "marked at 200, not held at 100");
  near(a.rate, Math.SQRT2 - 1, 1e-6, "same as if it had been sold");
});

test("a position with no quote is carried at cost, never at zero", () => {
  /* unrealisedPnl is NaN with no mark — the app degrades to no mark rather
     than to a loss — and NaN must not poison the sum. */
  const noMark = mk({ id: "n", symbol: "Z", side: "long", status: "open",
    entry_date: "2024-09-03", entry_price: 100, quantity: 10000,
    stop_loss: 90, stop_source: "recorded", charges: 0, exits: [] });
  const a = annualisedReturn([noMark], { openingCapital: 1e6, flows: [], asOf: AT });
  ok(!isFinite(noMark.unrealisedPnl), "the fixture really has no mark");
  near(a.closing, 1e6, 0.01, "carried at cost");
  ok(isFinite(a.rate) && Math.abs(a.rate) < 1e-9, "flat, not −100%");
});

test("six weeks of history is refused, not annualised", () => {
  /*
    +4% over six weeks compounds to about +38% a year, which is a statement
    about the exponent rather than about the trader. The tile says so instead.
  */
  const quick = mk({ id: "q", symbol: "Q", side: "long", status: "closed",
    entry_date: "2026-07-24", entry_price: 100, quantity: 400,
    stop_loss: 90, stop_source: "recorded", charges: 0,
    exit_date: "2026-08-20", exit_price: 110,
    exits: [{ exit_date: "2026-08-20", quantity: 400, price: 110, charges: 0 }] });
  const a = annualisedReturn([quick], { openingCapital: 1e5, flows: [], asOf: AT });
  eq(a.method, "too-short");
  ok(!isFinite(a.rate), "no number at all, rather than a flattering one");
  eq(a.minDays, 90);
});

test("no capital recorded means no percentage to give", () => {
  const a = annualisedReturn([DOUBLED], { openingCapital: 0, flows: [], asOf: AT });
  eq(a.method, "no-capital");
  ok(!isFinite(a.rate));
});

test("the elapsed time is read without a timezone", () => {
  /* `new Date("2024-09-03")` is UTC midnight read back local, which west of
     Greenwich lands on 2 September and shortens the record by a day —
     small, but it moves the exponent on every book. */
  const a = annualisedReturn([DOUBLED], { openingCapital: 1e6, flows: [], asOf: AT });
  eq(a.days, 730, "two years to the day, in any zone");
});

test("a loss annualises as a loss", () => {
  const halved = mk({ id: "l", symbol: "L", side: "long", status: "closed",
    entry_date: "2024-09-03", entry_price: 100, quantity: 10000,
    stop_loss: 90, stop_source: "recorded", charges: 0,
    exit_date: "2026-09-03", exit_price: 50,
    exits: [{ exit_date: "2026-09-03", quantity: 10000, price: 50, charges: 0 }] });
  const a = annualisedReturn([halved], { openingCapital: 1e6, flows: [], asOf: AT });
  near(a.closing, 5e5, 0.01);
  near(a.rate, Math.SQRT1_2 - 1, 1e-6, "halving in two years is −29.3% a year");
});

/* ---------------- the words, which two screens now share ----------------- */

test("both screens describe one book the same way", () => {
  /*
    The Dashboard and the Performance sheet show this number side by side in a
    user's session. Reading "CAGR" on one and "XIRR" on the other for the same
    record would say the app cannot make up its mind — so the description is
    one function and this is the check that it stays one.
  */
  const a = annualisedReturn([DOUBLED], { openingCapital: 1e6, flows: [], asOf: AT });
  const d = describeAnnualised(a);
  eq(d.label, "CAGR");
  eq(d.value, "+41.4%");
  eq(d.tone, "pos");
  ok(/also the XIRR/.test(d.hint), "and says the two agree here");
});

test("a recorded deposit relabels it, in the same words", () => {
  const a = annualisedReturn([DOUBLED], { openingCapital: 1e6, asOf: AT,
    flows: [{ flow_date: "2026-06-03", amount: 500000 }] });
  const d = describeAnnualised(a);
  eq(d.label, "XIRR");
  ok(/Money-weighted/.test(d.hint));
  ok(/1 deposit or withdrawal\b/.test(d.hint), `singular, got: ${d.hint}`);
});

test("the refusals carry their reason, not a bare dash", () => {
  const short = describeAnnualised(annualisedReturn([DOUBLED],
    { openingCapital: 1e6, flows: [], asOf: new Date("2024-10-03T00:00:00Z") }));
  eq(short.value, "—");
  ok(/90 days/.test(short.hint));

  const broke = describeAnnualised(annualisedReturn([DOUBLED],
    { openingCapital: 0, flows: [], asOf: AT }));
  eq(broke.value, "—");
  ok(/account size/i.test(broke.hint), "tells them where to fix it");

  /* And it survives being handed nothing at all, which is what a screen with
     no trades yet passes in. */
  eq(describeAnnualised(null).value, "—");
  eq(describeAnnualised(undefined).label, "CAGR");
});

test("a loss reads as a loss in the tile too", () => {
  const d = describeAnnualised({ rate: -0.293, method: "cagr", years: 2, days: 730,
    flows: 0, marked: false });
  eq(d.tone, "neg");
  ok(d.value.startsWith("−") || d.value.startsWith("-"), `got ${d.value}`);
});

/* ------------- qualifying the rate: pain, and the real denominator ------- */

test("return per unit of drawdown is the rate divided by the hole", () => {
  const q = returnQuality({ rate: 0.183, maxDDPct: 24.1 });
  near(q.perDrawdown, 18.3 / 24.1, 1e-9, "0.76% a year per 1% drawn down");
  ok(q.perDrawdown < 1, "a return smaller than its drawdown reads under 1");

  /* The shape that should make anyone look twice. */
  ok(returnQuality({ rate: 0.60, maxDDPct: 5 }).perDrawdown > 1);
});

test("no drawdown recorded is not an infinite ratio", () => {
  /* A book that has never given anything back divides by zero, and Infinity
     rendered as a return quality would be the single most flattering wrong
     number this app could print. */
  for (const dd of [0, -1, NaN, undefined, null]) {
    ok(!isFinite(returnQuality({ rate: 0.18, maxDDPct: dd }).perDrawdown),
      `maxDDPct ${dd} must not produce a number`);
  }
  ok(!isFinite(returnQuality({ rate: NaN, maxDDPct: 10 }).perDrawdown),
    "and no rate means no ratio");
});

test("a losing record keeps its sign", () => {
  ok(returnQuality({ rate: -0.12, maxDDPct: 30 }).perDrawdown < 0);
});

test("return on capital employed uses the money at work, not the settings figure", () => {
  /*
    ₹42.82 L earned over 7 years while ₹64.47 L was committed on an average
    day. That is 66.4% on the money at work, or 9.5% a year — and it is a
    different number from the same profit measured against whatever was typed
    into Settings, which is the whole point of showing it.
  */
  const q = returnQuality({ netPnl: 4282000, avgDeployed: 6447000, years: 7 });
  near(q.employedTotal, (4282000 / 6447000) * 100, 1e-9);
  near(q.employed, ((4282000 / 6447000) / 7) * 100, 1e-9);
  ok(q.employed > 9 && q.employed < 10, `about 9.5% a year, got ${q.employed}`);
});

test("employed return refuses the cases that would divide by nothing", () => {
  for (const bad of [{ avgDeployed: 0 }, { avgDeployed: -5 }, { avgDeployed: NaN }]) {
    ok(!isFinite(returnQuality({ netPnl: 1e5, years: 2, ...bad }).employed));
  }
  ok(!isFinite(returnQuality({ netPnl: 1e5, avgDeployed: 1e6, years: 0 }).employed),
    "and a zero span is not a rate");
});

test("a loss on employed capital reads as a loss", () => {
  const q = returnQuality({ netPnl: -300000, avgDeployed: 2000000, years: 3 });
  ok(q.employed < 0);
  near(q.employed, ((-300000 / 2000000) / 3) * 100, 1e-9);
});
