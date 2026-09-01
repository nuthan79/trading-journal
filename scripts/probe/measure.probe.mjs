import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, eq, ok } from "./harness.mjs";
import { needsMeasuring, measureTo, measurePaths } from "@/lib/measure";

const DAY = 86400000;
const d = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
/* stop_loss included, because a trade recording a stop has one. Leaving it
   out described a trade that cannot exist, and the looser predicate let it
   pass — three cases here were green on a fixture that was wrong. */
const T = (o) => ({
  symbol: "ACME", exchange: "NSE", stop_loss: 90, stop_source: "recorded",
  status: "closed", entry_date: d(-60), exit_date: d(-10), ...o,
});

/* ---- who gets measured ------------------------------------------------- */

const eligible = (t, opts) => needsMeasuring([t], opts).length === 1;

test("a closed trade measured only up to when it was OPEN is not finished", () => {
  /* `path_to` being PRESENT is not the same as complete. A position measured
     while open keeps that date; without this it reads as done forever and
     carries figures describing only the part before it closed. */
  ok(eligible(T({ path_to: d(-40) })), "must be re-read to reach its exit");
  ok(!eligible(T({ path_to: d(-10) })), "measured to the exit is done");
});

test("a missing final bar cannot cause a re-read loop", () => {
  ok(!eligible(T({ path_to: d(-12) })), "three days of tolerance on a halt or suspension");
});

test("BSE measures; a bare scrip code does not", () => {
  ok(eligible(T({ path_to: null, exchange: "BSE" })), "20MICRONS.BO is a real ticker");
  ok(!eligible(T({ path_to: null, exchange: "BSE", symbol: "533022" })),
     "533022.BO is a different company");
  ok(!eligible(T({ path_to: null, symbol: "500325" })), "digits only, whatever the exchange");
});

test("an assumed stop is skipped, and so is a same-day trade", () => {
  ok(!eligible(T({ path_to: null, stop_source: "assumed" })));
  ok(!eligible(T({ path_to: null, entry_date: d(-10) })));
});

test("open positions are weekly, and only when asked for", () => {
  const open = (path_to) => T({ status: "open", exit_date: null, path_to });
  ok(!eligible(open(null)), "closed-only by default");
  ok(eligible(open(null), { includeOpen: true }));
  ok(!eligible(open(d(-2)), { includeOpen: true }), "measured two days ago is fresh enough");
  ok(eligible(open(d(-9)), { includeOpen: true }), "nine days is stale");
  eq(measureTo(open(null)), d(0), "an open position runs to today");
});

/* ---- the wire, which is where it actually broke ------------------------ */

const closedTrade = (i) => ({
  id: `t${i}`, symbol: `SYM${i}`, exchange: "NSE", status: "closed",
  entry_date: "2026-03-01", exit_date: "2026-03-20", path_to: null,
  entry_price: 102, stop_loss: 92, side: "long", stop_source: "recorded", r: 1,
});
const someBars = () => Array.from({ length: 20 }, (_, i) => ({
  d: `2026-03-${String(i + 1).padStart(2, "0")}`, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i,
}));

test("the response is parsed, not used as the body", () => {
  /* apiFetch hands back a Response. Treating it as the payload made
     `payload.bars` undefined on every call, so 112 trades came back
     unreadable with no error because nothing threw. */
  globalThis.fetch = async (url, init) => {
    const want = JSON.parse(init.body).want;
    const bars = {};
    for (const w of want) bars[`${w.symbol}:${w.exchange}`] = someBars();
    return { ok: true, status: 200, json: async () => ({ bars, skipped: [], error: null }) };
  };
  return measurePaths([closedTrade(1)]).then((r) => {
    eq(r.measured, 1);
    eq(r.stopped, null);
  });
});

test("a refusal reaches the reader in the server's own words", () => {
  globalThis.fetch = async () => ({
    ok: false, status: 503,
    json: async () => ({ bars: {}, error: "History is not configured on this deployment." }),
  });
  return measurePaths([closedTrade(2)]).then((r) => {
    eq(r.measured, 0);
    eq(r.stopped, "History is not configured on this deployment.");
  });
});

test("a wholly throttled batch stops instead of deepening the block", async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    const want = JSON.parse(init.body).want;
    return {
      ok: true, status: 200,
      json: async () => ({
        bars: {}, error: null,
        skipped: want.map((w) => ({ key: `${w.symbol}:${w.exchange}`, why: "HTTP 429" })),
      }),
    };
  };
  const r = await measurePaths(Array.from({ length: 30 }, (_, i) => closedTrade(100 + i)));
  eq(calls, 1, "carrying on through the rest only makes the next attempt worse");
  ok(/rate-limiting/.test(r.stopped || ""), "and it says what to do about it");
});

test("one symbol refused among many that worked carries on", async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    const want = JSON.parse(init.body).want;
    const bars = {};
    for (const w of want.slice(1)) bars[`${w.symbol}:${w.exchange}`] = someBars();
    return {
      ok: true, status: 200,
      json: async () => ({ bars, skipped: [{ key: "x", why: "HTTP 429" }], error: null }),
    };
  };
  const r = await measurePaths(Array.from({ length: 30 }, (_, i) => closedTrade(200 + i)));
  eq(calls, 3, "three batches of twelve");
  eq(r.stopped, null);
  eq(r.measured, 27);
});

/* ------------------------------------------------------------------ */

test("a failure names the symbol it failed on", () => {
  /* A pass that could not read one trade reported "1 could not be read — 1
     HTTP 404" and left the reader guessing which of a hundred and twenty
     trades it meant. The reason without the symbol is unactionable: a 404 is
     almost always a renamed or delisted ticker and the fix is to correct that
     ONE symbol, which you cannot do until you know it.

     Static, because the aggregation sits inside measurePaths and reaching it
     needs the whole API round trip stubbed. The two halves that have to agree
     are the shape produced and the shape read. */
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const m = readFileSync(path.join(root, "src/lib/measure.js"), "utf8");
  const rv = readFileSync(path.join(root, "src/components/journal/Review.jsx"), "utf8");

  ok(/reasons\.get\(s\.why\)\.add\(/.test(m),
     "measure.js is not keeping WHICH listing failed, only how many");
  ok(/s\.key/.test(m), "the skipped key is never read, so the symbol is lost");
  ok(/symbols:\s*\[\.\.\.syms\]/.test(m),
     "the symbols are collected but not returned to the caller");

  ok(/r\.symbols/.test(rv),
     "Review is back to printing a bare count instead of the symbol");
  /* And the old shape must not come back: `${r.n} ${r.why}` was the line that
     produced "1 HTTP 404". */
  ok(!/\$\{r\.n\}\s+\$\{r\.why\}/.test(rv),
     "the count-only message is back in Review");
});
