import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { losingRun, LOSING_RUN_ALERT } from "@/lib/bottleneck";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");
const t = (entry_date, r, symbol) => ({ entry_date, r, symbol, pnl: r * 1000 });

/* The run the book was actually on when this was asked for. */
const REAL = [
  t("2026-08-24", 4.02, "YATHARTH"), t("2026-08-26", -0.84, "DREDGECORP"),
  t("2026-09-09", -1.09, "BHEL"), t("2026-09-10", -1.70, "BEPL"),
  t("2026-09-10", -1.12, "PARAS"), t("2026-09-17", -1.06, "NEOGEN"),
  t("2026-09-17", -1.24, "AYE"), t("2026-09-18", -1.43, "ANANDRATHI"),
  t("2026-09-18", -0.90, "GUJTHEM"), t("2026-09-23", -1.08, "ASIANENE"),
];

test("the run is counted from the most recent entry backwards", () => {
  const r = losingRun(REAL);
  eq(r.n, 9, "nine losing entries stand between now and the last winner");
  eq(r.from, "2026-08-26");
  eq(r.to, "2026-09-23");
  eq(r.lastWin.symbol, "YATHARTH", "the run has to be measured from something");
  eq(r.lastWin.date, "2026-08-24");
  ok(r.n >= LOSING_RUN_ALERT, "this is the case the alert exists for");
});

/**
 * TIES CANNOT DECIDE IT. stats() counts streaks by day rather than by row
 * because trades sharing a date have no inherent order, and a per-row run
 * moved with the tiebreak — 50, 53, 67 or 71 on the same book. So a day ends
 * the run if anything taken that day won, which is the shortest run any
 * ordering could produce: the alert can never fire on a sort order.
 */
test("a win anywhere on a day ends the run, whatever the order within it", () => {
  eq(losingRun([...REAL, t("2026-09-23", 2, "TIEWIN")]).n, 0,
     "a winner on the newest day must end the run however the ties sort");
  eq(losingRun([...REAL, t("2026-09-24", 2, "TODAY")]).n, 0, "and a later winner too");
  /* A winner on a day in the middle truncates it rather than being skipped. */
  eq(losingRun([...REAL, t("2026-09-17", 3, "MIDWIN")]).n, 3,
     "only the days after the last winning day count");
});

test("a trade with no stop still counts as won or lost", () => {
  /* R is undefined without a stop, but the money is not — leaving these out
     would let a loss span a run without extending it, and a win end nothing. */
  const noStop = { entry_date: "2026-09-24", symbol: "NOSTOP", pnl: 5000 };
  eq(losingRun([...REAL, noStop]).n, 0, "a profitable no-stop trade must end the run");
  const losing = { entry_date: "2026-09-24", symbol: "NOSTOP", pnl: -5000 };
  eq(losingRun([...REAL, losing]).n, 10, "and a losing one must extend it");
});

test("an empty or winning book is not on a run", () => {
  eq(losingRun([]).n, 0);
  eq(losingRun([t("2026-09-01", 1, "A"), t("2026-09-02", 2, "B")]).n, 0);
  eq(losingRun([]).lastWin, null, "and has nothing to measure from");
});

/**
 * ON ANALYSIS, NOT ON HOLDINGS.
 *
 * Seven is one trader's number — measured on one book, and nobody has said it
 * is right for anyone else. Holdings is a factual screen about what is held;
 * a judgement resting on a threshold that may be wrong for the reader belongs
 * where interpretation already lives, and where nothing else on the page is
 * stated as fact. Asked for and reversed the same day, which is the whole
 * reason it is one component rather than two copies.
 */
test("the threshold is seven and the Process tab acts on it", () => {
  eq(LOSING_RUN_ALERT, 7, "the number the measurement supported");
  const src = read("components/journal/LosingRun.jsx");
  ok(/run\.n < LOSING_RUN_ALERT\) return null/.test(src), "the card shows below the threshold");
  ok(/losingRun\(closed\)/.test(src), "it must read the closed book, not the open one");
  ok(/<LosingRun closed=\{closed\} \/>/.test(read("components/journal/Review.jsx")),
     "the Process tab does not show it");
  ok(!/LosingRun/.test(read("components/journal/Holdings.jsx")),
     "Holdings states facts; a threshold somebody else may not share is not one");
  /*
   * WHAT THE CARD SAYS, AND HOW MUCH OF IT.
   *
   * Two readings of a long run: "the market has turned" is useful, "my system
   * is broken" destroys an edge that was only having a bad month. So the card
   * has to steer to the first — but the first draft spent three sentences
   * doing it, which is two more than a warning gets read at. The method and
   * the caveat belong in the hover; the body is what to do.
   */
  const flat = src.replace(/\s+/g, " ");
  ok(/The market isn&apos;t taking your setups/.test(flat), "it must name the market, not the system");
  ok(/Cut risk per trade, or stand aside/.test(flat), "and say what to do about it");
  ok(/not that your setup stopped working/.test(flat), "the reassurance must survive, in the hover");
  /* The body, without the heading or the hover, stays short enough to read. */
  const body = flat.slice(flat.indexOf("The market isn&apos;t"), flat.indexOf("Last winner"));
  ok(body.length < 180, `the card is ${body.length} characters of prose again`);
});
