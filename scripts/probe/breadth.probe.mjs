import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { countBreadth, share, bandOf, breadthBefore, groupsOf, BREADTH_BANDS } from "@/lib/breadthCalc";
import { dimensionRows, DIMENSIONS, edgeFilterFor, matchesEdgeFilter, NOT_RECORDED } from "@/lib/edge";
import { splitFactor } from "../build-breadth.mjs";
import { SHOW_MARKET_BREADTH } from "@/lib/flags";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const FILE = JSON.parse(read("public/breadth.json"));

const stock = (o) => ({ s: "X", c: "3", sma20: 100, sma50: 100, sma200: 100, hi: 130, lo: 70, prev: 100, ...o });

/* Each measure counts against its own denominator, and the tiers nest. */
test("a stock counts above, below, or not at all", () => {
  const b = countBreadth([
    stock({ s: "UP", close: 110 }),                                 // above all three averages
    stock({ s: "DOWN", close: 90 }),
    stock({ s: "NEW", close: 120, sma200: null, hi: null, lo: null }), // too young for a 200-day or a range
    stock({ s: "NOPRICE", close: null }),
  ], (st) => st.close);
  eq(b.small.n, 3, "no price, not counted");
  eq(b.small.n50, 3); eq(b.small.a50, 2);
  eq(b.small.n200, 2, "a stock with no 200-day average is left out of that column, not counted below");
  eq(b.small.a200, 1);
  eq(b.small.adv, 2); eq(b.small.dec, 1);
  eq(b.top.n, 3, "small caps count in the Top 750");
  eq(b.micro.n, 0);
});

test("the 52-week range is read in thirds, past either end counting as that end", () => {
  const b = countBreadth([
    stock({ close: 75 }), stock({ close: 100 }), stock({ close: 125 }), stock({ close: 140 }), stock({ close: 60 }),
  ], (st) => st.close);
  eq([b.small.lo, b.small.mid, b.small.hi].join(","), "2,1,2");
});

test("tiers: large, mid and small make the Top 750; micro stands apart", () => {
  eq(groupsOf("1").join(), "top,large"); eq(groupsOf("3").join(), "top,small");
  eq(groupsOf("4").join(), "micro"); eq(groupsOf("").length, 0);
});

/*
 * THE LIVE PATH IS THE SAME COUNT. Levels judged at the closing prices must
 * give exactly what the stored history gives — so when a feed arrives, only
 * the prices change.
 */
test("levels judged at the close reproduce the end-of-day count", () => {
  const book = [stock({ s: "A", close: 110 }), stock({ s: "B", close: 95, c: "1" }), stock({ s: "C", close: 99, c: "4" })];
  const eod = countBreadth(book, (st) => st.close);
  const prices = Object.fromEntries(book.map((st) => [st.s, st.close]));
  const live = countBreadth(book.map(({ close, ...lv }) => lv), (st) => prices[st.s]);
  eq(JSON.stringify(live), JSON.stringify(eod));
});

test("shares round to one decimal and refuse an empty base", () => {
  eq(share(142, 738), 19.2); eq(share(1, 0), null);
});

/* Breadth at entry: the last close BEFORE the entry date — never the entry
   day's own close, which happens after the trade. */
test("breadth at entry is the close before the trade", () => {
  const days = [["2026-10-07", 30], ["2026-10-08", 45], ["2026-10-09", 65]];
  eq(breadthBefore(days, "2026-10-09").pct, 45, "bought on the 9th: the 8th's close");
  eq(breadthBefore(days, "2026-10-12").pct, 65, "a Monday reads Friday");
  eq(breadthBefore(days, "2026-10-07"), null, "nothing before the first day");
  eq(breadthBefore(days, "2026-10-25"), null, "a file not refreshed for over a week says nothing, not last week's figure");
});

test("bands at 40 and 60", () => {
  eq(bandOf(39.9), "Under 40%"); eq(bandOf(40), "40–60%"); eq(bandOf(60), "40–60%");
  eq(bandOf(60.1), "Over 60%"); eq(bandOf(null), "");
});

/*
 * SPLITS FROM IMPOSSIBLE MOVES. NSE's bhavcopy does not restate the previous
 * close on an ex-date — RELIANCE's 1:1 bonus read ₹2,655.70 then ₹1,334.35 —
 * so a move no price band allows, landing on a split ratio, is one.
 */
test("a split or bonus is recognised from the price alone", () => {
  eq(splitFactor(2655.7, 1334.35), 0.5, "RELIANCE 1:1 bonus, Oct 2024");
  eq(Number(splitFactor(6996.5, 2448).toFixed(4)), Number((1 / 3).toFixed(4)), "BSE 2:1 bonus, May 2025");
  eq(splitFactor(1000, 100), 0.1, "10:1 split");
  eq(splitFactor(100, 85), 1, "a 15% fall is the market");
  eq(splitFactor(100, 45), 1, "a fall landing on no ratio is left as a fall");
  eq(splitFactor(50, 500), 10, "a 1:10 consolidation");
});

/* The built file, read against days anybody remembers. */
test("the built file reads the market's history right", () => {
  const on = (d) => FILE.days.filter((r) => r[0] <= d).at(-1)[1];
  ok(FILE.days[0][0] <= "2018-06-01", `starts ${FILE.days[0][0]}`);
  ok(on("2020-03-24") < 5, `COVID low read ${on("2020-03-24")}%`);
  ok(on("2025-02-28") < 15, `Feb 2025 correction read ${on("2025-02-28")}%`);
  ok(on("2025-06-30") > 60, `the mid-2025 rally read ${on("2025-06-30")}%`);
  for (const g of ["top", "large", "mid", "small", "micro"]) ok(FILE.latest[g].n > 0, `latest ${g}`);
  eq(FILE.chart.dates.length, FILE.chart.top.length);
});

test("What works cuts by breadth at entry, in regime order", () => {
  const book = [
    { breadthBand: "Over 60%", r: 2, pnl: 2 }, { breadthBand: "", r: 1, pnl: 1 },
    { breadthBand: "Under 40%", r: -1, pnl: -1 }, { breadthBand: "40–60%", r: 0.5, pnl: 0.5 },
  ];
  eq(dimensionRows(book, "breadth").map((r) => r.key).join(" · "),
     `${BREADTH_BANDS.join(" · ")} · ${NOT_RECORDED}`);
  const row = dimensionRows(book, "breadth").find((r) => r.key === "Over 60%");
  eq(book.filter((t) => matchesEdgeFilter(t, edgeFilterFor("breadth", row))).length, 1);
  const d = DIMENSIONS.find((x) => x.id === "breadth");
  ok(!d.showIf([{ breadthBand: "" }]));
  eq(!!d.showIf([{ breadthBand: "40–60%" }]), SHOW_MARKET_BREADTH, "offered only while the feature is on");
  ok(/close before you bought/.test(d.hint), "the hint says which close");
});

test("screens lay breadth on by entry date, and the live seam stays shut", () => {
  ok(/breadthBand: breadth\.bandAt\(t\.entry_date\)/.test(read("src/components/journal/Edge.jsx")), "What works");
  const trades = read("src/components/journal/Trades.jsx");
  ok(/useBreadth\(SHOW_MARKET_BREADTH && edge\?\.dim === "breadth"\)/.test(trades), "Trades fetches only for a breadth row");
  ok(/breadthBand: breadth\.bandAt\(t\.entry_date\) \}, edge\)/.test(trades), "and tests the same band");
  ok(/export const SHOW_LIVE_BREADTH = false;/.test(read("src/lib/flags.js")), "no live feed yet");
  ok(/if \(!SHOW_LIVE_BREADTH\) return null;/.test(read("src/lib/breadth.js")));
});

/*
 * HIDDEN, NOT DELETED. The user found it of no use for now (12 Oct 2026) and
 * may come back to it: everything stays built, behind one flag, and nothing
 * is fetched while it is off.
 */
test("market breadth is hidden behind SHOW_MARKET_BREADTH", () => {
  eq(SHOW_MARKET_BREADTH, false);
  const layout = read("src/app/(app)/layout.jsx");
  ok(/\.\.\.\(SHOW_MARKET_BREADTH \? \[\{ id: "market", href: "\/market", label: "Market"/.test(layout),
     "the Market tab is on the nav only when the flag is on");
  const page = read("src/app/(app)/market/page.jsx");
  ok(/if \(!SHOW_MARKET_BREADTH\) router\.replace\("\/dashboard"\)/.test(page), "a bookmark lands on the dashboard");
  ok(/useBreadth\(SHOW_MARKET_BREADTH\)/.test(read("src/components/journal/Edge.jsx")),
     "What works does not fetch the file while it is hidden");
});

test("the Market screen points at your own trades, and says it is end of day", () => {
  const m = read("src/components/journal/Market.jsx");
  ok(/href="\/analysis\/edge\?dim=breadth"/.test(m), "links to Breadth at entry");
  ok(/NSE end-of-day figures/.test(m), "says it is end of day, not live");
});
