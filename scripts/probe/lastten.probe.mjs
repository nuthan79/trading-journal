import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { recentCompliance } from "@/lib/bottleneck";
import { SHOW_LAST_TEN } from "@/lib/flags";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/* A closed trade with a real stop, so it carries an R the summary can use. */
const trade = (exit_date, r, symbol, entry_date = exit_date) => ({
  exit_date, entry_date, r, symbol, riskPct: 0.5, pnl: r * 1000,
  entry_price: 100, stop_loss: 90, stop_source: null,
});
const book = Array.from({ length: 14 }, (_, i) =>
  trade(`2026-09-${String(10 + i).padStart(2, "0")}`, i % 4 === 0 ? -1.4 : 0.8, `S${i}`));

/**
 * TWO WAYS TO SAY "RECENTLY".
 *
 * A week is the calendar's idea of it and goes quiet when the trader does —
 * three trades, or none, and nothing to judge the sizing by. Ten closed
 * trades is always ten, whatever the pace.
 */
test("the last N is a count, not a window", () => {
  const ten = recentCompliance(book, { last: 10 });
  eq(ten.trades, 10, "it must take exactly the last ten");
  eq(ten.last, 10);
  eq(ten.days, null, "a count has no window length to report");
  ok(ten.from < ten.to, "it reports the span it happened to cover");
});

/**
 * ORDERED BY WHEN THE BET WAS PLACED, not when it resolved.
 *
 * On a real book the two readings disagreed by 23R and by five wins: old
 * winners closing now made the last ten look excellent while every entry
 * actually being placed was stopped out within a day. One said raise the
 * size, the other said stop trading. The question is whether the market is
 * taking the setups NOW, so recency has to mean the entry.
 */
test("the sample is the last N taken, not the last N to close", () => {
  const book2 = [
    /* entered long ago, closed yesterday: a good result from an old market */
    trade("2026-09-20", 4, "OLD", "2026-01-05"),
    /* entered recently and stopped out the same week */
    ...Array.from({ length: 3 }, (_, i) =>
      trade(`2026-09-1${i}`, -1, `NEW${i}`, `2026-09-1${i}`)),
  ];
  const three = recentCompliance(book2, { last: 3 });
  eq(three.trades, 3);
  ok(!three.overrunSymbols.concat(three.trades).includes?.("OLD"), "sanity");
  eq(three.netR, -3, "the old winner must not count as recent trading");
  eq(three.to, "2026-09-12", "the span is of entry dates");
});

test("a short book gives back everything it has, not an error", () => {
  const three = recentCompliance(book.slice(0, 3), { last: 10 });
  eq(three.trades, 3, "asking for ten of three must answer three");
  const none = recentCompliance([], { last: 10 });
  eq(none.trades, 0);
  eq(none.from, null, "there are no dates to span");
  ok(none.netR === null, "and nothing to average");
});

/** The window behaviour it grew out of has to be untouched. */
test("the seven-day window still answers as it did", () => {
  const wk = recentCompliance(book, { days: 7, asOf: new Date("2026-09-24T00:00:00Z") });
  eq(wk.days, 7);
  eq(wk.last, null);
  eq(wk.from, "2026-09-17");
  eq(wk.to, "2026-09-24");
  eq(wk.trades, 6, "the window counts by date, not by how many there are");
});

/**
 * WHAT THE SAMPLE CANNOT SEE, AND WHICH CUTS AGAINST IT. Ordering closed
 * trades by entry over-represents quick losses — an entry placed last week
 * can only be closed already if it resolved fast, and fast mostly means
 * stopped out. The ones still running are the ones that have not failed, and
 * a reader could stop trading on nine losses while four recent entries sit in
 * profit.
 */
test("entries from the same stretch that are still open are counted and named", () => {
  const closedRows = Array.from({ length: 12 }, (_, i) =>
    trade(`2026-09-${String(10 + i).padStart(2, "0")}`, -1, `C${i}`,
          `2026-09-${String(10 + i).padStart(2, "0")}`));
  const openRows = [
    { entry_date: "2026-09-18", status: "open", symbol: "RUNNING" },
    { entry_date: "2026-01-02", status: "open", symbol: "ANCIENT" },
  ];
  const w = recentCompliance(closedRows, { last: 10, open: openRows });
  eq(w.stillOpen, 1, "only entries inside the sample's own stretch count");
  eq(recentCompliance(closedRows, { last: 10 }).stillOpen, 0, "and none when none are passed");

  /* And the screen has to hand them over, or the count is always zero and the
     caveat silently never appears. */
  const src = read("components/journal/Review.jsx");
  ok(/open: \(all \|\| \[\]\)\.filter\(isOpen\)/.test(src),
     "Review does not pass the open trades, so the unresolved entries go unmentioned");
  ok(/w\.stillOpen > 0 &&/.test(src), "and nothing renders them");
});

test("both strips are one component, so they cannot drift", () => {
  const src = read("components/journal/Review.jsx");
  eq((src.match(/<div className="rv-proc-week"/g) || []).length, 1,
     "the strip markup is written twice — the two will say different things eventually");
  eq((src.match(/<ProcessWindow /g) || []).length, 2, "both windows must render through it");
  ok(/w\.last \? `Last \$\{w\.last\} taken`/.test(src),
     "the heading must say the sample is the last N TAKEN, not the last N to close");
});

/**
 * On trial: the user asked for it and will keep it or drop it after living
 * with it, so dropping it is one word in flags.js rather than an edit here.
 */
test("the trial is behind a flag, and the flag is on", () => {
  ok(SHOW_LAST_TEN === true, "the trial is meant to be visible");
  const src = read("components/journal/Review.jsx");
  ok(/SHOW_LAST_TEN && lastTen/.test(src), "turning the flag off must hide it");
  ok(/lastTen\?\.trades > 0/.test(src),
     "an empty strip beside a week that already said 'nothing closed' is noise");
});

/* ---- the baseline --------------------------------------------------- */

/**
 * "+23.2R" CANNOT BE JUDGED ON ITS OWN, and judging it is the whole use of
 * this strip — the trader reads it to decide whether the market has turned
 * against them. Beside a usual ten it answers immediately.
 */
test("the sample is measured against the rest of the book", () => {
  /* 40 trades averaging +0.15R, then ten much better ones. */
  const dull = Array.from({ length: 40 }, (_, i) =>
    trade(`2026-0${1 + (i % 8)}-${String(1 + (i % 27)).padStart(2, "0")}`, i % 2 ? 1.2 : -0.9, `D${i}`));
  const hot = Array.from({ length: 10 }, (_, i) => trade(`2026-09-${String(10 + i).padStart(2, "0")}`, 3, `H${i}`));
  const w = recentCompliance([...dull, ...hot], { last: 10 });
  eq(w.trades, 10);
  eq(w.netR, 30, "the sample is the ten hot ones");
  ok(w.baseline, "there is a baseline to read them against");
  eq(w.baseline.n, 40, "the baseline is the other forty");
  ok(w.baseline.expectedR < w.netR,
     "a hot ten must stand out against the book, or the line says nothing");
});

/**
 * THE SAMPLE IS LEFT OUT OF ITS OWN BASELINE. Included, the norm is pulled
 * toward whatever just happened — most on a short record, which is exactly
 * where a reader leans on the comparison hardest.
 */
test("a stretch is not compared against a book containing itself", () => {
  const flat = Array.from({ length: 40 }, (_, i) => trade(`2026-0${1 + (i % 8)}-15`, 0, `F${i}`));
  const hot = Array.from({ length: 10 }, (_, i) => trade(`2026-09-${String(10 + i).padStart(2, "0")}`, 5, `H${i}`));
  const w = recentCompliance([...flat, ...hot], { last: 10 });
  eq(w.baseline.perTrade, 0, "the hot ten leaked into the norm they are judged by");
  eq(w.baseline.n, 40);
});

test("too short a record gets no baseline rather than a made-up one", () => {
  const few = Array.from({ length: 22 }, (_, i) => trade(`2026-0${1 + (i % 8)}-15`, 1, `F${i}`));
  eq(recentCompliance(few, { last: 10 }).baseline, null,
     "an average ten drawn from twenty trades is two samples, not a norm");
});

test("the comparison shows only on the fixed sample", () => {
  const src = read("components/journal/Review.jsx");
  ok(/w\.last && w\.baseline &&/.test(src),
     "the week strip would claim a usual seven days, which is about pace, not trading");
  ok(/Usual \{w\.trades\}:/.test(src), "the line must name the sample size it is matching");
});

/* ---- reading the two strips against each other ---------------------- */

/**
 * THREE FIXED COLUMNS. With auto-fit they did not line up: the second strip
 * had five items to the first one's three, the stop list wrapped, and the same
 * fact sat at a different x in each — which is the one thing a pair of strips
 * exists to allow. What closed, how the stops held, how much was risked;
 * anything else is a footnote to the first column and is placed there.
 */
test("the two strips share one column grid", () => {
  const src = read("components/journal/Review.jsx");
  const css = src.slice(src.indexOf(".rv-proc-week-l {"), src.indexOf(".rv-marks"));
  ok(!/auto-fit/.test(css), "auto-fit lets the strips disagree about where a column starts");
  ok(/grid-template-columns: minmax\(/.test(css), "the columns must be fixed, not flowed");
  ok(/\.rv-sub \{ grid-column: 1;/.test(css), "footnotes must sit under the first column");
  ok(/@media \(max-width: 760px\)/.test(css), "and collapse to one column when there is no room");
});

/**
 * THE SHAPE, NOT ONLY THE COUNT. Nine losses scattered through ten trades is
 * variance; nine at the end is a regime, and "1 won, 9 lost" cannot tell them
 * apart. Filled for a win and hollow for a loss, so it reads without colour.
 */
test("the fixed sample shows each trade in order", () => {
  const w = recentCompliance([
    trade("2026-08-24", 4, "WIN", "2026-08-24"),
    ...Array.from({ length: 9 }, (_, i) =>
      trade(`2026-09-0${i + 1}`, -1, `L${i}`, `2026-09-0${i + 1}`)),
  ], { last: 10 });
  eq(w.marks.length, 10, "one mark per trade in the sample");
  eq(w.marks[0], 1, "oldest first, so the eye lands on what just happened");
  eq(w.marks[9], -1);

  const src = read("components/journal/Review.jsx");
  ok(/w\.last && w\.marks\?\.length > 0/.test(src),
     "a week of three marks is a row of dots, not a sequence — fixed sample only");
  const css = src.slice(src.indexOf(".rv-marks {"));
  ok(/border: 1px solid var\(--short\)/.test(css) && /background: var\(--long\)/.test(css),
     "filled or hollow, so the marks are legible without colour");
});
