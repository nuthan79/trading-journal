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
