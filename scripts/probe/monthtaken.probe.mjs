import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { DIMENSIONS, dimensionRows, matchesEdgeFilter, edgeFilterFor, labelOf } from "@/lib/edge";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/*
 * MONTH TAKEN groups by the day the trade was opened; MONTH CLOSED by the day
 * it was finished. A trade bought in August and sold in September is the case
 * that tells them apart — it must sit in August on one and September on the
 * other, and nowhere else on either.
 */
const BOOK = [
  { id: "a", entry_date: "2026-08-04", exit_date: "2026-09-10", r: 2, pnl: 2000 },
  { id: "b", entry_date: "2026-08-20", exit_date: "2026-08-28", r: -1, pnl: -1000 },
  { id: "c", entry_date: "2026-09-02", exit_date: "2026-09-15", r: 1, pnl: 1000 },
];
const keys = (rows) => Object.fromEntries(rows.map((r) => [r.key, r.trades]));

test("month taken groups by entry, month closed by exit", () => {
  eq(JSON.stringify(keys(dimensionRows(BOOK, "month_taken"))),
     JSON.stringify({ "2026-08": 2, "2026-09": 1 }), "by entry: two in August, one in September");
  const closed = keys(dimensionRows(BOOK, "month"));
  eq(closed["2026-08"], 1, "by exit: only b closed in August");
  eq(closed["2026-09"], 2, "by exit: a and c closed in September");
});

test("each row's figures describe that row's own trades", () => {
  const aug = dimensionRows(BOOK, "month_taken").find((r) => r.key === "2026-08");
  eq(aug.totalR, 1, "a (+2R) and b (−1R) were both taken in August");
  eq(aug.netPnl, 1000);
});

test("a row's link reaches exactly the trades it counted", () => {
  for (const row of dimensionRows(BOOK, "month_taken")) {
    const f = edgeFilterFor("month_taken", row);
    eq(BOOK.filter((t) => matchesEdgeFilter(t, f)).length, row.trades, `link for ${row.key}`);
  }
});

test("the two are named apart, and the old link id still means closed", () => {
  const m = DIMENSIONS.find((d) => d.id === "month");
  eq(labelOf(m), "Month closed");
  eq(labelOf(DIMENSIONS.find((d) => d.id === "month_taken")), "Month taken");
});

test("the table says recent months read worse until their winners close", () => {
  /* Not merely "thin": losers stop out first and winners stay open, so a
     recent month reads WORSE than it will end. The caveat must say which way. */
  ok(/losers close first/i.test(DIMENSIONS.find((d) => d.id === "month_taken").hint || ""),
     "month taken says recent months are biased towards losers");
  ok(/\{D\.hint && <div className="hint"[^>]*>\{D\.hint\}<\/div>\}/.test(read("components/journal/Edge.jsx")),
     "Edge renders the dimension's hint under the table");
});
