import { test, eq, ok } from "./harness.mjs";
import { tradePath, pathOutcomes, FREE_AT_R, POWER_R, POWER_DAYS } from "@/lib/path";

/* Entry 100, stop 90 — 1R is ten points. Sessions skip a weekend on purpose,
   so anything counting calendar days instead of bars gets it wrong. */
const DAYS = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09",
              "2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16"];
const T = (o = {}) => ({
  entry_price: 100, stop_loss: 90, side: "long", stop_source: "recorded",
  entry_date: "2026-01-05", exit_date: "2026-01-16", ...o,
});
const bars = (closes, opens) =>
  closes.map((c, i) => ({
    d: DAYS[i], c,
    o: opens ? opens[i] : c,
    h: Math.max(c, opens ? opens[i] : c) + 1,
    l: Math.min(c, opens ? opens[i] : c) - 1,
  }));

test("MFE and MAE come off the closes", () => {
  const p = tradePath(T({ r: 2.5 }), bars([100, 105, 118, 112, 96, 104, 110, 108, 122, 125]));
  eq(p.mfeR, 2.5, "best close 125 is +2.5R");
  eq(p.maeR, -0.4, "worst close 96 is −0.4R");
});

test("the entry day is excluded", () => {
  /* That bar holds the move before the position existed; counting it makes a
     gap-up on the entry date read as favourable excursion. */
  const p = tradePath(T({ exit_date: "2026-01-07", r: 0.1 }), bars([140, 101, 101]));
  eq(p.mfeR, 0.1, "the 140 open-day bar must not count");
});

test("days to MFE are counted in sessions, not dates", () => {
  const p = tradePath(T({ r: 2.5 }), bars([100, 105, 112, 118, 130, 128, 126, 124, 122, 125]));
  eq(p.daysToMfe, 4, "2026-01-09 is the fourth session after entry, not the fifth day");
});

test(`power needs ${POWER_R}R inside ${POWER_DAYS} sessions`, () => {
  const fast = tradePath(T({ r: 2.5 }), bars([100, 105, 112, 118, 130, 128, 126, 124, 122, 125]));
  ok(fast.isPower, "3R on session four is a power trade");
  const slow = tradePath(T({ r: 2.5 }), bars([100, 101, 103, 105, 108, 112, 130, 124, 122, 125]));
  ok(!slow.isPower, "3R on session six is not");
});

test("an assumed stop is refused outright", () => {
  eq(tradePath(T({ stop_source: "assumed", r: 2 }), bars([100, 130, 130])), null,
     "R against a stop nobody set is not R");
});

/* ---- the gap check, which was backwards on the first attempt ----------- */

test("drifting down through breakeven is NOT a gap", () => {
  /* The session closing below entry OPENED above it, so breakeven traded that
     day and was there to be taken. */
  const t = T({ r: -0.8, breakeven_ack_at: "2026-01-08T05:00:00Z" });
  const p = tradePath(t, bars([100, 108, 118, 116, 110, 104, 99, 96, 93, 92],
                              [100, 107, 117, 117, 111, 105, 103, 98, 95, 93]));
  eq(p.gappedThroughBreakeven, false);
  eq(pathOutcomes(t, p).brokeAcked, true, "acked, drifted, closed below — the one judgement");
});

test("gapping over breakeven must not accuse anybody", () => {
  const t = T({ r: -0.8, breakeven_ack_at: "2026-01-08T05:00:00Z" });
  const p = tradePath(t, bars([100, 108, 118, 116, 110, 104, 88, 86, 84, 92],
                              [100, 107, 117, 117, 111, 105, 89, 87, 85, 90]));
  eq(p.gappedThroughBreakeven, true, "prev close above, this open below — price jumped the level");
  eq(pathOutcomes(t, p).brokeAcked, false);
});

test("no opens in the data leaves the gap question unanswered", () => {
  /* Undecidable must stay null and never read as false — false is the value
     that accuses somebody of something the data cannot show. */
  const t = T({ r: -0.8, breakeven_ack_at: "2026-01-08T05:00:00Z" });
  const noOpens = DAYS.map((d, i) => ({ d, c: [100, 108, 118, 116, 110, 104, 99, 96, 93, 92][i] }));
  const p = tradePath(t, noOpens);
  eq(p.gappedThroughBreakeven, null);
  eq(pathOutcomes(t, p).brokeAcked, false);
});

test("never acked means no verdict either way", () => {
  const t = T({ r: -0.8 });
  const p = tradePath(t, bars([100, 108, 118, 116, 110, 104, 99, 96, 93, 92],
                              [100, 107, 117, 117, 111, 105, 103, 98, 95, 93]));
  const o = pathOutcomes(t, p);
  eq(o.brokeAcked, false, "the app suggested it; they never said they did it");
  eq(o.roundTripped, true, `reached ${FREE_AT_R}R and finished at or below entry`);
});
