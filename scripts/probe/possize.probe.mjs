import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { DIMENSIONS, dimensionRows, labelOf, NOT_RECORDED } from "@/lib/edge";
import { setActiveRegion } from "@/lib/format";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

const book = (sizes) => sizes.map((exposure, i) => ({ exposure, r: i % 3 - 1, pnl: exposure * 0.01 }));

/**
 * HOW BIG WAS THE BET, banded on round money.
 *
 * The bands are chosen FROM THE DATA but only ever land on round numbers: a
 * book of ₹2–13L positions gets three-lakh steps, a book twice the size gets
 * five. Quantiles would divide the book into equal groups and call the cuts
 * categories — "₹4.7L – ₹7.1L" is arithmetic about the book, not a size
 * anybody thinks in.
 */
test("position size bands on round money, scaled to the book", () => {
  setActiveRegion("IN");
  /* One in every band: a band with no trades in it is not rendered, which is
     how every continuous dimension here behaves. */
  const small = dimensionRows(book([180000, 250000, 400000, 900000, 1000000, 1350000]), "size", {});
  eq(small[0].key, "under ₹3L", "a book of a few lakh should band in threes");
  eq(small.map((r) => r.key).join(" · "),
     "under ₹3L · ₹3L – ₹6L · ₹6L – ₹9L · ₹9L – ₹12L · ₹12L – ₹15L");

  const big = dimensionRows(book([400000, 1200000, 1800000, 2400000]), "size", {});
  eq(big[0].key, "under ₹5L", "a larger book must step wider, still round");
  for (const r of [...small, ...big]) {
    ok(!/\d\.\d\d/.test(r.key), `"${r.key}" is a cut point, not a round band`);
  }
});

test("every trade lands in exactly one band, including the largest", () => {
  setActiveRegion("IN");
  const sizes = [50000, 300000, 300001, 899999, 2000000];
  const rows = dimensionRows(book(sizes), "size", {});
  eq(rows.reduce((a, r) => a + r.n, 0), sizes.length, "a trade fell between two bands");
  ok(!rows.some((r) => r.key === NOT_RECORDED), "a real position size is never 'not recorded'");
});

/**
 * The edges are money, so they are the OPEN BOOK's money. This printed ₹ over
 * a US book's dollars, which is the one mistake about a figure that nothing on
 * the screen can show you.
 */
test("band edges are the book's own currency", () => {
  setActiveRegion("US");
  const rows = dimensionRows(book([2000, 4500, 8000, 12000, 30000]), "size", {});
  for (const r of rows) {
    ok(!r.key.includes("₹"), `a US book printed a rupee band: "${r.key}"`);
    ok(/\$/.test(r.key), `a US book band has no currency at all: "${r.key}"`);
  }
  setActiveRegion("IN");
  ok(dimensionRows(book([300000, 900000]), "size", {})[0].key.includes("₹"), "and India keeps rupees");
});

/** Same reason: "Risk in rupees" is a lie in a dollar journal. */
test("a dimension may name itself from the open book", () => {
  const d = DIMENSIONS.find((x) => x.id === "riskamt");
  setActiveRegion("IN");
  eq(labelOf(d), "Risk in rupees");
  setActiveRegion("US");
  eq(labelOf(d), "Risk in dollars");
  eq(labelOf(DIMENSIONS.find((x) => x.id === "size")), "Position size", "a plain label still resolves");
  setActiveRegion("IN");
});

/**
 * A label that may be a function has to be resolved everywhere it is printed.
 * Rendered raw, React prints nothing for it — a tab with no name.
 */
test("every place that prints a dimension's name resolves it", () => {
  const src = read("components/journal/Edge.jsx");
  ok(!/\{[Dd]\.label\}/.test(src), "Edge.jsx prints a raw label, which may be a function");
  ok(/labelOf\(D\)/.test(src) && /labelOf\(d\)/.test(src), "both the tab and the header must resolve it");
  ok(/label: labelOf\(d\)/.test(read("lib/edge.js")), "the trades banner prints a raw label");
});
