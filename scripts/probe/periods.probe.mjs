import { test, eq, ok, near } from "./harness.mjs";
import { byPeriod, fyLabel } from "@/lib/calc";
import { derivePosition, realisationEvents } from "@/lib/positions";

/* A position bought once and sold in tranches, some either side of 1 April. */
const pos = (id, entry, qty, stop, sells) => {
  const t = { id, symbol: "PGEL", side: "long", status: "closed",
    entry_date: "2024-05-28", entry_price: entry, quantity: qty,
    stop_loss: stop, stop_source: "recorded", charges: 0,
    exits: sells.map(([d, q, p], i) => ({ exit_date: d, quantity: q, price: p, charges: 0 })) };
  t.exit_date = sells[sells.length - 1][0];
  t.exit_price = sells[sells.length - 1][2];
  return { ...t, ...derivePosition(t, 5e6), status: "closed", exits: t.exits };
};

/* Sold across the FY boundary: 349 in Nov 2024 (FY24-25), the rest in 2025-26. */
const SPLIT = pos("pgel", 253.60, 1060, 235, [
  ["2024-11-19", 349, 691.55],
  ["2025-05-07", 216, 817.45],
  ["2025-08-28", 495, 768.40],
]);
/* And one that closed entirely inside one year. */
const WHOLE = pos("clean", 100, 100, 93, [["2025-06-10", 100, 130]]);

test("the tranches add back to the position, to the rupee", () => {
  /* The property everything else rests on: if the parts do not sum to the
     whole, a year's rows stop summing to the all-time total — and that total
     is the one figure three screens already agree on. */
  for (const p of [SPLIT, WHOLE]) {
    const evs = realisationEvents(p);
    near(evs.reduce((a, e) => a + e.pnl, 0), p.realisedPnl, 0.01, `${p.id} money`);
    near(evs.reduce((a, e) => a + e.r, 0), p.realisedR, 1e-6, `${p.id} R`);
  }
});

test("position-level charges are split across the sells, not dumped on one", () => {
  const withCharges = pos("chg", 100, 100, 93, [
    ["2025-06-10", 40, 130], ["2025-07-10", 60, 140],
  ]);
  withCharges.charges = 1000;
  const evs = realisationEvents(withCharges);
  /* 40/100 and 60/100 of the trade-level charge. Anything else still sums,
     but puts money in the wrong period on a boundary-spanning position. */
  near(evs[0].pnl, (130 - 100) * 40 - 400, 0.01);
  near(evs[1].pnl, (140 - 100) * 60 - 600, 0.01);
});

test("money lands in the year it was realised, not the year the position closed", () => {
  /* The bug: exit_date is the LAST tranche, so all of this landed in FY25-26. */
  const rows = byPeriod([SPLIT], "fy", { openingCapital: 5e6, basis: "exit" });
  eq(rows.length, 2, "a position sold across a boundary appears in both years");

  const earlier = rows.find((r) => r.key === fyLabel("2024-11-19"));
  const later = rows.find((r) => r.key === fyLabel("2025-05-07"));
  ok(earlier && later, rows.map((r) => r.key).join(", "));

  const novPnl = (691.55 - 253.60) * 349;
  near(earlier.pnl, novPnl, 1, "the November sell belongs to FY24-25");
  ok(earlier.pnl > 0 && later.pnl > 0);

  /* And the two together are still the position's whole result. */
  near(earlier.pnl + later.pnl, SPLIT.realisedPnl, 0.01, "periods must sum to the position");
  near(earlier.totalR + later.totalR, SPLIT.realisedR, 1e-6, "and so must R");

  /* Counted in both, which is the honest answer — it really was in both. */
  eq(earlier.trades, 1);
  eq(later.trades, 1);
});

test("every period still sums to the all-time total", () => {
  /* The reconciliation the user checked by hand across three screens. If this
     breaks, the fix has moved money rather than re-bucketed it. */
  const book = [SPLIT, WHOLE];
  const allTime = book.reduce((a, t) => a + t.realisedPnl, 0);
  for (const grain of ["month", "quarter", "fy"]) {
    const rows = byPeriod(book, grain, { openingCapital: 5e6, basis: "exit" });
    near(rows.reduce((a, r) => a + r.pnl, 0), allTime, 0.01, `${grain} money`);
    near(rows.reduce((a, r) => a + r.totalR, 0),
         book.reduce((a, t) => a + t.realisedR, 0), 1e-6, `${grain} R`);
  }
});

test("a position sold twice in one period is one result there, not two", () => {
  /* Win rate answers "did this position make money in this period" — a
     question about a trade. Counting sells would make scaling out of one
     winner look like several wins. */
  const twice = pos("twice", 100, 100, 93, [
    ["2025-06-10", 50, 130], ["2025-06-20", 50, 140],
  ]);
  const [row] = byPeriod([twice], "month", { openingCapital: 5e6, basis: "exit" });
  eq(row.trades, 1, "one position, two sells");
  eq(row.n, 1, "and one result for the win rate");
  eq(row.winRate, 100);
});

test("the entry basis is untouched — a decision happens once", () => {
  const rows = byPeriod([SPLIT], "fy", { openingCapital: 5e6, basis: "entry" });
  eq(rows.length, 1, "grouped by when it was taken, not by the sells that followed");
  near(rows[0].pnl, SPLIT.pnl, 0.01);
});

test("a legacy row with no tranches still appears", () => {
  /* A trade whose exits never landed must not vanish from the table. */
  const bare = { id: "bare", status: "closed", side: "long", entry_date: "2025-05-01",
    exit_date: "2025-06-01", entry_price: 100, quantity: 10, pnl: 500, r: 1.2, exits: [] };
  const rows = byPeriod([bare], "fy", { openingCapital: 5e6, basis: "exit" });
  eq(rows.length, 1);
  near(rows[0].pnl, 500, 0.01);
});
