import { test, ok, eq, near } from "./harness.mjs";
import { mtfFigures, isMtf, annualPct } from "@/lib/mtf";

/**
 * MTF, worked by hand.
 *
 * 235 shares at ₹1,000 is ₹2,35,000. At 2.35× leverage your own money is
 * ₹1,00,000 and the broker funds ₹1,35,000. At ₹40 per lakh per day that is
 * 1.35 × 40 = ₹54 a day.
 */
const BASE = {
  entryPrice: 1000, quantity: 235, entryDate: "2026-09-01",
  leverage: 2.35, rate: 40, riskAmt: 5000, asOf: "2026-09-11",
};

test("leverage splits the position the way the broker states it", () => {
  const m = mtfFigures(BASE);
  near(m.position, 235000, 0.01);
  near(m.own, 100000, 0.01, "₹1,00,000 of yours buys ₹2,35,000 at 2.35×");
  near(m.funded, 135000, 0.01);
});

test("interest runs on the funded amount only", () => {
  const m = mtfFigures(BASE);
  near(m.perDayFull, 54, 0.001, "1.35 lakh × ₹40, not 2.35 lakh × ₹40");
  near(m.interest, 540, 0.01, "ten calendar days");
  near(m.interestR, 0.108, 0.0001, "₹540 of a ₹5,000 R");
});

test("how long the position can be held before interest costs a whole R", () => {
  near(mtfFigures(BASE).daysPerR, 5000 / 54, 0.001);
});

/**
 * SELLING STOPS THE INTEREST ON WHAT WAS SOLD. Billing every share to the last
 * exit is the easy formula and it overcharges a scaled-out position.
 */
test("a part-sold position is charged per tranche, to the day each left", () => {
  const m = mtfFigures({ ...BASE, exits: [{ exit_date: "2026-09-06", quantity: 100 }] });
  const perShareDay = (1000 * (1 - 1 / 2.35) * 40) / 1e5;
  near(m.interest, 100 * perShareDay * 5 + 135 * perShareDay * 10, 0.01);
  ok(m.interest < 540, "less than holding all of it for ten days");
  eq(m.openQty, 135);
  near(m.perDayNow, 135 * perShareDay, 0.0001, "today's cost is on what is still held");
});

test("a closed position stops accruing at its exits, whatever today is", () => {
  const exits = [{ exit_date: "2026-09-06", quantity: 235 }];
  const a = mtfFigures({ ...BASE, exits, asOf: "2026-09-11" });
  const b = mtfFigures({ ...BASE, exits, asOf: "2027-01-01" });
  near(a.interest, 54 * 5, 0.01);
  near(b.interest, a.interest, 0.001, "months later it has not grown");
  eq(a.openQty, 0);
});

test("the day count cannot drift with the timezone", () => {
  /* Parsed by hand as UTC days; the probe also runs under America/New_York. */
  const m = mtfFigures({ ...BASE, entryDate: "2026-03-01", asOf: "2026-03-31" });
  near(m.interest, 54 * 30, 0.01, "thirty days across a DST change");
});

test("an assumed entry date gives no interest figure, and says why", () => {
  const m = mtfFigures({ ...BASE, entryDateAssumed: true });
  ok(!Number.isFinite(m.interest));
  ok(/estimated/.test(m.why));
  near(m.own, 100000, 0.01, "the split does not depend on the date and still shows");
});

test("no rate yet: the split shows, the cost waits", () => {
  const m = mtfFigures({ ...BASE, rate: "" });
  near(m.funded, 135000, 0.01);
  ok(!Number.isFinite(m.interest) && /rate/.test(m.why));
});

test("return on your own money divides P&L that is already net of margin", () => {
  /* derivePosition takes interest and fees out of pnl, so the form hands in a
     net figure. Taking interest off again here counted it twice — this test
     used to pass a gross ₹10,000 and expect the subtraction. */
  const m = mtfFigures({ ...BASE, pnl: 9460 });
  near(m.returnOnOwnPct, 9.46, 0.001, "₹9,460 net on ₹1,00,000 of your own");
  near(m.returnOnPositionPct, (9460 / 235000) * 100, 0.0001);
});

test("the form counts the pledge and one unpledge per sell", () => {
  near(mtfFigures(BASE).fees, 18, 0.001, "pledged, nothing sold yet");
  const m = mtfFigures({ ...BASE, exits: [
    { exit_date: "2026-09-05", quantity: 100 }, { exit_date: "2026-09-08", quantity: 135 }] });
  near(m.fees, 18 + 18 * 2, 0.001);
  near(m.cost, m.interest + m.fees, 0.001);
});

test("what is and is not margin", () => {
  eq(isMtf(2.35), true);
  eq(isMtf("2.35"), true);
  eq(isMtf(1), false, "1× borrows nothing");
  eq(isMtf(""), false);
  eq(mtfFigures({ ...BASE, leverage: 1 }), null);
});

test("the yearly rate beside the input", () => {
  near(annualPct(40), 14.6, 0.0001, "₹40 per lakh a day is 14.6% a year");
});

/* ---- the form ------------------------------------------------------ */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");
const form = () => read("components/journal/TradeForm.jsx");

test("ticked as MTF, the trade cannot be saved without both figures", () => {
  const s = form();
  ok(/const mtfOk = !t\.mtf_on \|\| \(isMtf\(t\.mtf_leverage\) && num\(t\.mtf_rate\) > 0\);/.test(s));
  ok(/stopOk && exitsOk && mtfOk;/.test(s), "and Save waits on it");
});

/**
 * AN ORDINARY SAVE MUST NOT SEND THE NEW COLUMNS.
 *
 * Until migration 049 has run, a payload naming mtf_leverage fails the whole
 * upsert. Sent on every save, that would turn every trade logged in the gap
 * into an error over a field the trader never touched.
 */
test("the margin columns are only sent for a trade that is or was on margin", () => {
  const s = form();
  ok(/\.\.\.\(t\.mtf_on \|\| t\._hadMtf \? \{/.test(s));
  ok(/mtf_leverage: t\.mtf_on \? numOrNull\(t\.mtf_leverage\) : null,/.test(s),
    "unticked on a trade that had it, it sends null so it can be removed");
});

test("ticking MTF fills in the saved rate, and never overwrites a typed one", () => {
  const s = form();
  ok(/mtf_rate: on && p\.mtf_rate === "" && defaultMtfRate != null \? String\(defaultMtfRate\) : p\.mtf_rate,/.test(s));
});

test("the saved rate lives on the profile and only changes when it changed", () => {
  const s = read("app/(app)/layout.jsx");
  ok(/defaultMtfRate=\{profile\?\.mtf_rate\}/.test(s), "the form is given the saved rate");
  ok(/Number\(payload\.mtf_rate\) !== Number\(profile\?\.mtf_rate\)/.test(s), "written only on a change");
  ok(/try \{ setProfile\(await dbSaveProfile\(\{ mtf_rate: payload\.mtf_rate \}\)\); \} catch \{\}/.test(s),
    "and a failure there never turns a saved trade into an error");
});

/**
 * DEFINED BEFORE USE. The folded headers' summaries read the entry-chart link
 * and the MTF check, both declared lower in the component than where the
 * summaries were first written. A `const` read before its line throws on
 * render — the form would not open at all — and nothing in a build catches it.
 */
test("the fold summaries come after everything they read", () => {
  const s = form();
  const at = (x) => { const i = s.indexOf(x); ok(i >= 0, `missing: ${x}`); return i; };
  ok(at("const chart = resolveTradingViewChart(chartLink);") < at("const setupBits = ["));
  ok(at("const mtfOk =") < at("const mtfSummary ="));
  ok(at("const mtf = t.mtf_on ? mtfFigures(") < at("const mtfSummary ="));
});

test("the migration adds exactly what the app reads", () => {
  const sql = readFileSync(path.join(SRC, "../supabase/049_mtf.sql"), "utf8");
  ok(/add column if not exists mtf_leverage numeric/.test(sql));
  ok(/add column if not exists mtf_rate\s+numeric/.test(sql));
  ok(/alter table public\.profiles\s+add column if not exists mtf_rate numeric/.test(sql));
  ok(/mtf_leverage is null or mtf_leverage > 1/.test(sql), "1× borrows nothing, as isMtf says");
});
