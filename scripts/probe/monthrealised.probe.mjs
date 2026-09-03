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
