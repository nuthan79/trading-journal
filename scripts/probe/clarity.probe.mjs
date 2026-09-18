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

/* 5 — After first run there was no next step at all. */
import { firstWeek, FIRST_WEEK_DAYS } from "@/lib/firstweek";

const NOW = new Date("2026-09-18T10:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

test("a brand-new journal shows the path with nothing ticked", () => {
  const fw = firstWeek({ onboardedAt: daysAgo(0), now: NOW });
  eq(fw.show, true);
  eq(fw.doneCount, 0);
});

test("zero trades missing a stop is not a finished stops step", () => {
  /* Out of zero trades, none lacks a stop. That is not the user having done
     step two, and ticking it would be the card lying on its first view. */
  const fw = firstWeek({ trades: 0, needStops: 0, assumedStops: 0, now: NOW, onboardedAt: daysAgo(1) });
  eq(fw.steps[1].done, false);
});

test("imported stops that were guessed keep step two open", () => {
  const fw = firstWeek({ trades: 40, needStops: 0, assumedStops: 12, onboardedAt: daysAgo(2), now: NOW });
  eq(fw.steps[0].done, true);
  eq(fw.steps[1].done, false, "an assumed stop is not the stop you used");
  eq(fw.steps[1].pending, 12);
});

test("it goes by itself once all three are done", () => {
  const fw = firstWeek({ trades: 3, diary: 1, onboardedAt: daysAgo(1), now: NOW });
  eq(fw.show, false);
});

/* THE NAG TEST. Somebody six months in who never wrote a diary entry is not
   in their first week, and a card reminding them every visit is exactly the
   thing this was told never to become. */
test("it does not follow an established user around", () => {
  const fw = firstWeek({ trades: 120, diary: 0, onboardedAt: daysAgo(180), now: NOW });
  eq(fw.show, false);
  eq(firstWeek({ trades: 5, onboardedAt: daysAgo(FIRST_WEEK_DAYS + 1), now: NOW }).show, false);
  eq(firstWeek({ trades: 5, onboardedAt: daysAgo(FIRST_WEEK_DAYS - 1), now: NOW }).show, true);
});

test("an empty journal still gets the path however old the account", () => {
  /* Signed up in spring, never logged anything, came back today. The path is
     exactly what they need, and age alone must not hide it. */
  eq(firstWeek({ trades: 0, onboardedAt: daysAgo(200), now: NOW }).show, true);
});

test("the card counts the user's own diary, never the sample book's", () => {
  const page = read("app/(app)/dashboard/page.jsx");
  ok(/diary: ownDiaryCount/.test(page), "the sample diary would tick step three for them");
  ok(/trades: trades\.length/.test(page), "`trades` is the real table; `all` would include the sample");
});

/* The Dashboard charts were labelled with what they are, not what to look for. */
test("every Dashboard chart leads with a reading and keeps its old name beside it", () => {
  const charts = {
    "components/journal/LedgerPlot.jsx": "Cumulative R",
    "components/journal/MonthlyReturns.jsx": "Monthly returns in R",
    "components/journal/ProfitConcentration.jsx": "Profit concentration",
    "components/journal/Distribution.jsx": "R distribution",
  };
  for (const [file, term] of Object.entries(charts)) {
    const src = read(file);
    const heads = [...src.matchAll(/className="eyebrow[^"]*">([\s\S]*?)<\/(?:div|span)>\s*(?:\n|<)/g)]
      .map((m) => m[1]).filter((h) => h.includes(term));
    ok(heads.length > 0, `${file} still names ${term} somewhere a user can find it`);
    for (const h of heads) {
      ok(/<span className="term">/.test(h),
        `${file}: "${term}" must sit in the quiet .term slot, after a plain heading`);
      ok(/^\s*[A-Z][a-z]/.test(h), `${file}: the heading must open with words, not the term`);
    }
  }
});

test("the running-total chart says how to read it", () => {
  ok(/The line is your total in R after each closed trade/.test(read("components/journal/LedgerPlot.jsx")));
});
