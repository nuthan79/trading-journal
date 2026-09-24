import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { recentCompliance } from "@/lib/bottleneck";
import { SHOW_LAST_TEN } from "@/lib/flags";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/* A closed trade with a real stop, so it carries an R the summary can use. */
const trade = (exit_date, r, symbol) => ({
  exit_date, r, symbol, riskPct: 0.5, pnl: r * 1000,
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
test("the last N closed is a count, not a window", () => {
  const ten = recentCompliance(book, { last: 10 });
  eq(ten.trades, 10, "it must take exactly the last ten");
  eq(ten.last, 10);
  eq(ten.days, null, "a count has no window length to report");
  ok(ten.from < ten.to, "it reports the span it happened to cover");
  eq(ten.to, "2026-09-23", "the most recent closed trade ends it");
  eq(ten.from, "2026-09-14", "and the tenth from the end begins it");
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

test("both strips are one component, so they cannot drift", () => {
  const src = read("components/journal/Review.jsx");
  eq((src.match(/<div className="rv-proc-week"/g) || []).length, 1,
     "the strip markup is written twice — the two will say different things eventually");
  eq((src.match(/<ProcessWindow /g) || []).length, 2, "both windows must render through it");
  ok(/w\.last \? `Last \$\{w\.last\} closed`/.test(src), "the heading must name which sample it is");
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
