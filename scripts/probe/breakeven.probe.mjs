import { test, eq, ok, near } from "./harness.mjs";
import { breakevenPrompt, FREE_AT_R } from "@/lib/path";

/**
 * A REMINDER THAT VANISHES IS WORSE THAN ONE THAT NEVER APPEARED.
 *
 * The flag read the LIVE mark, so a position that ran past 1.5R and slipped
 * back lost its prompt — unacknowledged, unrecorded, with nothing left to say
 * it had ever been earned. Found on a real holding sitting at +1.05R after
 * reaching well past 1.5R.
 *
 * The trap is that the position is still ABOVE ENTRY, so the stop can still go
 * to breakeven. The prompt disappeared while the thing it prompts for was
 * still available — which is why "it recovers if the price recovers" is not a
 * defence.
 */

/* An open position, marked, with room on the dial. */
const pos = (o = {}) => ({
  id: "t1", symbol: "DATAPATTNS", side: "long",
  entry_price: 4600, stop: 4455, mark: 4777, netRiskR: 1,
  became_free_on: null, breakeven_ack_at: null, ...o,
});

test("a position that reached 1.5R and faded is still prompted", () => {
  /* THE BUG. Measured earlier at or past 1.5R, now back at roughly +1.2R. */
  const p = breakevenPrompt(pos({ became_free_on: "2026-08-12", mark: 4777 }));
  ok(p, "the reminder must survive the fade");
  ok(p.gainR < FREE_AT_R, `and it really has faded: ${p.gainR.toFixed(2)}R`);
  eq(p.faded, true);
  eq(p.freeOn, "2026-08-12", "so the wording can say when it was earned");
});

test("a position crossing 1.5R today is prompted before any measurement", () => {
  /* became_free_on refreshes weekly for open positions, so the live mark is
     what catches the day it happens. Without it the flag would appear up to a
     week late — on the trade most likely to still be moving. */
  const p = breakevenPrompt(pos({ became_free_on: null, mark: 4600 + 1.6 * 145 }));
  ok(p);
  eq(p.faded, false);
  eq(p.freeOn, null);
  ok(p.gainR >= FREE_AT_R);
});

test("a position that never got there is not prompted", () => {
  eq(breakevenPrompt(pos({ mark: 4650 })), null, "+0.34R has not earned it");
});

test("below entry it hands over rather than advising the impossible", () => {
  /*
    A breakeven stop placed below entry fires the moment it is set. That case
    belongs to the "closed past 1.5R and is now back below what you paid"
    badge, which says the opposite thing — too late, not act now.
  */
  eq(breakevenPrompt(pos({ became_free_on: "2026-08-12", mark: 4500 })), null,
    "under water, even having reached 1.5R");
  eq(breakevenPrompt(pos({ became_free_on: "2026-08-12", mark: 4600 })), null,
    "and exactly at entry there is nothing to take off");
});

test("acknowledging silences it for good", () => {
  eq(breakevenPrompt(pos({ became_free_on: "2026-08-12", breakeven_ack_at: "2026-08-13T09:00:00Z" })),
    null, "the stop was moved; asking twice is what makes a reminder noise");
});

test("nothing left to release means nothing to prompt", () => {
  /* The dial already carries no risk for this position — a stop at or above
     entry, or a position sold down to nothing. */
  eq(breakevenPrompt(pos({ netRiskR: 0, became_free_on: "2026-08-12" })), null);
});

test("a short is measured in its own direction", () => {
  const short = { id: "s", symbol: "X", side: "short", entry_price: 100, stop: 110,
                  mark: 82, netRiskR: 1, became_free_on: null, breakeven_ack_at: null };
  const p = breakevenPrompt(short);
  ok(p, "a short 1.8R in profit is prompted");
  near(p.gainR, 1.8, 1e-9);

  /* And the wrong way round is not. */
  eq(breakevenPrompt({ ...short, mark: 118 }), null, "a short at a loss");
});

test("missing inputs produce no prompt rather than a wrong one", () => {
  for (const bad of [
    { mark: NaN }, { mark: undefined }, { stop: NaN },
    { entry_price: NaN }, { stop: 4600 },      // stop at entry: no risk per share
  ]) {
    eq(breakevenPrompt(pos({ became_free_on: "2026-08-12", ...bad })), null,
      `${JSON.stringify(bad)} must not prompt`);
  }
  eq(breakevenPrompt(null), null);
  eq(breakevenPrompt(undefined), null);
});

/* ------------- the peak the app keeps, which is what closed the hole ----- */

test("a watched peak earns the flag even with no measurement at all", () => {
  /*
    THE CASE THE FIRST FIX MISSED.

    Reading `became_free_on` was correct and inert: it comes from the measure
    pass, which is optional and weekly, and on a journal that has never
    measured it is null everywhere. The flag stayed dark on exactly the trade
    that prompted the fix — DATAPATTNS at 1.05R, entry 4612, stop 4455, having
    run well past 1.5R days earlier.

    peak_mark is what the app itself watched, so nothing external has to have
    run for the reminder to survive.
  */
  const p = breakevenPrompt(pos({
    entry_price: 4612, stop: 4455, mark: 4777,
    peak_mark: 4880,                    // ~1.85R, seen on an earlier refresh
    became_free_on: null, mfe_r: null,
  }));
  ok(p, "watched peak alone must earn it");
  eq(p.faded, true);
  near(p.gainR, (4777 - 4612) / 157, 1e-9);
  ok(p.peakR >= FREE_AT_R, `and the flag can say how far it ran: ${p.peakR}`);
});

test("a measured peak works too, for history the app never watched", () => {
  /* mfe_r reaches back before peak_mark existed and before the app was open
     that day — the two together are what make this complete. */
  const p = breakevenPrompt(pos({ mark: 4777, peak_mark: null, mfe_r: 2.1 }));
  ok(p);
  near(p.peakR, 2.1, 1e-9);
});

test("a peak is measured against the stop in force NOW", () => {
  /*
    Stored as R it would freeze the stop that was in place when it was
    written. As a price, widening the stop correctly makes the same peak worth
    less — the trader is running more risk, so the same move is fewer R.
  */
  const tight = breakevenPrompt(pos({ entry_price: 100, stop: 90, mark: 112, peak_mark: 116 }));
  ok(tight, "1.6R against a 10-point stop");

  const wide = breakevenPrompt(pos({ entry_price: 100, stop: 80, mark: 112, peak_mark: 116 }));
  eq(wide, null, "0.8R against a 20-point stop — never earned it");
});

test("a short keeps its peak downward", () => {
  const p = breakevenPrompt({
    id: "s", symbol: "X", side: "short", entry_price: 100, stop: 110,
    mark: 95, peak_mark: 82, netRiskR: 1, became_free_on: null, breakeven_ack_at: null,
  });
  ok(p, "fell to 1.8R in profit, now back at 0.5R");
  eq(p.faded, true);
  near(p.peakR, 1.8, 1e-9);
});

test("a nonsense peak cannot manufacture a flag", () => {
  for (const bad of [0, -5, NaN, null, undefined, "x"]) {
    eq(breakevenPrompt(pos({ mark: 4650, peak_mark: bad, became_free_on: null, mfe_r: null })),
      null, `peak_mark ${JSON.stringify(bad)} must not earn it`);
  }
});
