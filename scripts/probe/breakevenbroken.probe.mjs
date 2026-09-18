import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq, near } from "./harness.mjs";
import { derivePosition } from "@/lib/positions";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * A BREAKEVEN MARK THE PRICE HAS OVERRULED STOPS COUNTING.
 *
 * DATAPATTNS: 232 bought at ₹4,609.80, stop ₹4,456.60, 108 sold, 124 held.
 * The breakeven flag was clicked when it was up past 1.5R. The price is now
 * ₹4,513.30 — below entry. A stop really at entry would have sold the 124, so
 * the mark is wrong, and the dial and panel said "nil" risk anyway.
 */
const base = {
  symbol: "DATAPATTNS", side: "long", status: "partial", entry_date: "2026-09-03",
  entry_price: 4609.8, quantity: 232, stop_loss: 4456.6, stop_source: "recorded", charges: 0,
  exits: [{ exit_date: "2026-09-16", quantity: 108, price: 4360, charges: 0 }],
  breakeven_ack_at: "2026-09-10T09:30:00+00:00",
  last_price: 4513.3, last_price_at: "2026-09-18T10:00:00+00:00",
  day_low: 4415.6, day_high: 4530,
};
const d = (over) => derivePosition({ ...base, ...over }, 5e6);
const RISK_HELD = (4609.8 - 4456.6) * 124;          // ₹18,996.80

test("DATAPATTNS: price below entry — the mark stops counting", () => {
  const p = d({});
  eq(p.breakevenBroken, true);
  near(p.openRiskAmt, RISK_HELD, 0.01, "the 124 held can still lose this, down to the recorded stop");
  ok(p.netRiskR > 0, "and it is back on the dial");
});

test("above entry and never through it: the mark counts, as before", () => {
  const p = d({ last_price: 4700, day_low: 4650, day_high: 4720 });
  eq(p.breakevenBroken, false);
  eq(p.openRiskAmt, 0);
});

test("above entry now, but today's low went through it: overruled", () => {
  /* A stop at entry would have filled on that dip. */
  const p = d({ last_price: 4700, day_low: 4590 });
  eq(p.breakevenBroken, true);
  near(p.openRiskAmt, RISK_HELD, 0.01);
});

test("a price fetched before the mark was set is not evidence against it", () => {
  const p = d({ last_price: 4513.3, day_low: 4415.6, last_price_at: "2026-09-10T09:00:00+00:00" });
  eq(p.breakevenBroken, false, "the stop may have been moved after that price");
  eq(p.openRiskAmt, 0);
});

test("the same moment written two ways compares as the same moment", () => {
  const p = d({ last_price_at: "2026-09-10T09:30:00Z", breakeven_ack_at: "2026-09-10T09:30:00.000+00:00" });
  eq(p.breakevenBroken, true, "a fetch at the instant of the mark counts");
});

test("a short is mirrored: price above entry, or today's high above it", () => {
  const short = { side: "short", entry_price: 1000, stop_loss: 1050, quantity: 100, exits: [],
    status: "open", last_price: 1010, day_low: 990, day_high: 1015 };
  eq(d(short).breakevenBroken, true);
  eq(d({ ...short, last_price: 980, day_high: 995 }).breakevenBroken, false);
  eq(d({ ...short, last_price: 980, day_high: 1004 }).breakevenBroken, true, "the high went through");
});

test("no mark, nothing to overrule", () => {
  eq(d({ breakeven_ack_at: null }).breakevenBroken, false);
});

test("a fully sold position has nothing left to overrule", () => {
  eq(d({ status: "closed", exits: [{ exit_date: "2026-09-16", quantity: 232, price: 4360, charges: 0 }] })
    .breakevenBroken, false);
});

test("Holdings draws an overruled mark in the warning colour, with the reason", () => {
  const s = read("components/journal/Holdings.jsx");
  ok(/ps-flag done\$\{r\.breakevenBroken \? " broken" : ""\}/.test(s));
  ok(/a stop at entry would have sold it/.test(s));
});

test("the Holdings key explains the red hollow flag", () => {
  const s = read("components/journal/Holdings.jsx");
  const key = s.slice(s.indexOf('<div className="ps-key">'), s.indexOf("</div>", s.indexOf('<div className="ps-key">')));
  ok(/className="ps-flag done broken ps-key-mark"><Flag/.test(key), "drawn as it appears on the row");
  ok(/Counted in open risk again — check your stop/.test(key));
});
