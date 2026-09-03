import { test, eq, ok } from "./harness.mjs";
import { reconcile, assembleImport, toTradeRows } from "@/lib/import-pipeline";
import { isFlagged } from "@/lib/positions";

/**
 * THE ONE-DAY TYPO THAT LEAVES A POSITION OPEN FOREVER.
 *
 * A trade typed by hand and never exited, then a tax P&L months later that
 * contains the sale: it completes the trade only if the entry dates match to
 * the day. Type the 12th when the contract note says the 11th and the file is
 * inserted as a separate trade — a correct closed one, and the original left
 * open, holding stock that is gone. Nothing said so.
 *
 * These pin what the warning fires on, and — more important — what it stays
 * quiet about. A warning that cried duplicate on every repeat purchase would
 * be turned off within a week.
 */

const grp = (symbol, entryDate, exitDate = "2026-06-10") => ({
  symbol, entryDate, quantity: 100,
  tranches: [{ exit_date: exitDate, quantity: 100, price: 130, charges: 0 }],
});

const held = (symbol, entry_date, extra = {}) => ({
  id: `${symbol}-${entry_date}`, symbol, entry_date,
  quantity: 100, status: "open", broker: null, exits: [], ...extra,
});

test("a date one day out is flagged rather than silently duplicated", () => {
  const out = reconcile([grp("ABC", "2026-03-11")], [held("ABC", "2026-03-12")]);
  eq(out.completions.length, 0, "it cannot complete — the dates differ");
  eq(out.fresh.length, 1, "so it still imports, as its own trade");
  eq(out.fresh[0].openElsewhere.length, 1, "and it says what it sits beside");
  eq(out.fresh[0].openElsewhere[0].entry_date, "2026-03-12");
  eq(out.fresh[0].openElsewhere[0].quantity, 100);
});

test("an exact match completes and is never flagged", () => {
  const out = reconcile([grp("ABC", "2026-03-11")], [held("ABC", "2026-03-11")]);
  eq(out.completions.length, 1, "this is the path that works");
  eq(out.fresh.length, 0);
});

test("a closed position of the same name is not a near miss", () => {
  /* Buying a stock again after selling it is ordinary. Only a position still
     OPEN can be left stranded by the duplicate, and only those are worth
     interrupting for. */
  const out = reconcile([grp("ABC", "2026-03-11")],
    [held("ABC", "2024-01-05", { status: "closed" })]);
  eq(out.fresh.length, 1);
  ok(!out.fresh[0].openElsewhere, "a closed round-trip is not a duplicate");
});

test("a part-sold position still counts", () => {
  const out = reconcile([grp("ABC", "2026-03-11")],
    [held("ABC", "2026-03-12", { status: "partial" })]);
  eq(out.fresh[0].openElsewhere.length, 1, "it is still holding stock");
});

test("another broker's open position is not a near miss", () => {
  /* Two accounts holding the same stock is two positions, which is the same
     reason the matching itself refuses to cross brokers. */
  const out = reconcile([grp("ABC", "2026-03-11")],
    [held("ABC", "2026-03-12", { broker: "dhan" })], { broker: "zerodha" });
  eq(out.fresh.length, 1);
  ok(!out.fresh[0].openElsewhere, "different accounts, different positions");
});

test("a position this same file legitimately completed is not also a near miss", () => {
  /*
    Two buys in one name: one the file closes, one still running. The first
    group claims its target; the second must not then point at the position
    the first just completed. `claimed` is only final after the whole loop,
    which is why the flagging happens as a second pass.
  */
  const out = reconcile(
    [grp("ABC", "2026-03-11"), grp("ABC", "2026-05-02")],
    [held("ABC", "2026-03-11"), held("ABC", "2026-09-01")]);
  eq(out.completions.length, 1, "the first is completed");
  eq(out.fresh.length, 1, "the second is new");
  eq(out.fresh[0].openElsewhere.length, 1, "flagged against the STILL-open one");
  eq(out.fresh[0].openElsewhere[0].entry_date, "2026-09-01",
    "not against the one it just completed");
});

test("nothing to sit beside means nothing to say", () => {
  const out = reconcile([grp("ABC", "2026-03-11")], [held("XYZ", "2026-03-12")]);
  ok(!out.fresh[0].openElsewhere, "a different symbol is not a near miss");
  const none = reconcile([grp("ABC", "2026-03-11")], []);
  ok(!none.fresh[0].openElsewhere, "nor is an empty journal");
});

test("the warning survives the whole pipeline, not just reconcile", () => {
  /*
    Through the real entry point the preview calls, because the finding has to
    reach the screen to be worth anything: reconcile can be perfectly right
    and the key still be dropped by assembleImport or absent from the shape
    the render reads. That gap is exactly how the bars key and saveStops both
    shipped broken — correct logic behind a seam nothing exercised.
  */
  const lot = (symbol, entryDate, exitDate) => ({
    symbol, isin: `INE${symbol}`, section: "equity",
    entryDate, exitDate, quantity: 100,
    buyValue: 10000, sellValue: 13000, profit: 3000, charges: 120,
    holdingDays: 90,
  });

  const out = assembleImport(
    { lots: [lot("ABC", "2026-03-11", "2026-06-10")] },
    { targets: [held("ABC", "2026-03-12")], batchId: "b1", broker: "zerodha" });

  eq(out.trades.length, 1, "it imports");
  eq(out.nearMisses.length, 1, "and the preview is told what it lands beside");
  eq(out.nearMisses[0].symbol, "ABC");
  eq(out.nearMisses[0].entryDate, "2026-03-11", "the file's date");
  eq(out.nearMisses[0].openElsewhere[0].entry_date, "2026-03-12", "the journal's");

  /* And the clean case says nothing at all — an import that warns on every
     run is one nobody reads. */
  const clean = assembleImport(
    { lots: [lot("ABC", "2026-03-11", "2026-06-10")] },
    { targets: [], batchId: "b1", broker: "zerodha" });
  eq(clean.nearMisses.length, 0);
});

test("a rejected group is never warned about", () => {
  /* Nothing is written for it, so it cannot duplicate anything — and saying
     "this will import beside your open position" about a row that is being
     held back would be a plain lie. */
  const broken = {
    symbol: "ABC", isin: "INEABC", section: "equity",
    entryDate: "2026-03-11", exitDate: "2026-06-10", quantity: 100,
    buyValue: 10000, sellValue: 0, profit: 0, charges: 0, holdingDays: 90,
  };
  const out = assembleImport({ lots: [broken] },
    { targets: [held("ABC", "2026-03-12")], batchId: "b1", broker: "zerodha" });
  eq(out.rejected.length, 1, "no sell value, so it is held back");
  eq(out.trades.length, 0);
  eq(out.nearMisses.length, 0, "and not warned about");
});

/* ---------------- adopting a holding whose date was invented -------------- */

const holding = (symbol, entry_date, quantity, extra = {}) => ({
  id: `${symbol}-held`, symbol, entry_date, quantity, status: "open",
  broker: null, imported: true, entry_date_source: "assumed", exits: [], ...extra,
});

test("a tax P&L dates the holding it closes, however many buys built it", () => {
  /*
    THE CASE THE TRADEBOOK CANNOT REACH.

    500 shares from a holdings file, purchase date invented. Built over three
    buys, one of them before the tradebook's window, so FIFO refused to date
    it — correctly. When the position is finally sold, the tax P&L carries the
    real buy date on every lot, and the sale arrives as one group PER BUY DATE.

    All three must land on the one holding. The old matching saw three dates,
    none of them the invented one, and made three new trades beside a holding
    that stayed open forever.
  */
  const gs = [
    { symbol: "XYZ", entryDate: "2025-01-10", quantity: 200,
      tranches: [{ exit_date: "2026-07-01", quantity: 200, price: 150, charges: 30 }] },
    { symbol: "XYZ", entryDate: "2025-03-05", quantity: 200,
      tranches: [{ exit_date: "2026-07-01", quantity: 200, price: 150, charges: 30 }] },
    { symbol: "XYZ", entryDate: "2025-06-20", quantity: 100,
      tranches: [{ exit_date: "2026-07-02", quantity: 100, price: 152, charges: 15 }] },
  ];
  const out = reconcile(gs, [holding("XYZ", "2026-01-01", 500)], { broker: "zerodha" });

  eq(out.fresh.length, 0, "nothing is left to insert as a new trade");
  eq(out.completions.length, 1, "all three buys land on the one holding");
  const c = out.completions[0];
  eq(c.tranches.length, 3, "every sell comes across");
  eq(c.adding, 500, "the whole position");
  eq(c.adopts.to, "2025-01-10", "dated from the EARLIEST buy");
  eq(c.adopts.from, "2026-01-01", "replacing the invented one");
  eq(c.adopts.buys, 3);
  ok(!c.grow, "500 sold against 500 held needs no resizing");
});

test("one buy, or five, makes no difference", () => {
  const one = reconcile(
    [{ symbol: "XYZ", entryDate: "2025-04-02", quantity: 500,
       tranches: [{ exit_date: "2026-07-01", quantity: 500, price: 150, charges: 60 }] }],
    [holding("XYZ", "2026-01-01", 500)], { broker: "zerodha" });
  eq(one.completions[0].adopts.to, "2025-04-02");

  const five = reconcile(
    [1, 2, 3, 4, 5].map((i) => ({
      symbol: "XYZ", entryDate: `2025-0${i}-05`, quantity: 100,
      tranches: [{ exit_date: `2026-07-0${i}`, quantity: 100, price: 150, charges: 12 }],
    })),
    [holding("XYZ", "2026-01-01", 500)], { broker: "zerodha" });
  eq(five.completions.length, 1);
  eq(five.completions[0].tranches.length, 5);
  eq(five.completions[0].adopts.to, "2025-01-05", "still the earliest");
  eq(five.completions[0].adding, 500);
});

test("a date the trader recorded is never adopted over", () => {
  /* The whole licence for matching on symbol alone is that the date was
     invented by this app. A typed date is a fact and falls back to the
     warning, which is the case that must stay a hand edit. */
  const gs = [{ symbol: "XYZ", entryDate: "2025-01-10", quantity: 500,
    tranches: [{ exit_date: "2026-07-01", quantity: 500, price: 150, charges: 60 }] }];
  const out = reconcile(gs,
    [holding("XYZ", "2026-01-01", 500, { entry_date_source: "recorded", imported: false })],
    { broker: "zerodha" });
  eq(out.completions.length, 0, "no adoption");
  eq(out.fresh.length, 1, "it imports separately");
  eq(out.fresh[0].openElsewhere.length, 1, "and is warned about instead");
});

test("two assumed holdings in one symbol are left alone", () => {
  /* Which position the sells came out of is a real question now, and putting
     a year of holding on the wrong row is worse than leaving both flagged. */
  const gs = [{ symbol: "XYZ", entryDate: "2025-01-10", quantity: 200,
    tranches: [{ exit_date: "2026-07-01", quantity: 200, price: 150, charges: 30 }] }];
  const out = reconcile(gs, [
    { ...holding("XYZ", "2026-01-01", 200), id: "a" },
    { ...holding("XYZ", "2026-02-01", 300), id: "b" },
  ], { broker: "zerodha" });
  eq(out.completions.length, 0, "it refuses to pick");
  eq(out.fresh.length, 1);
  eq(out.fresh[0].openElsewhere.length, 2, "both are named in the warning");
});

test("an exact date match still wins, and is not double-claimed", () => {
  /* An assumed date that happens to be right must complete by the normal
     path, once — not complete AND adopt. */
  const gs = [{ symbol: "XYZ", entryDate: "2026-01-01", quantity: 500,
    tranches: [{ exit_date: "2026-07-01", quantity: 500, price: 150, charges: 60 }] }];
  const out = reconcile(gs, [holding("XYZ", "2026-01-01", 500)], { broker: "zerodha" });
  eq(out.completions.length, 1);
  ok(!out.completions[0].adopts, "already the right date — nothing to adopt");
  eq(out.fresh.length, 0);
});

test("a closed holding is not adopted, and neither is another broker's", () => {
  const gs = [{ symbol: "XYZ", entryDate: "2025-01-10", quantity: 500,
    tranches: [{ exit_date: "2026-07-01", quantity: 500, price: 150, charges: 60 }] }];
  eq(reconcile(gs, [holding("XYZ", "2026-01-01", 500, { status: "closed" })],
    { broker: "zerodha" }).completions.length, 0, "closed");
  eq(reconcile(gs, [holding("XYZ", "2026-01-01", 500, { broker: "dhan" })],
    { broker: "zerodha" }).completions.length, 0, "different account");
});

test("selling more than the holdings snapshot knew about resizes it", () => {
  /* A holdings file is a snapshot; shares bought after it was taken are not
     in it. The file that sells them is the fuller account, and the row is
     imported, so the same grow rule an exact match uses applies. */
  const gs = [{ symbol: "XYZ", entryDate: "2025-01-10", quantity: 800,
    tranches: [{ exit_date: "2026-07-01", quantity: 800, price: 150, charges: 90 }] }];
  const out = reconcile(gs, [holding("XYZ", "2026-01-01", 500)], { broker: "zerodha" });
  eq(out.completions.length, 1);
  eq(out.completions[0].grow.quantity, 800, "the position was bigger than recorded");
  eq(out.completions[0].adopts.to, "2025-01-10");
});

/* ------------- the flag that outlives the preview ------------------------ */

test("the finding is written onto the trade, not just announced", () => {
  const gs = [{ symbol: "ABC", entryDate: "2026-03-11", quantity: 100, entryPrice: 100,
    exitDate: "2026-06-10", exitPrice: 130, profit: 3000, charges: 100, lots: 1,
    tranches: [{ exit_date: "2026-06-10", quantity: 100, price: 130, charges: 100 }] }];
  const out = reconcile(gs, [held("ABC", "2026-03-12")]);
  const rows = toTradeRows(out.fresh, { batchId: "b1" });
  eq(rows[0].possible_duplicate_of, "ABC-2026-03-12",
    "the row carries which position it may be a copy of");

  /* And a clean import carries nothing, so the column stays meaningful. */
  const clean = toTradeRows(reconcile(gs, []).fresh, { batchId: "b1" });
  eq(clean[0].possible_duplicate_of, null);
});

test("acknowledging is what clears the flag, not the pointer going away", () => {
  /*
    Both halves matter. The pointer is kept as the record of what was noticed;
    only the acknowledgement hides it. Testing the pointer alone would relight
    every flag the trader has ever dismissed, on every reload.
  */
  const flagged = { possible_duplicate_of: "x", duplicate_ack_at: null };
  const acked = { possible_duplicate_of: "x", duplicate_ack_at: "2026-09-03T10:00:00Z" };
  const clean = { possible_duplicate_of: null, duplicate_ack_at: null };
  /* The third way it ends: 046 nulls the pointer when the position it names is
     deleted, which is the trader resolving it by removing the copy. */
  const deleted = { possible_duplicate_of: null, duplicate_ack_at: null };
  ok(isFlagged(flagged), "flagged");
  ok(!isFlagged(acked), "acknowledged");
  ok(!isFlagged(clean), "never flagged");
  ok(!isFlagged(deleted), "the twin was deleted");
  ok(!isFlagged(null) && !isFlagged(undefined), "and no row is not a flag");
});
