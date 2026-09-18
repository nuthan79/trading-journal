import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * A NEW USER HAS TO BE ABLE TO FIND THINGS WITHOUT BEING TOLD WHERE THEY ARE.
 *
 * Pinned from a review of the whole app, whose finding was that it explains
 * itself well inside each section and barely at all at the level where
 * someone decides where to go. Each test here is one of those gaps, closed.
 */

/* 1 — Import was reachable only from a button inside the settings sheet. */
test("Import is in the main navigation", () => {
  const src = read("app/(app)/layout.jsx");
  ok(/\{ id: "import", href: "\/import", label: "Import"/.test(src),
    "the fastest way to a full journal must not live behind Settings");
});

test("the sample-data banner points at Import", () => {
  /* The one thing every new user reads — the journal is sample data until
     their first trade. */
  const src = read("components/journal/DemoBanner.jsx");
  ok(/href="\/import"/.test(src));
});

test("an empty journal offers Import, and a filtered-out view does not claim to be empty", () => {
  const src = read("components/journal/Trades.jsx");
  const empty = src.slice(src.indexOf("rows.length === 0 ?"), src.indexOf('<table className="t">'));
  ok(/all\.length === 0/.test(empty), "must tell an empty journal from an empty filter");
  ok(/href="\/import"/.test(empty), "the empty journal offers the importer");
  ok(/No trades match/.test(empty), "and a filter with no matches says so, not 'nothing here yet'");
});

/* 2 — The explainers existed and nothing inside the app linked to them. */
test("the account menu links to the explainers", () => {
  ok(/href="\/learn"/.test(read("components/journal/AccountMenu.jsx")));
});

test("the first R on the first screen links to what R is", () => {
  const src = read("components/journal/Summary.jsx");
  ok(/href="\/learn\/what-is-an-r-multiple"/.test(src));
});

test("every in-app link to /learn points at a page that exists", () => {
  const files = ["components/journal/AccountMenu.jsx", "components/journal/Summary.jsx"];
  for (const f of files) {
    for (const [, slug] of read(f).matchAll(/href="\/learn(\/[^"]*)?"/g)) {
      const page = path.join(SRC, "app/learn", slug || "", "page.jsx");
      let exists = true;
      try { readFileSync(page); } catch { exists = false; }
      ok(exists, `${f} links to /learn${slug || ""}, which has no page`);
    }
  }
});

/* 3 — On Trades, 20 of 23 headers were bare abbreviations with no hover. */
import { COLUMN_HINTS } from "@/lib/columns";

const headerKeys = (file) => {
  const src = read(file);
  const thead = src.slice(src.indexOf("<thead"), src.indexOf("</tr></thead>"));
  return [...thead.matchAll(/\{th\("([^"]+)"/g)].map((m) => m[1]);
};

for (const [file, table] of [["components/journal/Trades.jsx", "Trades"],
                             ["components/journal/Holdings.jsx", "Holdings"]]) {
  test(`every ${table} column but the symbol explains itself on hover`, () => {
    const keys = headerKeys(file);
    ok(keys.length > 10, `found the ${table} header (${keys.length} columns)`);
    const bare = keys.filter((k) => k !== "symbol" && !COLUMN_HINTS[k]);
    eq(bare.length, 0, `${table} headers with no hover: ${bare.join(", ")}`);
  });

  test(`${table} headers fall back to the shared hints`, () => {
    ok(/title=\{title \?\? COLUMN_HINTS\[k\]\}/.test(read(file)),
      "the header helper must read the shared map, or the map is decoration");
  });
}

test("Change % on Holdings says it is since entry, not today", () => {
  /* The one header whose obvious reading is wrong. */
  ok(/not today/.test(COLUMN_HINTS.changePct));
});

/* 4 — The Analysis tabs were named in trader shorthand, worse than the pages. */
test("the Analysis tabs are named for what they answer", () => {
  const src = read("app/(app)/analysis/layout.jsx");
  const labels = [...src.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
  ok(labels.includes("What works"), "Edge becomes What works");
  ok(labels.includes("Process"), "Review becomes Process");
  ok(!labels.includes("Edge") && !labels.includes("What-if"), "the old names are gone");
});

test("renaming the tabs did not move the pages", () => {
  const src = read("app/(app)/analysis/layout.jsx");
  ok(/href: "\/analysis\/edge", label: "What works"/.test(src), "bookmarks to /analysis/edge still land");
  ok(/href: "\/analysis\/review", label: "Process"/.test(src), "and to /analysis/review");
});

test("nothing in the app still sends people to a tab by its old name", () => {
  /* What a user can read, so comments are stripped: a stale comment is a
     code-quality problem, a stale link label is a navigation one. */
  const visible = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const f of ["components/journal/Performance.jsx", "components/journal/Review.jsx",
                   "components/journal/Edge.jsx", "components/journal/WhatIf.jsx"]) {
    ok(!/Analysis → (Edge|Review|What-if)\b/.test(visible(f)), `${f} names an old tab`);
  }
});
