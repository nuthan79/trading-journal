import { test, ok, eq, near } from "./harness.mjs";
import {
  giveback, givebackBook, givebackByTag, postExitNeeded,
} from "../../src/lib/giveback.js";

/**
 * GIVEBACK — what a trade handed back between its best close and its exit.
 *
 * This exists because the tag table costs an exit-timing tag by what the
 * trades carrying it returned, which selects winners and reports that selling
 * badly pays. The checks below pin the three things that make the replacement
 * honest rather than merely different:
 *
 *   - an exit that beat every close floors at zero and never reads as a bonus
 *   - a trade with no stop, or one never measured, says WHY it has no figure
 *     rather than counting as a zero giveback and flattering the median
 *   - the tag is only called real when it marks trades the measurement also
 *     finds, on enough of them for a median to mean anything
 */

/* A measured, closed trade. `path_to` is what marks it measured — excursion
   tests that column and not mfe_r, so a trade that ran and gave it all back
   is still a reading rather than a gap. */
const T = (over = {}) => ({
  id: over.id || "t1",
  symbol: over.symbol || "ACME",
  status: "closed",
  side: "long",
  entry_date: "2026-04-01",
  exit_date: "2026-05-01",
  entry_price: 100,
  stop_loss: 90,
  initial_stop_loss: 90,
  quantity: 100,
  riskAmt: 1000,
  path_to: "2026-05-01",
  mfe_r: 3,
  mae_r: -0.4,
  r: 1,
  mistakes: [],
  ...over,
});

test("giveback is the distance from best close to exit", () => {
  const g = giveback(T({ mfe_r: 3, r: 1 }));
  ok(g.measurable, "should be measurable");
  near(g.givebackR, 2, 1e-9, "3R peak closed at 1R");
  near(g.keptPct, 100 / 3, 1e-6, "kept a third of the peak");
  near(g.givebackMoney, 2000, 1e-9, "2R of a 1000-rupee R");
});

test("an exit that beat every close floors at zero, never negative", () => {
  /* Legitimate: mfe_r is the best daily CLOSE, and you can sell intraday
     above where the day finished. Before the floor this returned -0.5R and
     rendered as a trade that gained by exiting. */
  const g = giveback(T({ mfe_r: 2, r: 2.5 }));
  eq(g.givebackR, 0, "no giveback when the exit beat the best close");
  ok(g.keptPct <= 100, "kept share is capped at 100");
});

test("a trade that never ran says so instead of counting as zero", () => {
  const g = giveback(T({ mfe_r: 0.1, r: -1 }));
  ok(!g.measurable, "must not be measurable");
  eq(g.state, "never-ran");
});

test("no stop and not-measured are different dashes", () => {
  const noStop = giveback(T({ stop_loss: null, initial_stop_loss: null }));
  eq(noStop.state, "no-stop", "no 1R to measure in");
  ok(noStop.why.length > 0, "says why");

  const unmeasured = giveback(T({ path_to: null }));
  eq(unmeasured.state, "unmeasured", "measurable once the pass runs");
  ok(unmeasured.why !== noStop.why, "the two dashes must not read alike");
});

test("an open position is not costed", () => {
  eq(giveback(T({ status: "open", exit_date: null })).state, "open");
});

test("the book reports a median, not a mean", () => {
  /* One 9R giveback among four small ones. A mean would read 2.3R and make a
     tidy book look careless; the median says what usually happens. */
  const closed = [
    T({ id: "a", mfe_r: 1.2, r: 1.0 }),
    T({ id: "b", mfe_r: 1.5, r: 1.2 }),
    T({ id: "c", mfe_r: 1.4, r: 1.1 }),
    T({ id: "d", mfe_r: 12, r: 3 }),
  ];
  const b = givebackBook(closed);
  eq(b.measured, 4);
  near(b.medianGivebackR, 0.3, 1e-9, "median of 0.2, 0.3, 0.3, 9.0");
  near(b.totalGivebackR, 9.8, 1e-9);
  eq(b.worst[0].t.id, "d", "worst is listed first for the screen to link to");
});

test("skipped trades are counted by reason, not silently dropped", () => {
  const b = givebackBook([
    T({ id: "a", mfe_r: 2, r: 1 }),
    T({ id: "b", path_to: null }),
    T({ id: "c", stop_loss: null, initial_stop_loss: null }),
    T({ id: "d", mfe_r: 0.05, r: -1 }),
  ]);
  eq(b.measured, 1);
  eq(b.skipped.unmeasured, 1);
  eq(b.skipped["no-stop"], 1);
  eq(b.skipped["never-ran"], 1);
});

test("a tag that marks nothing real is called noise, not costed", () => {
  /* Sixteen trades, all giving back about the same, half of them tagged.
     The tag has found nothing, and saying so is the point of the comparison. */
  const closed = [];
  for (let i = 0; i < 16; i++) {
    closed.push(T({
      id: `n${i}`, mfe_r: 2, r: 1,
      mistakes: i % 2 === 0 ? ["Sold a little late"] : [],
    }));
  }
  const c = givebackByTag(closed, "Sold a little late");
  ok(c.comparable, "8 a side is enough to compare");
  near(c.gap, 0, 1e-9);
  ok(c.tagIsNoise, "must report the tag as noise");
  ok(!c.tagIsReal, "and must not report it as real");
});

test("a tag that marks real giveback is called real", () => {
  const closed = [];
  for (let i = 0; i < 10; i++) closed.push(T({ id: `l${i}`, mfe_r: 4, r: 1, mistakes: ["Sold a little late"] }));
  for (let i = 0; i < 10; i++) closed.push(T({ id: `k${i}`, mfe_r: 1.4, r: 1.2, mistakes: [] }));
  const c = givebackByTag(closed, "Sold a little late");
  ok(c.tagIsReal, "3R against 0.2R is a real difference");
  near(c.gap, 2.8, 1e-9);
});

test("too few either side and no verdict is offered", () => {
  const closed = [
    T({ id: "a", mfe_r: 4, r: 1, mistakes: ["Sold a little late"] }),
    ...Array.from({ length: 12 }, (_, i) => T({ id: `u${i}`, mfe_r: 1.4, r: 1.2 })),
  ];
  const c = givebackByTag(closed, "Sold a little late");
  ok(!c.comparable, "one tagged trade cannot be compared");
  ok(!c.tagIsReal && !c.tagIsNoise, "no verdict either way");
});

test("sold-too-early is listed as needing post-exit bars, not costed", () => {
  /* mfe_r stops at the exit date, so nothing here can say what the stock did
     after the sell. Naming the trades is the honest half of that. */
  const closed = [
    T({ id: "a", mistakes: ["Sold too early"] }),
    T({ id: "b", mistakes: ["Sold too early"] }),
    T({ id: "c", mistakes: ["Not a real base"] }),
  ];
  const need = postExitNeeded(closed);
  eq(need.count, 2);
  eq(need.sessions, 20);
  eq(need.rows[0].symbol, "ACME");
});

test("an empty book returns a shape rather than throwing", () => {
  const b = givebackBook([]);
  eq(b.measured, 0);
  eq(b.rows.length, 0);
  eq(givebackByTag([], "Sold a little late"), null);
});
