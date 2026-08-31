import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, eq, ok } from "./harness.mjs";
import { hasRealStop, needsStop, noStopOnRecord, STOP_NONE } from "@/lib/stops";
import { reviewFindings } from "@/lib/analysis";
import { tradePath } from "@/lib/path";
import { needsMeasuring } from "@/lib/measure";
import { derivePosition } from "@/lib/positions";

const T = (o = {}) => ({ stop_loss: 90, stop_source: "recorded", ...o });

test("the three states mean three different things", () => {
  eq(hasRealStop(T()), true);
  /* stop_loss is nullable — 006 dropped the NOT NULL that schema.sql still
     shows — and an import with no stop writes null to BOTH columns. A null
     source is neither assumed nor none, so those rows passed a test called
     "has a real stop" while having no stop at all. */
  eq(hasRealStop(T({ stop_loss: null, stop_source: null })), false,
     "no stop at all is not a trustworthy stop");
  eq(hasRealStop(T({ stop_loss: null })), false);
  eq(needsStop(T({ stop_loss: null, stop_source: null })), true,
     "and it stays in the queue, because it is still owed an answer");
  eq(hasRealStop(T({ stop_source: "assumed" })), false, "a number the importer invented");
  eq(hasRealStop(T({ stop_source: STOP_NONE })), false, "no denominator at all");

  /* The distinction the whole feature rests on: assumed is a to-do, none is
     an answer. Counting none as outstanding is what made the queue
     impossible to empty. */
  eq(needsStop(T({ stop_source: "assumed" })), true, "still owed an answer");
  eq(needsStop(T({ stop_source: STOP_NONE })), false, "settled — must leave the queue");
  eq(needsStop(T({ stop_loss: null })), true);
  eq(noStopOnRecord(T({ stop_source: STOP_NONE })), true);
});

test("one rule, not nine copies of it", () => {
  /**
   * Nine files each wrote `stop_source !== "assumed"` to mean "this 1R can be
   * trusted". Nine copies is nine places to miss when the rule gains a case —
   * and it just did. Two definitions of "risk free" already cost a broken
   * build here; nine of "measurable" would have shipped silently, with part
   * of the app counting trades the rest had excluded.
   */
  const ROOT = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(js|jsx)$/.test(e.name)) continue;
      if (full.endsWith(path.join("lib", "stops.js"))) continue;
      const body = readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      /* Comparing stop_source to "assumed" for an R decision. Display code
         that labels the badge is fine and reads `=== "assumed"`; what must
         not come back is the NEGATED form, which is the R test. */
      if (/stop_source\s*!==\s*["']assumed["']/.test(body)) {
        offenders.push(path.relative(ROOT, full));
      }
    }
  };
  walk(ROOT);
  eq(offenders.length, 0,
     `these re-implement hasRealStop instead of importing it: ${offenders.join(", ")}`);
});

test("no stop on record drops out of R and stays in the money", () => {
  const mk = (i, o = {}) => ({
    id: `n${i}`, symbol: `S${i}`, status: "closed", exchange: "NSE",
    entry_date: "2026-01-05", exit_date: "2026-02-20", quantity: 100,
    entry_price: 100, exit_price: 120, stop_loss: 90, stop_source: "recorded",
    exit_reason: "Target hit", mistakes: [], exits: [], charges: 320,
    riskPct: 1, riskAmt: 10000, r: 2, pnl: 20000, heldDays: 30, ...o,
  });
  const withStops = Array.from({ length: 30 }, (_, i) => mk(i));
  const noStops = Array.from({ length: 30 }, (_, i) => mk(100 + i, { stop_source: STOP_NONE }));

  const run = (rows) => {
    const out = reviewFindings(rows, { all: rows, diary: [] });
    return Array.isArray(out) ? out : (out.findings || out.items || []);
  };
  const before = run(withStops).find((f) => f.id === "stop-discipline" || f.id === "risk-consistent");
  const after = run([...withStops, ...noStops])
    .find((f) => f.id === "stop-discipline" || f.id === "risk-consistent");
  /* Adding thirty stopless trades must not change what the R findings say —
     they are not part of that arithmetic. */
  eq(after?.id, before?.id, "an R finding must not change because stopless trades arrived");
});

test("a stopless trade has no path to measure", () => {
  const bars = Array.from({ length: 10 }, (_, i) => ({
    d: `2026-01-${String(i + 5).padStart(2, "0")}`, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i,
  }));
  const t = {
    entry_price: 100, stop_loss: 90, side: "long", entry_date: "2026-01-05",
    exit_date: "2026-01-14", r: 1,
  };
  ok(tradePath({ ...t, stop_source: "recorded" }, bars), "a real stop measures");
  eq(tradePath({ ...t, stop_source: STOP_NONE }, bars), null, "no 1R, no path");
  eq(needsMeasuring([{
    ...t, id: "x", symbol: "ACME", exchange: "NSE", status: "closed",
    path_to: null, stop_source: STOP_NONE,
  }]).length, 0, "and it is never queued for measurement");
});

test("no stop on record produces no R, no SL%, no risk", () => {
  /**
   * The column keeps the importer's leftover number, so this has to refuse it
   * at the point R is computed or every screen goes on quoting it.
   *
   * It shipped without that: the trades table showed "no stop" beside a stop
   * of 6928.17, a 7.0% SL and −0.27R on one row, and the footer kept
   * totalling R across 1185 trades that had just been declared unmeasurable.
   * The findings had already excluded them, so two screens disagreed about
   * the same trade.
   */
  const base = {
    entry_price: 7449.65, quantity: 115, stop_loss: 6928.17,
    side: "long", status: "closed", exit_price: 7313.50,
    exit_date: "2026-04-29", charges: 0, exits: [],
  };
  const assumed = derivePosition({ ...base, stop_source: "assumed" }, 1000000);
  const none = derivePosition({ ...base, stop_source: STOP_NONE }, 1000000);

  /* An assumed stop still computes — that is what the bulk fill is for, so
     the plots work while the real numbers are recovered. */
  ok(Number.isFinite(assumed.r), "an assumed stop still yields an R");
  ok(Number.isFinite(assumed.slPct), "and an SL%");

  eq(Number.isFinite(none.r), false, "no stop on record, no R");
  eq(Number.isFinite(none.slPct), false, "no stop on record, no SL%");
  eq(Number.isFinite(none.riskAmt), false, "and nothing at risk to report");
  /* Money is still knowable and must survive. */
  ok(Number.isFinite(none.pnl), "P&L does not depend on a stop");
});
