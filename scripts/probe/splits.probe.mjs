import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq, near } from "./harness.mjs";
import { splitsDue, adjustForSplits, splitPlan, symbolsOf } from "@/lib/splits";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

/**
 * SPLITS, AND BONUS ISSUES, WHICH ARE THE SAME ARITHMETIC.
 *
 * The case below is real: NFLX bought through an order book on 13 October
 * 2025 at $1,219.69, split 10 for 1 on 17 November, and marked at $73.34 —
 * which the journal showed as a 94% loss with an R built on a stop ten times
 * too far away.
 */
const NFLX_SPLIT = [{ date: "2025-11-17", ratio: 10 }];

const held = (over = {}) => ({
  id: "t1", symbol: "NFLX", exchange: "NASDAQ", status: "open",
  entry_date: "2025-10-13", entry_price: 1219.69, quantity: 0.126704534,
  stop_loss: 1100, initial_stop_loss: 1100, pivot_price: 1250, exits: [], ...over,
});

test("a holding bought before a split is restated, both sides", () => {
  const a = adjustForSplits(held(), NFLX_SPLIT);
  eq(a.factor, 10);
  near(a.quantity, 1.2670, 1e-4, "ten times the shares");
  near(a.entry_price, 121.97, 0.01, "a tenth of the price");
  near(a.stop_loss, 110, 0.01, "and the stop, or R is measured against a stop ten times too far");
  near(a.initial_stop_loss, 110, 0.01, "including the pinned one, which 1R divides by");
  near(a.pivot_price, 125, 0.01);
  eq(a.split_adjusted_to, "2025-11-17");
});

test("a trade that opened and closed before the split is left alone", () => {
  /* Both its legs agree with each other. Adjusting would falsify what
     happened. */
  const done = held({ status: "closed",
    exits: [{ id: "e1", exit_date: "2025-11-01", quantity: 0.126704534, price: 1300 }] });
  eq(adjustForSplits(done, NFLX_SPLIT), null);
  eq(splitsDue(done, NFLX_SPLIT).length, 0);
});

test("a trade that spanned the split has each leg restated in its own terms", () => {
  const spanned = held({ status: "closed", quantity: 1,
    exits: [
      { id: "e1", exit_date: "2025-11-01", quantity: 0.4, price: 1200 },   // old shares
      { id: "e2", exit_date: "2025-12-01", quantity: 6, price: 120 },      // already new ones
    ] });
  const a = adjustForSplits(spanned, NFLX_SPLIT);
  near(a.exits[0].quantity, 4, 1e-9, "the sell before the split moves with the entry");
  near(a.exits[0].price, 120, 0.01);
  eq(a.exits[1].quantity, 6, "the sell after it was already in new shares");
  eq(a.exits[1].price, 120);
});

test("an adjustment is never applied twice", () => {
  /* Offered again on the next load, applying it twice turns 10:1 into 100:1
     — and the second time looks exactly as reasonable as the first. */
  const already = held({ split_adjusted_to: "2025-11-17", quantity: 1.267, entry_price: 121.97 });
  eq(adjustForSplits(already, NFLX_SPLIT), null);
  /* A LATER split still applies. */
  const twice = [...NFLX_SPLIT, { date: "2026-06-01", ratio: 2 }];
  const a = adjustForSplits(already, twice);
  eq(a.factor, 2);
  eq(a.split_adjusted_to, "2026-06-01");
});

test("two splits since the buy compound, oldest first", () => {
  const a = adjustForSplits(held(), [{ date: "2025-11-17", ratio: 10 }, { date: "2026-02-01", ratio: 2 }]);
  eq(a.factor, 20);
  near(a.entry_price, 60.98, 0.01);
});

test("a bonus is a split — 3:2 and 2:1 are ratios, not special cases", () => {
  /* India calls one a bonus and the source reports it as a split: NESTLEIND
     came back 10:1 and 2:1, TRENT 3:2. */
  const bonus = adjustForSplits(
    held({ symbol: "TRENT", exchange: "NSE", entry_price: 6000, quantity: 10, stop_loss: 5400 }),
    [{ date: "2026-06-04", ratio: 1.5 }]);
  near(bonus.quantity, 15, 1e-9);
  near(bonus.entry_price, 4000, 0.01);
  near(bonus.stop_loss, 3600, 0.01);
});

test("nothing is offered for a stock that never split", () => {
  eq(adjustForSplits(held(), []), null);
  eq(adjustForSplits(held(), [{ date: "2025-11-17", ratio: 1 }]), null, "a 1:1 is not an event");
  eq(splitPlan([held()], {}).length, 0);
});

test("the plan is keyed by symbol and venue, and skips the sample book", () => {
  const plan = splitPlan([held(), { ...held(), id: "demo-1" }], { "NFLX:NASDAQ": NFLX_SPLIT });
  eq(plan.length, 1);
  eq(plan[0].id, "t1");
  eq(symbolsOf([held()]).join(), "NFLX:NASDAQ");
});

test("dividends are deliberately not here", () => {
  const src = read("src/lib/splits.js");
  ok(/DIVIDENDS ARE NOT IN THIS FILE, ON PURPOSE/.test(src));
  ok(/no figure already in the journal\s*\n?\s*\* becomes wrong when one is paid/.test(src),
     "the reason is stated, not assumed");
});

test("the write marks the trade last, and the card asks first", () => {
  const db = read("src/lib/db.js");
  ok(/export async function applySplitAdjustments/.test(db));
  const marks = db.indexOf("split_adjusted_to: p.split_adjusted_to");
  const exits = db.indexOf("for (const e of p.exits || [])");
  ok(exits > 0 && marks > exits,
     "if the tranches fail the trade must not claim to have been adjusted");
  const h = read("src/components/journal/Holdings.jsx");
  ok(/window\.confirm\(/.test(h) && /Quantities go up and prices — including stops — come down/.test(h));
  ok(/becomes\{" "\}/.test(h), "and the card shows what each row would become");
});
