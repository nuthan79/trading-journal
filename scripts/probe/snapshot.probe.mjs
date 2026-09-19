import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq, near } from "./harness.mjs";
import { brokerFamily, sameBroker, isHoldingsSnapshot, snapshotDay } from "@/lib/brokerFamily";
import { snapshotFit, reconcile } from "@/lib/import-pipeline";
import { soldSinceSnapshot } from "@/lib/snapshots";
import * as tb from "@/lib/brokers/zerodha-tradebook";
import { parseCsv } from "@/lib/import";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * HOLDINGS SNAPSHOTS AGAINST THE SALES THAT FOLLOWED THEM.
 *
 * From a real book (numbers only): a Zerodha holdings file imported on
 * 3 September, then a tax P&L to 19 September. Six of its eleven holdings
 * were sold, to the share, in between — and all six stayed open beside their
 * closed copies, because the holdings rows said `zerodha_holdings` and the
 * sales said `zerodha`, and "never merge across brokers" read those as two.
 *
 * YATHARTH: bought 907 on 24 Aug at ₹861.55, 502 sold that day, 405 held on
 * 3 Sep, 405 sold on 16 Sep. KMEW: 139 held, 13 sold on 3 Sep itself, 126
 * after. CMPDI: 729 held, nothing sold since.
 */
/* Midday UTC, so the local day is the 3rd in India and in New York alike. */
const SNAP_AT = "2026-09-03T06:00:00Z";
const holding = (symbol, quantity, price, o = {}) => ({
  id: `h-${symbol}`, symbol, quantity, entry_price: price, status: "open",
  entry_date: "2026-09-03", entry_date_source: "assumed", imported: true,
  broker: "zerodha_holdings", created_at: SNAP_AT, exits: [], ...o,
});

/* ---- one broker, several labels ------------------------------------- */

test("the holdings and tradebook adapters are the same broker as the tax P&L", () => {
  eq(brokerFamily("zerodha_holdings"), "zerodha");
  eq(brokerFamily("zerodha_tradebook"), "zerodha");
  ok(sameBroker("zerodha_holdings", "zerodha"), "the comparison that produced the copies");
  ok(!sameBroker("zerodha", "dhan"), "two real brokers still never merge");
  ok(sameBroker(null, "dhan"), "a hand-entered trade still matches either way");
});

test("a holdings row is recognised as a snapshot, dated by when it was imported", () => {
  ok(isHoldingsSnapshot(holding("X", 1, 1)));
  ok(!isHoldingsSnapshot({ broker: "zerodha" }));
  eq(snapshotDay(holding("X", 1, 1)), "2026-09-03");
  eq(snapshotDay(holding("X", 1, 1, { entry_date: "2026-08-24", entry_date_source: "recorded" })),
    "2026-09-03", "a tradebook re-dating it does not move the snapshot day");
});

/* ---- sizing a snapshot ---------------------------------------------- */

test("YATHARTH: an earlier sell adds to the purchase, a later one comes out of it", () => {
  const fit = snapshotFit(holding("YATHARTH", 405, 861.55), [
    { exit_date: "2026-08-24", quantity: 502, buyPrice: 861.55 },
    { exit_date: "2026-09-16", quantity: 405, buyPrice: 861.55 },
  ]);
  eq(fit.quantity, 907, "405 held + 502 sold before = 907 bought — and all 907 sold");
  near(fit.entry_price, 861.55, 1e-6);
});

test("a snapshot taken AFTER the sells keeps the shares still held", () => {
  /* The bug the file-based rule had: resize to what was sold, close the
     position, and the 405 still held vanish. */
  const fresh = holding("YATHARTH", 405, 861.55, { created_at: "2026-09-19T06:00:00Z" });
  const fit = snapshotFit(fresh, [
    { exit_date: "2026-08-24", quantity: 502, buyPrice: 861.55 },
    { exit_date: "2026-09-16", quantity: 405, buyPrice: 861.55 },
  ]);
  eq(fit.quantity, 405 + 907, "1,312 bought; 907 sold; 405 still open");
});

test("a sell on the snapshot day itself came out of the snapshot", () => {
  /* KMEW reconciled to the share only this way: 13 + 126 = 139. */
  const fit = snapshotFit(holding("KMEW", 139, 2052.7), [
    { exit_date: "2026-09-03", quantity: 13, buyPrice: 2052.7 },
    { exit_date: "2026-09-10", quantity: 126, buyPrice: 2052.7 },
  ]);
  eq(fit.quantity, 139, "nothing added — all of it was in the snapshot");
});

test("more sold since than the snapshot held is refused, not guessed", () => {
  eq(snapshotFit(holding("X", 100, 10), [{ exit_date: "2026-09-10", quantity: 150, buyPrice: 10 }]), null);
});

test("earlier sells at a different price re-price the position by weight", () => {
  const fit = snapshotFit(holding("X", 100, 10), [{ exit_date: "2026-08-01", quantity: 100, buyPrice: 20 }]);
  eq(fit.quantity, 200);
  near(fit.entry_price, 15, 1e-9);
});

/* ---- the importer, end to end ---------------------------------------- */

const group = (symbol, entryDate, entryPrice, tranches) => ({
  symbol, entryDate, entryPrice, quantity: tranches.reduce((a, t) => a + t.quantity, 0),
  tranches: tranches.map((t) => ({ price: 0, charges: 0, ...t })),
});

test("a tax P&L now closes the holding it sold, instead of adding a copy", () => {
  const out = reconcile(
    [group("YATHARTH", "2026-08-24", 861.55, [
      { exit_date: "2026-08-24", quantity: 502 }, { exit_date: "2026-09-16", quantity: 405 }])],
    [holding("YATHARTH", 405, 861.55)], { broker: "zerodha" });
  eq(out.fresh.length, 0, "no new trade");
  eq(out.completions.length, 1, "the holding is completed");
  const c = out.completions[0];
  eq(c.grow.quantity, 907);
  eq(c.adopts.to, "2026-08-24", "and it takes the real buy date");
});

test("a purchase sold entirely before the snapshot stays a trade of its own", () => {
  /* CMPDI: 2,284 bought 21 Jul and sold before 3 Sep; the 729 held are other
     shares. Joining them would put two trades under one entry date. */
  const out = reconcile(
    [group("CMPDI", "2026-07-21", 250, [{ exit_date: "2026-08-10", quantity: 2284 }])],
    [holding("CMPDI", 729, 263.05)], { broker: "zerodha" });
  eq(out.fresh.length, 1, "inserted as its own closed trade");
  eq(out.completions.length, 0, "the holding is untouched");
});

/* ---- the book already carrying copies --------------------------------- */

const closed = (symbol, entry, exits, o = {}) => ({
  id: `c-${symbol}-${entry}`, symbol, entry_date: entry, status: "closed",
  imported: true, broker: "zerodha", quantity: exits.reduce((a, e) => a + e.quantity, 0),
  exits, ...o,
});

test("the real book: six stale holdings found, the genuinely held one left alone", () => {
  const book = [
    holding("YATHARTH", 405, 861.55), holding("KMEW", 139, 2052.7), holding("CMPDI", 729, 263.05),
    closed("YATHARTH", "2026-08-24", [{ exit_date: "2026-08-24", quantity: 502 }, { exit_date: "2026-09-16", quantity: 405 }]),
    closed("KMEW", "2026-06-17", [{ exit_date: "2026-08-01", quantity: 210 }, { exit_date: "2026-09-03", quantity: 13 }, { exit_date: "2026-09-10", quantity: 126 }]),
    closed("CMPDI", "2026-07-21", [{ exit_date: "2026-08-10", quantity: 2284 }]),
  ];
  const plan = soldSinceSnapshot(book);
  eq(plan.map((p) => `${p.symbol}:${p.action}`).sort().join(","), "KMEW:remove,YATHARTH:remove");
  eq(plan.find((p) => p.symbol === "YATHARTH").heir, "c-YATHARTH-2026-08-24", "its diary moves to the closed trade");
});

test("partly sold since: the holding shrinks to what is still held", () => {
  const plan = soldSinceSnapshot([
    holding("X", 1000, 10), closed("X", "2026-08-01", [{ exit_date: "2026-09-10", quantity: 400 }])]);
  eq(plan[0].action, "shrink");
  eq(plan[0].quantity, 600);
  eq(plan[0].stillHeld, 600);
});

test("more sold since than held is reported and never acted on", () => {
  const plan = soldSinceSnapshot([
    holding("X", 100, 10), closed("X", "2026-08-01", [{ exit_date: "2026-09-10", quantity: 150 }])]);
  eq(plan[0].action, "unclear");
  ok(!read("lib/db.js").match(/p\.action === "unclear"/), "the writer has no branch for it");
});

test("another broker's sales are never evidence against a holding", () => {
  const plan = soldSinceSnapshot([
    holding("X", 100, 10), closed("X", "2026-08-01", [{ exit_date: "2026-09-10", quantity: 100 }], { broker: "dhan" })]);
  eq(plan.length, 0);
});

test("a purchase made after the snapshot is not the snapshot's shares", () => {
  const plan = soldSinceSnapshot([
    holding("X", 100, 10), closed("X", "2026-09-05", [{ exit_date: "2026-09-10", quantity: 100 }])]);
  eq(plan.length, 0);
});

/* ---- the tradebook as CSV --------------------------------------------- */

test("a Zerodha tradebook CSV is recognised and read", () => {
  const rows = parseCsv([
    "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time",
    "YATHARTH,INE0XXXX0000,2026-08-24,NSE,EQ,EQ,buy,false,907.000000,861.550000,1,1,2026-08-24T09:20:00",
    "YATHARTH,INE0XXXX0000,2026-08-24,NSE,EQ,EQ,sell,false,502.000000,909.700000,2,2,2026-08-24T14:20:00",
  ].join("\n"));
  ok(tb.detectRows(rows), "detected from its header");
  eq(tb.parseRows(rows).trades.length, 2);
  ok(/if \(zerodhaTradebook\.detectRows\(rows\)\) broker = zerodhaTradebook;/.test(read("components/ImportTrades.jsx")),
    "and the import screen's CSV branch asks for it");
});

test("the collision check groups brokers the way the importer does", () => {
  ok(/const b = brokerFamily\(t\.broker\);/.test(read("lib/analysis.js")));
});

/**
 * VBL, from the live book (ids replaced). DK5510 held 637 on 3 Sep; the
 * journal already carried 306 of them as other rows, so the holdings import
 * wrote the 331 remainder. The 306 sold on 10 Sep were those rows' shares.
 * The tidy-up counted them against the holding and trimmed it to 25; 331 was
 * right. A holding that shared its day with other rows is now left alone.
 */
test("VBL: a holding that is only the remainder is never trimmed by other rows' sells", () => {
  const h = holding("VBL", 331, 520, { entry_date: "2024-12-03", entry_date_source: "recorded",
                                       created_at: "2026-09-03T05:59:00Z" });
  const earlier = closed("VBL", "2024-12-03", [{ exit_date: "2025-03-03", quantity: 9 }, { exit_date: "2026-09-10", quantity: 97 }],
                         { id: "c-a", created_at: "2026-09-03T04:16:00Z" });
  const b = closed("VBL", "2024-12-18", [{ exit_date: "2026-09-10", quantity: 153 }], { id: "c-b", created_at: "2026-09-18T18:59:00Z" });
  const c = closed("VBL", "2024-12-20", [{ exit_date: "2026-09-10", quantity: 56 }], { id: "c-c", created_at: "2026-09-18T18:59:00Z" });
  eq(soldSinceSnapshot([h, earlier, b, c]).length, 0, "331 stays 331");
});

test("the six real removals still qualify: no other row held them that day", () => {
  const plan = soldSinceSnapshot([
    holding("YATHARTH", 405, 861.55),
    closed("YATHARTH", "2026-08-24", [{ exit_date: "2026-08-24", quantity: 502 }, { exit_date: "2026-09-16", quantity: 405 }],
           { created_at: "2026-09-18T18:59:00Z" }),
  ]);
  eq(plan.map((p) => p.action).join(), "remove");
});

test("a row with no creation time is never judged", () => {
  const plan = soldSinceSnapshot([
    holding("X", 100, 10, { created_at: null, entry_date_source: "assumed" }),
    closed("X", "2026-08-01", [{ exit_date: "2026-09-10", quantity: 100 }]),
  ]);
  eq(plan.length, 0);
});
