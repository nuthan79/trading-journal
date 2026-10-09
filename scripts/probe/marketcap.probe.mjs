import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { capOn, capHint, capRange, capRangeFor, CAP_ORDER, hasMarketCaps } from "@/lib/marketCap";
import { dimensionRows, DIMENSIONS, edgeFilterFor, matchesEdgeFilter, NOT_RECORDED } from "@/lib/edge";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const FILE = JSON.parse(read("public/mcap.json"));

/* A small book of lists, so the rules can be read off the fixture:
   three lists in force from Feb 2024, Aug 2024 and Feb 2025. */
const FLOORS = { large: 100119, mid: 33221, small: 11338 };
const DATA = {
  lists: [{ from: "2024-02-01", floors: { large: 80000, mid: 26000, small: 9000 } },
          { from: "2024-08-01", floors: { large: 91572, mid: 30756, small: 10299 } },
          { from: "2025-02-01", floors: FLOORS }],
  map: {
    GREW: "432",       // micro, then small, then mid
    NEWCO: "--1",      // listed after the second list was drawn
  },
};

/*
 * WINNERS GRADUATE. A trade is classified by the list in force the day it was
 * bought; reading it by today's list counts the small caps that did best as
 * mid-cap wins.
 */
test("a trade takes the list in force on its entry date", () => {
  eq(capOn(DATA, "GREW", "2024-03-15"), "Micro cap");
  eq(capOn(DATA, "GREW", "2024-08-01"), "Small cap", "a list takes effect on its first day");
  eq(capOn(DATA, "GREW", "2024-07-31"), "Micro cap", "and not a day before");
  eq(capOn(DATA, "GREW", "2026-01-10"), "Mid cap");
});

test("asked without a date, the latest list — which no screen does", () => {
  eq(capOn(DATA, "GREW"), "Mid cap");
});

test("a stock listed since the list in force takes the first list it appears in", () => {
  eq(capOn(DATA, "NEWCO", "2024-11-20"), "Large cap");
});

test("before the first list took effect, the first list", () => {
  eq(capOn(DATA, "GREW", "2023-05-01"), "Micro cap");
});

test("unknown symbols and missing data answer blank, never a guess", () => {
  eq(capOn(DATA, "NOSUCH", "2025-01-01"), "");
  eq(capOn(null, "GREW", "2025-01-01"), "");
});

/* The built file itself: every half-year since February 2018, in order, one
   character per list for every symbol. */
test("the built file carries every list, oldest first, one code per list", () => {
  ok(FILE.lists.length >= 18, `only ${FILE.lists.length} lists`);
  eq(FILE.lists[0].from, "2018-02-01");
  for (let i = 1; i < FILE.lists.length; i++) ok(FILE.lists[i].from > FILE.lists[i - 1].from, "out of order");
  const bad = Object.entries(FILE.map).filter(([, v]) => v.length !== FILE.lists.length || /[^1234-]/.test(v));
  eq(bad.length, 0, `malformed: ${bad.slice(0, 3).map(([k]) => k).join(", ")}`);
  eq(capOn(FILE, "RELIANCE", "2019-06-01"), "Large cap");
});

test("a rename keeps its history — ZOMATO and ETERNAL are one company", () => {
  eq(FILE.map.ZOMATO, FILE.map.ETERNAL);
  eq(capOn(FILE, "ETERNAL", "2023-03-01"), capOn(FILE, "ZOMATO", "2023-03-01"));
});

/* Each list splits exactly where SEBI does. */
test("every list has 100 large and 150 mid caps", () => {
  FILE.lists.forEach((l, i) => {
    const codes = Object.values(FILE.map).map((v) => v[i]);
    /* Symbols, not companies — a dual listing's BSE ticker can differ from
       its NSE one, so a company may be counted twice. At least, not exactly. */
    ok(codes.filter((c) => c === "1").length >= 100, `${l.from}: too few large caps`);
    ok(codes.filter((c) => c === "2").length >= 150, `${l.from}: too few mid caps`);
  });
});

test("What works reads the ladder in order, Not recorded last", () => {
  const book = [
    { mcap: "Micro cap", r: 1, pnl: 1 }, { mcap: "", r: 1, pnl: 1 },
    { mcap: "Large cap", r: -1, pnl: -1 }, { mcap: "Mid cap", r: 3, pnl: 3 },
  ];
  eq(dimensionRows(book, "mcap").map((r) => r.key).join(" · "),
     `Large cap · Mid cap · Micro cap · ${NOT_RECORDED}`);
  eq(CAP_ORDER.join(","), "Large cap,Mid cap,Small cap,Micro cap");
  const row = dimensionRows(book, "mcap").find((r) => r.key === "Mid cap");
  eq(book.filter((t) => matchesEdgeFilter(t, edgeFilterFor("mcap", row))).length, 1);
});

test("the tab is offered only to a book that has the classification", () => {
  const d = DIMENSIONS.find((x) => x.id === "mcap");
  ok(!d.showIf([{ mcap: "" }]), "a book with nothing classified gets no tab");
  ok(d.showIf([{ mcap: "Mid cap" }]));
  ok(hasMarketCaps("IN") && !hasMarketCaps("US"), "India only");
});

test("each screen asks for the right day", () => {
  ok(/mcap: capOf\(t\.symbol, t\.entry_date\)/.test(read("src/components/journal/Edge.jsx")),
     "What works classifies by the entry date");
  const trades = read("src/components/journal/Trades.jsx");
  ok(/capOf\(t\.symbol, t\.entry_date\) \|\| "—"/.test(trades), "the Trades cell, by the entry date");
  ok(/matchesEdgeFilter\(\{ \.\.\.t, \.\.\.sectorOf\(t\.symbol\), mcap: capOf\(t\.symbol, t\.entry_date\) \}, edge\)/.test(trades),
     "a row clicked on What works finds the same trades on Trades");
  ok(/const mcap = capOf\(t\.symbol, t\.entry_date\);/.test(read("src/components/journal/Holdings.jsx")),
     "Holdings too — the day of entry, everywhere");
});

/*
 * IN RUPEES, FROM THE LIST THAT PLACED IT. The line moves every six months —
 * the smallest large cap was ₹29,304 Cr in 2018 and ₹1,05,174 Cr in 2026 — so
 * a hover quoting today's range on a 2024 trade would explain a category the
 * trade was never in.
 */
test("each size reads as a rupee range", () => {
  eq(capRange("1", FLOORS), "₹1,00,119 Cr and above");
  eq(capRange("2", FLOORS), "₹33,221 Cr to ₹1,00,119 Cr");
  eq(capRange("3", FLOORS), "₹11,338 Cr to ₹33,221 Cr");
  eq(capRange("4", FLOORS), "below ₹11,338 Cr");
});

test("a trade's hover quotes the range of the list in force when it was bought", () => {
  eq(capHint(DATA, "GREW", "2024-09-10"), "Small cap: ₹10,299 Cr to ₹30,756 Cr, ranks 251–750.");
  eq(capHint(DATA, "GREW", "2024-03-01"), "Micro cap: below ₹9,000 Cr, rank 751 onwards.",
     "the earlier list's own line");
});

test("a new listing's hover quotes the first list that ranked it", () => {
  eq(capHint(DATA, "NEWCO", "2024-11-20"), "Large cap: ₹1,00,119 Cr and above, ranks 1–100.");
});

test("a What works row quotes the lists its own trades were bought under", () => {
  /* One small cap bought under the Aug 2024 list and one under Feb 2025:
     the span runs from the lower floor to the higher ceiling of the two. */
  const book = [
    { symbol: "GREW", entry_date: "2024-09-10" },             // small, Aug 2024 list
    { symbol: "SMALL2", entry_date: "2025-03-01" },           // small, Feb 2025 list
  ];
  const data = { ...DATA, map: { ...DATA.map, SMALL2: "333" } };
  const row = capRangeFor(data, "Small cap", book);
  /* The range and the ranks, nothing more — the user cut the rest as too
     much for a hover. */
  eq(row, "Small cap when you bought these: ₹10,299 Cr to ₹33,221 Cr, ranks 251–750.");
  eq(capRangeFor(data, "Small cap", [book[0]]),
     "Small cap when you bought these: ₹10,299 Cr to ₹30,756 Cr, ranks 251–750.");
  eq(capRangeFor(data, "Large cap", book), "", "no trade of that size, no hover");
});

test("the built file carries each list's floors, smallest first in time", () => {
  for (const l of FILE.lists) ok(l.floors.large > l.floors.mid && l.floors.mid > l.floors.small, l.from);
  /* The February 2026 list, read against the spreadsheet: Dr. Reddy's at
     rank 100, Global Health at 250, Indian Metals & Ferro Alloys at 750 —
     micro starts at 751, about ₹5,000 Cr in 2025–26. */
  const feb26 = FILE.lists.find((l) => l.from === "2026-02-01");
  eq(JSON.stringify(feb26.floors), JSON.stringify({ large: 105174, mid: 34758, small: 5773 }));
});

test("every screen hangs the hover on its cell", () => {
  ok(/title=\{capOf\.hint\(t\.symbol, t\.entry_date\)/.test(read("src/components/journal/Trades.jsx")), "Trades");
  ok(/capOf\.hint\(r\.symbol, r\.entry_date\)/.test(read("src/components/journal/Holdings.jsx")), "Holdings");
  ok(/D\.id === "mcap" && mcapRange\(g\.key\)/.test(read("src/components/journal/Edge.jsx")), "What works");
});

test("micro starts at rank 751, about ₹5,000 Cr in today's lists", () => {
  for (const l of FILE.lists.filter((x) => x.from >= "2025-02-01")) {
    ok(l.floors.small > 4000 && l.floors.small < 7000, `${l.from}: rank 750 at ₹${l.floors.small} Cr`);
  }
  /* GNA and ASIANENE — ₹2,000-odd crore, small cap on Kite — are micro here. */
  eq(capOn(FILE, "GNA", "2026-10-07"), "Micro cap");
  eq(capOn(FILE, "ASIANENE", "2026-09-23"), "Micro cap");
  ok(/rank 751 onwards/.test(capHint(FILE, "GNA", "2026-10-07")));
});
