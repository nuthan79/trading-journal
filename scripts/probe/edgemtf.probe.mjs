import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { dimensionRows, DIMENSIONS, matchesEdgeFilter } from "@/lib/edge";
import { derivePosition } from "@/lib/positions";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * DOES MARGIN PAY? "Bought on MTF" as a grouping on What works: the same
 * trades split by whether they were bought on margin.
 */
let id = 0;
const mk = (lev, exitPrice) => {
  const t = {
    id: `t${++id}`, symbol: `S${id}`, side: "long", status: "closed",
    entry_date: "2026-08-01", entry_price: 100, quantity: 100, stop_loss: 95,
    stop_source: "recorded", charges: 0, exit_date: "2026-08-11", exit_price: exitPrice,
    exits: [{ exit_date: "2026-08-11", quantity: 100, price: exitPrice, charges: 0 }],
    mtf_leverage: lev, mtf_rate: lev ? 40 : null,
  };
  return { ...t, ...derivePosition(t, 5e6), status: t.status, exits: t.exits };
};
const BOOK = [mk(2.5, 110), mk(2.5, 92), mk(2, 120), mk(null, 105), mk(null, 97)];

test("the trades split into On MTF and Own money", () => {
  const rows = dimensionRows(BOOK, "mtf", {});
  const by = Object.fromEntries(rows.map((r) => [r.key, r.n]));
  eq(by["On MTF"], 3);
  eq(by["Own money"], 2);
});

test("clicking a row lists exactly the trades it counted", () => {
  /* The Trades filter reuses the grouping's own get(), so the count on the
     row and the length of the list can never disagree. */
  for (const r of dimensionRows(BOOK, "mtf", {})) {
    eq(BOOK.filter((t) => matchesEdgeFilter(t, { dim: "mtf", key: r.key })).length, r.n, r.key);
  }
});

test("leverage of 1× is not margin", () => {
  const D = DIMENSIONS.find((d) => d.id === "mtf");
  eq(D.get({ mtf_leverage: 1 }), "Own money");
  eq(D.get({ mtf_leverage: "2.35" }), "On MTF");
});

test("the grouping appears only for someone with a closed MTF trade", () => {
  const D = DIMENSIONS.find((d) => d.id === "mtf");
  eq(D.showIf(BOOK), true);
  eq(D.showIf(BOOK.filter((t) => !t.mtf_leverage)), false);
});

test("What works shows only the groupings that apply, and uses the resolved one throughout", () => {
  const s = read("components/journal/Edge.jsx");
  ok(/DIMENSIONS\.filter\(\(d\) => !d\.showIf \|\| d\.showIf\(closed\)\)/.test(s));
  ok(/dimensionRows\(closed, D\.id,/.test(s) && /edgeHref\(D\.id, g\)/.test(s) && /data-on=\{D\.id === d\.id/.test(s),
    "table, links and the lit button all read D.id");
});

test("the note says whether the R compared is after or before MTF cost", () => {
  const s = read("components/journal/Edge.jsx");
  ok(/closed\.some\(\(t\) => t\.marginInPnl === false\)/.test(s));
  ok(/R here is after MTF cost/.test(s) && /R here is before MTF cost/.test(s));
});
