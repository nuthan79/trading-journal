import { test, eq, ok, near } from "./harness.mjs";
import { headline, byPeriod, equityCurve } from "@/lib/calc";
import { derivePosition, bankedEvents } from "@/lib/positions";

/**
 * MONEY COUNTS EVERY SELL. A VERDICT WAITS FOR THE POSITION TO FINISH.
 *
 * Two populations, and the split is the whole design. "How much did I bank"
 * does not wait for the rest of a position to be sold — the cash is in the
 * account. "Was that a win" does: the part still running can give it all
 * back, and a part-sold position counted as a winner flatters win rate,
 * expectancy, profit factor and payoff all at once.
 *
 * The trap underneath is that `pnl` on a part-sold position is realised PLUS
 * unrealised, so any figure that reaches for it books the mark-to-market on
 * shares still held as money banked. Harmless while only closed positions
 * were counted; live from the moment partials are.
 */

const mk = (t) => {
  const d = derivePosition(t, 5e6);
  return { ...t, ...d, status: t.status, exits: t.exits };
};

/* Bought 100 at 100, sold 40 at 150 (banked 2000), 60 still held and marked
   at 200 — so 6000 of unrealised sits on it, and none of it is banked. */
const PART = mk({ id: "part", symbol: "PART", side: "long", status: "partial",
  entry_date: "2026-06-01", entry_price: 100, quantity: 100,
  stop_loss: 90, stop_source: "recorded", charges: 0, last_price: 200,
  exits: [{ exit_date: "2026-09-10", quantity: 40, price: 150, charges: 0 }] });

const DONE = mk({ id: "done", symbol: "DONE", side: "long", status: "closed",
  entry_date: "2026-06-01", entry_price: 100, quantity: 100,
  stop_loss: 90, stop_source: "recorded", charges: 0,
  exit_date: "2026-09-12", exit_price: 130,
  exits: [{ exit_date: "2026-09-12", quantity: 100, price: 130, charges: 0 }] });

test("the fixture really is part-sold and carrying unrealised money", () => {
  near(PART.realisedPnl, 2000, 0.01);
  near(PART.unrealisedPnl, 6000, 0.01);
  near(PART.pnl, 8000, 0.01, "pnl folds the two together — this is the trap");
});

test("banked money is realised only, never the mark on what is still held", () => {
  const evs = bankedEvents(PART);
  near(evs.reduce((a, e) => a + e.pnl, 0), 2000, 0.01,
    "2000 banked, not the 8000 that pnl reports");
});

test("a part-sold position's sell reaches net P&L and the equity curve", () => {
  const h = headline([DONE], { openingCapital: 5e6, banking: [DONE, PART] });
  near(h.netPnl, 3000 + 2000, 0.01, "both sells, and only the sold parts");
  near(equityCurve([DONE, PART], { openingCapital: 5e6 }).netPnl, 5000, 0.01);
});

test("but it does not get counted as a win", () => {
  const h = headline([DONE], { openingCapital: 5e6, banking: [DONE, PART] });
  eq(h.n, 1, "one finished position");
  near(h.winRateByCount, 100, 0.01, "the verdict population is the closed one");
  /* The giveaway if the split ever collapses: two positions would make this
     2, and PART would be voting on a win rate it has not earned. */
  ok(h.n === 1, "a part-sold position has no verdict yet");
});

test("with no banking set given, nothing changes", () => {
  /* Every existing caller passes none, and must behave exactly as before. */
  const a = headline([DONE], { openingCapital: 5e6 });
  const b = headline([DONE], { openingCapital: 5e6, banking: [] });
  near(a.netPnl, 3000, 0.01);
  near(b.netPnl, 3000, 0.01);
});

test("a period reports the money that arrived in it", () => {
  const rows = byPeriod([DONE, PART], "month",
    { openingCapital: 5e6, basis: "exit" });
  const sep = rows.find((r) => r.key.startsWith("Sep"));
  near(sep.pnl, 5000, 0.01, "both September sells");
  eq(sep.trades, 2, "two positions banked money in September");
});

test("grouping by ENTRY date does not fold in the open mark either", () => {
  /*
    The entry-basis view asks what positions opened in a period have made. On
    a part-sold position `pnl` moves every time a quote refreshes, so a period
    built on it would change without a trade being made.
  */
  const rows = byPeriod([PART], "month", { openingCapital: 5e6, basis: "entry" });
  const jun = rows.find((r) => r.key.startsWith("Jun"));
  near(jun.pnl, 2000, 0.01, "realised, not the 8000 that includes the mark");
});

test("the Dashboard, the period table and the strip land on one number", () => {
  /*
    THE PROPERTY THIS WHOLE CHANGE EXISTS FOR.

    Three screens add up the same book three ways, and the trader reconciles
    them by hand. Before this they disagreed by exactly whatever was banked
    out of positions still running — the Holdings strip counted it, the other
    two did not, and each was individually defensible.
  */
  const book = [DONE, PART];
  const strip = book.flatMap(bankedEvents)
    .reduce((a, e) => a + (isFinite(e.pnl) ? e.pnl : 0), 0);
  const dash = headline([DONE], { openingCapital: 5e6, banking: book }).netPnl;
  const periods = byPeriod(book, "fy", { openingCapital: 5e6, basis: "exit" })
    .reduce((a, r) => a + (isFinite(r.pnl) ? r.pnl : 0), 0);

  near(strip, 5000, 0.01);
  near(dash, strip, 0.01, "Dashboard net P&L equals the strip's realised");
  near(periods, strip, 0.01, "and so does the period table, summed");

  /* At every grain, since a position sold across a boundary is where these
     have come apart before. */
  for (const grain of ["month", "quarter", "fy"]) {
    near(byPeriod(book, grain, { openingCapital: 5e6, basis: "exit" })
      .reduce((a, r) => a + (isFinite(r.pnl) ? r.pnl : 0), 0), strip, 0.01, grain);
  }
});

test("charges reconcile across the same three routes", () => {
  /* The figure that read ₹0 on a book that had paid lakhs, checked again now
     that the population it is summed over has changed underneath it. */
  const charged = mk({ id: "c", symbol: "CHG", side: "long", status: "partial",
    entry_date: "2026-06-01", entry_price: 100, quantity: 100,
    stop_loss: 90, stop_source: "recorded", charges: 0, last_price: 200,
    exits: [{ exit_date: "2026-09-10", quantity: 40, price: 150, charges: 275 }] });
  const book = [DONE, charged];
  near(headline([DONE], { openingCapital: 5e6, banking: book }).charges, 275, 0.01);
  near(byPeriod(book, "fy", { openingCapital: 5e6, basis: "exit" })
    .reduce((a, r) => a + (isFinite(r.charges) ? r.charges : 0), 0), 275, 0.01);
});
