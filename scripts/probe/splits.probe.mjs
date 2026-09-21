import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq, near } from "./harness.mjs";
import { splitsDue, adjustForSplits, splitPlan, symbolsOf,
         verifySplitPlan, priceKeysFor } from "@/lib/splits";
import { staleKeys, mergeIntoCache, TTL_HELD, TTL_CLOSED } from "@/lib/splitCache";

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

/**
 * THE CHECK MUST NOT COST THE PAGE ANYTHING.
 *
 * A book of 297 listings is 297 upstream lookups at ~370ms, six at a time —
 * about eighteen seconds of somebody's quota for an answer that changes a
 * few times a year. It never blocked the table, but repeating it on every
 * visit to Holdings is waste, and waste is what makes an app feel slow.
 */
test("an answer is remembered per symbol, including the empty one", () => {
  const now = 1_700_000_000_000;
  const cache = mergeIntoCache({}, ["NFLX:NASDAQ", "WFC:NYSE"],
                               { "NFLX:NASDAQ": [{ date: "2025-11-17", ratio: 10 }] }, now);
  eq(cache["NFLX:NASDAQ"].splits.length, 1);
  eq(cache["WFC:NYSE"].splits.length, 0, "a stock that never split is the common case");
  eq(staleKeys(["NFLX:NASDAQ", "WFC:NYSE"], [], cache, now + 1000).length, 0,
     "and knowing that must cost nothing to know twice");
});

test("a held stock is asked about daily, a closed one weekly", () => {
  const now = 1_700_000_000_000;
  const cache = mergeIntoCache({}, ["A:NSE", "B:NSE"], {}, now);
  const twoDays = now + 2 * 24 * 60 * 60 * 1000;
  eq(staleKeys(["A:NSE", "B:NSE"], ["A:NSE"], cache, twoDays).join(), "A:NSE",
     "the one on screen is re-checked; the one in history waits");
  const eightDays = now + 8 * 24 * 60 * 60 * 1000;
  eq(staleKeys(["A:NSE", "B:NSE"], ["A:NSE"], cache, eightDays).join(), "A:NSE,B:NSE");
  eq(TTL_HELD < TTL_CLOSED, true);
});

test("an entry with no timestamp is unknown, not fresh", () => {
  eq(staleKeys(["A:NSE"], [], { "A:NSE": { splits: [] } }).join(), "A:NSE");
  eq(staleKeys(["A:NSE"], [], {}).join(), "A:NSE");
});

test("the page shows what it knows first, and asks in idle time", () => {
  const page = read("src/app/(app)/holdings/page.jsx");
  ok(/setSplits\(splitsFromCache\(keys, cache\)\);/.test(page),
     "a book checked yesterday draws its card without waiting for anything");
  ok(/const ask = staleKeys\(keys, keys, cache\);/.test(page));
  ok(/if \(!ask\.length\) return;/.test(page), "nothing stale, nothing asked");
  ok(/requestIdleCallback\(run, \{ timeout: 4000 \}\)/.test(page),
     "and never in competition with the marks somebody is actually waiting for");
});

test("the same question is the same URL, or no cache can hit", () => {
  const db = read("src/lib/db.js");
  ok(/const asked = \[\.\.\.keys\]\.sort\(\);/.test(db),
     "unsorted, the six-hour browser cache missed on every reload");
  const q = read("src/lib/quotes.js");
  ok(/const splitCache = new Map\(\);/.test(q) && /SPLIT_TTL_MS/.test(q),
     "and the server remembers too, so two people holding one stock pay once");
});

/**
 * THE CHECK THAT STOPS A FIX BECOMING A CORRUPTION.
 *
 * Applying an adjustment twice multiplies the quantity and divides the price
 * by the same number — so the P&L is IDENTICAL and the position is nonsense:
 *
 *   bought 1 at 1200, sold 10 at 130   →  P&L +100
 *   adjusted once:  10 at 120          →  P&L +100   right
 *   adjusted twice: 100 at 12          →  P&L +100   nonsense
 *
 * The one figure anybody would check it with cannot tell. `split_adjusted_to`
 * stops the app doing it twice; it cannot know a broker's file arrived
 * already adjusted, and Stockal's own notes say theirs sometimes is. So the
 * price on the day the position was bought is the proof.
 */
const NFLX_CAND = {
  id: "t1", symbol: "NFLX", exchange: "NASDAQ", entryDate: "2025-10-13",
  factor: 10, splits: [{ date: "2025-11-17", ratio: 10 }],
  quantity: 1.267, entry_price: 121.97,
  was: { quantity: 0.126704534, entry_price: 1219.69 },
};

test("a row in old money is confirmed by the price on the day", () => {
  /* Measured: NFLX closed at 121.90 on 13 October 2025 — ten times apart
     from the 1219.69 the order book recorded. */
  const [p] = verifySplitPlan([NFLX_CAND], { "NFLX:NASDAQ": 121.903 });
  eq(p.verdict, "pre-split");
  ok(/which is the split/.test(p.why));
});

test("a file a broker already adjusted is refused, not 'fixed'", () => {
  const already = { ...NFLX_CAND, was: { quantity: 1.267, entry_price: 121.97 } };
  const [p] = verifySplitPlan([already], { "NFLX:NASDAQ": 121.903 });
  eq(p.verdict, "already-adjusted");
  ok(/adjusted before you imported it/.test(p.why));
});

test("no price, or a price that explains neither, is left alone", () => {
  eq(verifySplitPlan([NFLX_CAND], {})[0].verdict, "unknown");
  eq(verifySplitPlan([NFLX_CAND], { "NFLX:NASDAQ": 400 })[0].verdict, "unknown",
     "an unprovable fix is the one thing worse than no fix");
});

test("only what the market confirms is offered", () => {
  const page = read("src/app/(app)/holdings/page.jsx");
  ok(/checked\.filter\(\(p\) => p\.verdict === "pre-split"\)/.test(page));
  ok(/checked\.filter\(\(p\) => p\.verdict !== "pre-split"\)/.test(page),
     "and the rest is reported rather than hidden");
  const h = read("src/components/journal/Holdings.jsx");
  ok(/\{onFixSplits && splitPlanRows\.length > 0 && \(/.test(h),
     "no button when there is nothing proven to press it for");
  ok(/left alone —/.test(h), "and the card says so, in one line");
});

test("the proof rides on the row, so it can be read before the click", () => {
  const [p] = verifySplitPlan([NFLX_CAND], { "NFLX:NASDAQ": 121.903 });
  ok(/1219\.69/.test(p.why) && /121\.90/.test(p.why),
     "both numbers, so somebody can check it against their broker");
  eq(p.close, 121.903);
});

/**
 * SPLITS ARE ABOUT WHAT YOU HOLD.
 *
 * A sold position's figures are settled: a split cannot make banked money
 * more or less, and checking the rest of the book was 292 symbols against 10
 * for rows nobody is reading. Simpler, and the simplicity is the point —
 * every extra thing this checks is another thing that can be wrong.
 */
test("only open positions are checked, and only their symbols asked about", () => {
  const page = read("src/app/(app)/holdings/page.jsx");
  ok(/const keys = symbolsOf\(open\);/.test(page), "the question is what you hold");
  ok(/splitPlan\(open, splits\)/.test(page), "and so is the plan");
  ok(!/symbolsOf\(all\)/.test(page), "the whole book is never swept");
  ok(!/sweepClosed/.test(page), "and there is no button offering to");
  const h = read("src/components/journal/Holdings.jsx");
  ok(!/Also check the stocks you no longer hold/.test(h));
});

test("what the price could not confirm is one line, not a list", () => {
  const h = read("src/components/journal/Holdings.jsx");
  ok(/\{splitsUnsure\.length\} other/.test(h), "said once, so the count still adds up");
  ok(/nothing is offered/.test(h));
});
