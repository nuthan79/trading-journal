import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { DIMENSIONS, isThin, thinAt } from "@/lib/edge";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");
const dim = (id) => DIMENSIONS.find((d) => d.id === id);

/*
 * A MONTH AT WEEKLY PACE IS FOUR TRADES; A SETUP KEEPS COLLECTING THEM. The
 * Month cuts fade below four, everything else below ten.
 */
test("the month cuts fade below four", () => {
  for (const id of ["month", "month_taken"]) {
    eq(thinAt(dim(id)), 4, id);
    ok(!isThin({ trades: 4 }, dim(id)), `${id}: a month of one trade a week is not thin`);
    ok(isThin({ trades: 3 }, dim(id)), `${id}: three trades is thin`);
  }
});

test("every other cut fades below ten", () => {
  for (const d of DIMENSIONS.filter((d) => !d.id.startsWith("month"))) {
    eq(thinAt(d), 10, d.id);
  }
  ok(isThin({ trades: 9 }, dim("pattern")), "nine trades in a pattern is thin");
  ok(!isThin({ trades: 10 }, dim("pattern")), "ten is not");
});

test("the table fades and explains with the open tab's own number", () => {
  const s = read("components/journal/Edge.jsx");
  ok(/opacity: isThin\(g, D\)/.test(s), "rows fade against the open dimension");
  ok(/groups\.some\(\(g\) => isThin\(g, D\)\)/.test(s), "the hint appears against the open dimension");
  ok(/Faded rows have fewer than \{thinAt\(D\)\} trades/.test(s),
     "the hint quotes the open tab's threshold rather than a typed number");
});
