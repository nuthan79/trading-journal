import { test, eq, ok } from "./harness.mjs";
import { reconcile, assembleImport } from "@/lib/import-pipeline";

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
