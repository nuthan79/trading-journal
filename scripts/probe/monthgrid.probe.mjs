import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, eq, ok, near } from "./harness.mjs";
import { monthlyGrid } from "@/lib/dashboard";
import { dimensionRows } from "@/lib/edge";
import { derivePosition } from "@/lib/positions";

const mk = (t) => {
  const d = derivePosition(t, 5e6);
  return { ...t, ...d, status: t.status, exits: t.exits };
};

/* Bought 300 at 100 with the stop at 90, so one R is the whole 3,000 put at
   risk. Sold a third in each of June, July and September, for 1,000, 2,000
   and 3,000 — 0.33R, 0.67R and 1.00R of the position's own risk, summing to
   the +2R the finished position is worth. Each tranche divides by the
   POSITION's risk, not by its own slice of it, which is what makes the parts
   add back to the whole. */
const SPREAD = mk({
  id: "spread", symbol: "SPREAD", side: "long", status: "closed",
  entry_date: "2025-06-01", entry_price: 100, quantity: 300,
  stop_loss: 90, stop_source: "recorded", charges: 0,
  exit_date: "2025-09-20", exit_price: 130,
  exits: [
    { exit_date: "2025-06-10", quantity: 100, price: 110, charges: 0 },
    { exit_date: "2025-07-15", quantity: 100, price: 120, charges: 0 },
    { exit_date: "2025-09-20", quantity: 100, price: 130, charges: 0 },
  ],
});

const cell = (g, year, month) =>
  g.years.find((y) => y.year === year)?.months.find((m) => m.month === month - 1);

/**
 * A TRADE LANDS WHOLE IN THE MONTH IT WAS FULLY CLOSED — the user's own way of
 * counting, chosen after a day of the per-sell version. A position sold over
 * June, July and September is one +2R result, finished in September.
 */
test("a position sold across three months lands whole in the month of its last sell", () => {
  const g = monthlyGrid([SPREAD]);
  ok(g, "the grid came back empty");
  near(cell(g, 2025, 9).r, 2, 0.001, "September carries the whole +2R");
  eq(cell(g, 2025, 9).trades, 1);
  for (const m of [6, 7, 8]) ok(!cell(g, 2025, m).hasData, `month ${m} must stay blank`);
});

/**
 * Month closed on What works buckets the same way, so the two screens that
 * call a trade's month "the month it closed" cannot disagree about one.
 */
test("the grid agrees with What works → Month closed", () => {
  const OTHER = mk({
    id: "other", symbol: "OTHER", side: "long", status: "closed",
    entry_date: "2025-08-01", entry_price: 100, quantity: 100,
    stop_loss: 90, stop_source: "recorded", charges: 0,
    exit_date: "2025-08-20", exit_price: 95,
    exits: [{ exit_date: "2025-08-20", quantity: 100, price: 95, charges: 0 }],
  });
  const g = monthlyGrid([SPREAD, OTHER]);
  for (const row of dimensionRows([SPREAD, OTHER], "month")) {
    const [y, m] = row.key.split("-").map(Number);
    near(cell(g, y, m).r, row.totalR, 0.001, `${row.key}`);
    eq(cell(g, y, m).trades, row.trades, `${row.key} trade count`);
  }
});

test("the screen hands the grid closed trades", () => {
  const dash = readFileSync(path.resolve(fileURLToPath(
    new URL("../../src/components/journal/Dashboard.jsx", import.meta.url))), "utf8");
  ok(/<MonthlyReturns closed=\{closed\} \/>/.test(dash),
     "Dashboard must pass closed trades — a part-sold position has no result yet");
});

test("the month comes from the date string, not from a parsed Date", () => {
  /* `new Date("2025-06-10")` is UTC midnight and names 9 June west of
     Greenwich, which is what probe:tz exists to catch. */
  const src = readFileSync(path.resolve(fileURLToPath(new URL("../../src/lib/dashboard.js", import.meta.url))), "utf8");
  ok(/on\.slice\(0, 7\)\.split\("-"\)/.test(src),
     "the grid parses its month with new Date again");
});

test("the caption describes how the months are actually counted", () => {
  const src = readFileSync(path.resolve(fileURLToPath(
    new URL("../../src/components/journal/MonthlyReturns.jsx", import.meta.url))), "utf8");
  const flat = src.replace(/\s+/g, " ");
  ok(!/Counted when the money was realised/.test(flat), "the caption still describes per-sell counting");
  ok(/Each trade counts in the month it was fully closed/.test(flat),
     "and it must say what it does now");
});
