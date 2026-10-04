import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, eq, ok, near } from "./harness.mjs";
import { monthlyGrid } from "@/lib/dashboard";
import { byPeriod } from "@/lib/calc";
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
 * THE BUCKET, NOT THE TOTAL.
 *
 * This grid added a position's whole R to the month of `exit_date`, which is
 * its LAST tranche — so a position sold down over three months put all of it
 * in the third. On the book that found it, September 2025 read +23.7R here
 * against +12.0R on the period table for the same month, with June and July
 * correspondingly short. positions.js has said for a long while why that is
 * wrong: "the totals were never wrong, only the buckets, which is exactly the
 * kind of wrong that survives a reconciliation."
 */
test("a position sold across three months is counted in all three", () => {
  const g = monthlyGrid([SPREAD]);
  ok(g, "the grid came back empty");
  near(cell(g, 2025, 6).r, 1 / 3, 0.001, "June banked the first third");
  near(cell(g, 2025, 7).r, 2 / 3, 0.001, "July the second");
  near(cell(g, 2025, 9).r, 1, 0.001, "September the last");
  ok(!cell(g, 2025, 8).hasData, "August realised nothing and must stay blank");
});

/**
 * The grid and the period table are shown on the same book and must not
 * disagree about a month. They now walk the same bankedEvents.
 */
test("the grid agrees with the period table, month for month", () => {
  const g = monthlyGrid([SPREAD]);
  const periods = byPeriod([SPREAD], "month", { basis: "exit" });
  /* Matched on the totals rather than on label spelling, which the two
     formatters do differently. */
  const gridTotal = g.years.flatMap((y) => y.months).filter((m) => m.hasData)
    .reduce((a, m) => a + m.r, 0);
  const periodTotal = periods.reduce((a, p) => a + (p.totalR || 0), 0);
  near(gridTotal, periodTotal, 0.01, "the two tables disagree on the book's total R");
  near(gridTotal, 2, 0.01, "and the parts must add back to the position's own +2R");
});

test("a part-sold position's banked money reaches the grid", () => {
  /* It has no exit_date, so the old version dropped it entirely while the
     period table counted what it had banked. */
  const PART = mk({
    id: "part", symbol: "PART", side: "long", status: "partial",
    entry_date: "2026-06-01", entry_price: 100, quantity: 100,
    stop_loss: 90, stop_source: "recorded", charges: 0, last_price: 200,
    exits: [{ exit_date: "2026-09-10", quantity: 40, price: 150, charges: 0 }],
  });
  const g = monthlyGrid([PART]);
  ok(g, "a part-sold position alone produced no grid at all");
  ok(cell(g, 2026, 9)?.hasData, "September banked money and must have a cell");
  ok(cell(g, 2026, 9).r > 0, "and it was a gain");

  /* And the screen has to hand the part-sold ones over, or the grid never
     sees them however well it handles them. */
  const dash = readFileSync(path.resolve(fileURLToPath(
    new URL("../../src/components/journal/Dashboard.jsx", import.meta.url))), "utf8");
  ok(/<MonthlyReturns banking=\{banking\} \/>/.test(dash),
     "Dashboard passes `closed` again, so part-sold money is missing from the grid");
});

test("the month comes from the date string, not from a parsed Date", () => {
  /* `new Date("2025-06-10")` is UTC midnight and names 9 June west of
     Greenwich, which is what probe:tz exists to catch. */
  const src = readFileSync(path.resolve(fileURLToPath(new URL("../../src/lib/dashboard.js", import.meta.url))), "utf8");
  ok(/e\.date\.slice\(0, 7\)\.split\("-"\)/.test(src),
     "the grid parses its month with new Date again");
});

/**
 * The caption said "bucketed by exit date, so a trade lands in the month it
 * was closed", which described the behaviour this change removed. A stale
 * caption under corrected figures is worse than the bug was: the numbers
 * move and the page goes on explaining the old ones.
 */
test("the caption describes how the months are actually counted", () => {
  const src = readFileSync(path.resolve(fileURLToPath(
    new URL("../../src/components/journal/MonthlyReturns.jsx", import.meta.url))), "utf8");
  const flat = src.replace(/\s+/g, " ");
  ok(!/bucketed by exit date/.test(flat), "the caption still describes the old bucketing");
  ok(/Counted when the money was realised/.test(flat),
     "and it must say what it does now, in the period table's own words");
});
