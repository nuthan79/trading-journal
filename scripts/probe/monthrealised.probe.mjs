import { test, eq, near, ok } from "./harness.mjs";
import { derivePosition, realisationEvents } from "@/lib/positions";

/**
 * WHAT "REALISED THIS MONTH" IS ALLOWED TO COUNT.
 *
 * Money that ARRIVED this month, which is a question about sells and says
 * nothing about when anything was bought. A position opened in July and part
 * sold in September owes September only the September part.
 *
 * The trap is the fallback. A closed trade with no recorded exit date has to
 * be placed somewhere, and its entry date is the only date it has — right for
 * a year-wide bucket, and wrong for a month, where it would report a purchase
 * as a profit. The year and the month read the same list, so the month
 * inherited the year's fallback and nothing said so.
 */

const mk = (t) => {
  const d = derivePosition(t, 5e6);
  return { ...t, ...d, status: t.status, exits: t.exits };
};

/* The strip's own rule, kept in the shape Holdings uses it. */
const monthOf = (closed, ym) => {
  const events = closed.flatMap((t) => {
    const evs = realisationEvents(t);
    if (evs.length) return evs;
    const d = t.exit_date || t.entry_date;
    if (!d) return [];
    return [{ date: String(d).slice(0, 10), pnl: t.pnl, r: t.r, trade: t,
              placedByEntry: !t.exit_date }];
  });
  const inMonth = events.filter((e) => !e.placedByEntry && e.date.slice(0, 7) === ym);
  return {
    pnl: inMonth.reduce((a, x) => a + (isFinite(x.pnl) ? x.pnl : 0), 0),
    n: new Set(inMonth.map((e) => e.trade?.id ?? e)).size,
  };
};

test("a position sold across two months pays each month its own part", () => {
  /* Bought in July — which the September figure must be blind to. */
  const t = mk({ id: "a", symbol: "XYZ", side: "long", status: "closed",
    entry_date: "2026-07-02", entry_price: 100, quantity: 500,
    stop_loss: 93, stop_source: "recorded", charges: 0,
    exit_date: "2026-09-02", exit_price: 120,
    exits: [
      { exit_date: "2026-08-20", quantity: 300, price: 110, charges: 0 },
      { exit_date: "2026-09-02", quantity: 200, price: 120, charges: 0 },
    ] });
  near(monthOf([t], "2026-08").pnl, 3000, 0.01, "August gets its 300 shares");
  near(monthOf([t], "2026-09").pnl, 4000, 0.01, "September gets its 200");
  eq(monthOf([t], "2026-07").pnl, 0, "and the month it was BOUGHT gets nothing");
});

test("scaling out three times is still one trade", () => {
  const t = mk({ id: "b", symbol: "XYZ", side: "long", status: "closed",
    entry_date: "2026-07-02", entry_price: 100, quantity: 300,
    stop_loss: 93, stop_source: "recorded", charges: 0,
    exit_date: "2026-09-20", exit_price: 120,
    exits: [
      { exit_date: "2026-09-05", quantity: 100, price: 110, charges: 0 },
      { exit_date: "2026-09-12", quantity: 100, price: 115, charges: 0 },
      { exit_date: "2026-09-20", quantity: 100, price: 120, charges: 0 },
    ] });
  eq(monthOf([t], "2026-09").n, 1, "one position, not three");
  near(monthOf([t], "2026-09").pnl, 4500, 0.01);
});

test("a closed trade with no exit date never lands in the month it was bought", () => {
  /*
    THE FALLBACK THAT LEAKED. This row has no exit date and no tranches, so
    the only date it carries is its entry — and the events list has to place
    it somewhere for the year figure's sake. It must not be placed here.
  */
  const t = { id: "c", symbol: "XYZ", side: "long", status: "closed",
    entry_date: "2026-09-01", entry_price: 100, quantity: 100,
    exit_date: null, exit_price: null, exits: [], pnl: 25000, r: 1.4 };
  eq(monthOf([t], "2026-09").pnl, 0, "a September BUY is not September's profit");
  eq(monthOf([t], "2026-09").n, 0);
});

test("an ordinary single-sell position still counts", () => {
  /* The guard must not cost the common case: an exit date IS recorded here,
     so nothing about it is a fallback. */
  const t = mk({ id: "d", symbol: "XYZ", side: "long", status: "closed",
    entry_date: "2026-07-02", entry_price: 100, quantity: 100,
    stop_loss: 93, stop_source: "recorded", charges: 0,
    exit_date: "2026-09-10", exit_price: 130,
    exits: [{ exit_date: "2026-09-10", quantity: 100, price: 130, charges: 0 }] });
  near(monthOf([t], "2026-09").pnl, 3000, 0.01);
  eq(monthOf([t], "2026-09").n, 1);
});

test("the month boundary is read as text, not parsed", () => {
  /* `new Date("2026-09-01")` is UTC midnight and getMonth() reads it back
     local, so west of Greenwich the 1st falls into August. Comparing the
     "YYYY-MM" prefixes has no zone in it at all. */
  const t = mk({ id: "e", symbol: "XYZ", side: "long", status: "closed",
    entry_date: "2026-08-15", entry_price: 100, quantity: 100,
    stop_loss: 93, stop_source: "recorded", charges: 0,
    exit_date: "2026-09-01", exit_price: 130,
    exits: [{ exit_date: "2026-09-01", quantity: 100, price: 130, charges: 0 }] });
  near(monthOf([t], "2026-09").pnl, 3000, 0.01, "the first of the month is September");
  eq(monthOf([t], "2026-08").pnl, 0);
});

/* The strip's rule as it now stands: every sell, closed position or not. */
const bankedIn = (closed, open, ym) => {
  const banking = [...closed, ...open.filter((t) => Number(t.qtyExited) > 0)];
  const events = banking.flatMap((t) => {
    const evs = realisationEvents(t);
    if (evs.length) return evs;
    const d = t.exit_date || t.entry_date;
    if (!d) return [];
    return [{ date: String(d).slice(0, 10), pnl: t.pnl, r: t.r, trade: t,
              placedByEntry: !t.exit_date }];
  });
  const inMonth = events.filter((e) => !e.placedByEntry && e.date.slice(0, 7) === ym);
  return {
    pnl: inMonth.reduce((a, x) => a + (isFinite(x.pnl) ? x.pnl : 0), 0),
    n: new Set(inMonth.map((e) => e.trade?.id ?? e)).size,
    all: events.reduce((a, x) => a + (isFinite(x.pnl) ? x.pnl : 0), 0),
  };
};

test("selling out of a position you still hold is money banked this month", () => {
  /*
    KMEW, from the real book. 349 bought in June, sold down across June and
    July, 13 more sold on 3 September at 3103 for +₹13.6k, 126 still held.

    The position is `partial`, and the strip counted `closed` alone — so this
    sell, and every rupee ever banked out of a position still running, was
    missing from Realised Sep, Realised FY and Realised all-time. It sat in
    the row's Banked column, which is why it looked like it was counted.
  */
  const kmew = mk({ id: "kmew", symbol: "KMEW", side: "long", status: "partial",
    entry_date: "2026-06-17", entry_price: 2052.70, quantity: 349,
    stop_loss: 1993, stop_source: "recorded", charges: 0,
    exits: [
      { exit_date: "2026-06-22", quantity: 72, price: 2284.00, charges: 205 },
      { exit_date: "2026-07-13", quantity: 36, price: 2428.00, charges: 102 },
      { exit_date: "2026-07-23", quantity: 66, price: 2367.70, charges: 188 },
      { exit_date: "2026-07-24", quantity: 36, price: 2410.00, charges: 102 },
      { exit_date: "2026-09-03", quantity: 13, price: 3103.00, charges: 36.98 },
    ] });
  kmew.status = "partial";

  const sep = bankedIn([], [kmew], "2026-09");
  near(sep.pnl, 13 * (3103.00 - 2052.70) - 36.98, 1,
    "the September sell, to the rupee the detail panel shows");
  eq(sep.n, 1, "and it is one position banked from");

  /* The other months are its own too, and June's sell is not September's. */
  near(bankedIn([], [kmew], "2026-06").pnl, 72 * (2284.00 - 2052.70) - 205, 1);
  near(bankedIn([], [kmew], "2026-07").pnl,
    36 * (2428 - 2052.70) + 66 * (2367.70 - 2052.70) + 36 * (2410 - 2052.70)
    - (102 + 188 + 102), 1);

  /* Nothing unrealised leaks in: 126 shares are still held and marked at a
     profit, and none of that is realised money. */
  const soldOnly = 72 + 36 + 66 + 36 + 13;
  ok(soldOnly === 223 && kmew.qtyOpen === 126, "the fixture really is part-sold");
  near(sep.all, kmew.realisedPnl, 1, "all-time equals what the position banked");
});

test("a position with nothing sold yet contributes nothing", () => {
  const held = mk({ id: "h", symbol: "ABC", side: "long", status: "open",
    entry_date: "2026-09-01", entry_price: 100, quantity: 100,
    stop_loss: 93, stop_source: "recorded", charges: 0, exits: [] });
  held.status = "open";
  eq(bankedIn([], [held], "2026-09").pnl, 0, "an unsold holding banks nothing");
  eq(bankedIn([], [held], "2026-09").n, 0);
});
