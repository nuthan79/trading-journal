/**
 * EVERY TOTAL MUST STILL AGREE WITH EVERY OTHER TOTAL.
 *
 * The tranche split re-bucketed money across periods, and the first version of
 * it lost money three ways at once: it read `charges` off a DERIVED trade,
 * where that field already means the total of both charge kinds, and so
 * subtracted the exit charges twice; it silently dropped tranches it could not
 * date; and its own probe fixture described a position whose P&L disagreed
 * with its own charges, so the probe passed on the broken behaviour. Periods
 * came out ₹530 short on a ₹12,670 book and nothing else complained.
 *
 * What makes that class dangerous is that the ALL-TIME totals stayed right —
 * so the three-screen reconciliation a user does by hand would have gone on
 * passing while every period was wrong.
 *
 * So this file does not test a function. It builds a book shaped like a real
 * one and insists every way the app has of adding it up lands on one number.
 */

import { test, ok, near } from "./harness.mjs";
import { derivePosition, realisationEvents } from "@/lib/positions";
import { byPeriod, headline, equityCurve, stats } from "@/lib/calc";
import { matchesRule } from "@/lib/filters";

const mk = (id, o) => {
  const t = { id, symbol: "X", side: "long", status: "closed", entry_date: "2024-05-01",
    entry_price: 100, quantity: 100, stop_loss: 93, stop_source: "recorded",
    charges: 0, ...o };
  /* The DB trigger mirrors the LAST sell onto the row; a fixture without it is
     not shaped like anything the app ever sees, and the first version of this
     failed on that alone. */
  const last = (t.exits || []).filter((e) => e.exit_date).slice(-1)[0];
  if (last) { t.exit_date = last.exit_date; t.exit_price = last.price; }
  const d = derivePosition(t, 5e6);
  return { ...t, ...d, status: "closed", exits: d.exits };
};

const book = [];
for (let i = 0; i < 40; i++) {
  const spans = i % 4 === 0;          // sold either side of a boundary
  const stopless = i % 7 === 0;       // no R at all
  book.push(mk(`t${i}`, {
    entry_price: 100 + i,
    stop_loss: stopless ? null : (100 + i) * 0.93,
    stop_source: stopless ? "none" : "recorded",
    charges: i * 3,
    exits: spans
      ? [{ exit_date: `2025-0${(i % 3) + 1}-15`, quantity: 40, price: 100 + i * 1.4, charges: i },
         { exit_date: `2025-0${(i % 4) + 5}-20`, quantity: 60, price: 100 + i * 1.6, charges: i }]
      : [{ exit_date: `2025-0${(i % 6) + 5}-11`, quantity: 100,
           price: 100 + i * (i % 3 ? 1.3 : 0.8), charges: i * 2 }],
  }));
}
/* One that cannot be split at all — an undated tranche. It must still be
   counted, through the whole-trade fallback. */
book.push(mk("unsplittable", { exits: [
  { exit_date: "2025-06-10", quantity: 50, price: 130, charges: 0 },
  { exit_date: null, quantity: 50, price: 140, charges: 0 }] }));

const bookPnl = book.reduce((a, t) => a + (isFinite(t.pnl) ? t.pnl : 0), 0);
const bookR = book.reduce((a, t) => a + (isFinite(t.r) ? t.r : 0), 0);

test("every way of adding the book up lands on the same number", () => {
  ok(isFinite(bookPnl) && bookPnl !== 0, `the fixture is broken: ${bookPnl}`);
  ok(book.length > 30, `only ${book.length} positions — too thin to mean anything`);

  for (const g of ["month", "quarter", "fy"]) {
    const rows = byPeriod(book, g, { openingCapital: 5e6, basis: "exit" });
    ok(rows.length > 1, `${g} produced one bucket — the split is not being exercised`);
    near(rows.reduce((a, r) => a + r.pnl, 0), bookPnl, 0.01, `${g} money`);
    near(rows.reduce((a, r) => a + (isFinite(r.totalR) ? r.totalR : 0), 0), bookR, 1e-6, `${g} R`);
  }

  near(byPeriod(book, "fy", { openingCapital: 5e6, basis: "entry" })
        .reduce((a, r) => a + r.pnl, 0), bookPnl, 0.01, "entry basis");

  const curve = equityCurve(book, { openingCapital: 5e6, flows: [] });
  near(curve.final - 5e6, bookPnl, 0.01, "the curve must END where the book does");
  near(curve.netPnl, bookPnl, 0.01, "curve netPnl");
  near(headline(book, { openingCapital: 5e6, flows: [] }).netPnl, bookPnl, 0.01, "headline");
  near(stats(book).totalR, bookR, 1e-6, "stats totalR");
});

test("no position loses money in the split", () => {
  let split = 0;
  for (const t of book) {
    const evs = realisationEvents(t);
    if (!evs.length) continue;
    split++;
    near(evs.reduce((a, e) => a + e.pnl, 0), t.realisedPnl, 0.005, `${t.id} money`);
    if (isFinite(t.realisedR)) {
      near(evs.reduce((a, e) => a + e.r, 0), t.realisedR, 1e-9, `${t.id} R`);
    }
  }
  ok(split > 30, `only ${split} positions were splittable — the check is hollow`);
});

test("on a position sold once, the two date questions give one answer", () => {
  /* soldOn earns its place by differing on TRANCHED positions. Differing on
     single-sell ones too would make it a second, wronger exit date. */
  const r = { op: "between", value: "2025-01-01", value2: "2025-12-31" };
  let checked = 0;
  for (const t of book) {
    if ((t.exits || []).length !== 1) continue;
    checked++;
    ok(matchesRule(t, { ...r, field: "soldOn" })
       === matchesRule(t, { ...r, field: "exit_date" }),
       `${t.id}: soldOn and exit_date disagree on a single-sell position`);
  }
  ok(checked > 5, `only ${checked} single-sell positions in the fixture`);
});
