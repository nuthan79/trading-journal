import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq, near } from "./harness.mjs";
import * as swingbot from "@/lib/brokers/swingbot";
import { toJournalRows } from "@/lib/journalImport";
import { parseCsv } from "@/lib/import";
import { PATTERNS, EXIT_REASONS } from "@/lib/constants";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * SWINGBOT'S TWO FILES — the bot's own closed book and what it still holds.
 *
 * The rows below are its real output, unchanged. The figure worth pinning is
 * the stop: the closed file has no stop column, and the whole value of
 * importing a bot's book is that R means something, so the stop is worked
 * back out of pnl and R. Get that arithmetic wrong in either direction and
 * every R in the journal is a different number from every R in the file,
 * which is the one thing nobody would think to check.
 */
const CLOSED = `symbol,pattern,entry_date,exit_date,entry,exit,qty,reason,score,gate_ok,bars,pnl,R,pct,mae_R,mfe_R
gvt&d,darvas_box,2026-06-18,2026-07-03,5257.88,4574.13,27,stop,3,False,10,-18461.0,-1.01,-13.0,-1.39,0.58
cupid,high_tight_flag,2026-06-11,2026-09-04,155.41,282.73,429,time stop,3,False,60,54617.0,2.91,81.92,-0.07,3.29
lloydsme,flat_base,2026-07-21,2026-08-21,1939.3,1863.1,69,close below 50 SMA,3,True,23,-5258.0,-0.28,-3.93,-0.33,0.69`;

const OPEN = `symbol,pattern,entry_date,entry,qty,stop,score,bars,mae_R,mfe_R
acmesolar,darvas_box,2026-09-04,418.63,442,376.3,5,9,-0.6857797623266471,0.5214874666288652
welcorp,high_tight_flag,2026-07-09,1604.3,65,1320.0,3,50,-0.13402204726403616,4.152252254945735`;

const closedRows = parseCsv(CLOSED);
const openRows = parseCsv(OPEN);

test("each file is recognised as its own, and nothing else is", () => {
  eq(swingbot.fileKind(closedRows), "closed");
  eq(swingbot.fileKind(openRows), "open");
  /* A Kite holdings CSV has symbol and quantity too. Claiming it would import
     a holdings snapshot as a bot's book, with no stops and no patterns. */
  eq(swingbot.fileKind(parseCsv("Symbol,ISIN,Sector,Quantity Available,Average Price\nX,IN1,IT,5,10")), null);
  eq(swingbot.fileKind(parseCsv("symbol,trade_date,trade_type,quantity,price\nX,2026-01-01,buy,5,10")), null);
});

test("the closed file: one full exit per position, with the bot's own reason", () => {
  const { positions } = swingbot.parseRows(closedRows);
  eq(positions.length, 3);
  const [g, c, l] = positions;
  eq(g.symbol, "GVT&D"); eq(g.entryDate, "2026-06-18"); eq(g.quantity, 27);
  eq(g.exits.length, 1);
  eq(g.exits[0].exit_date, "2026-07-03");
  near(g.exits[0].price, 4574.13, 1e-9);
  eq(g.exitReason, "Stop hit");
  eq(c.exitReason, "Time stop");
  eq(l.exitReason, "Breached 50 SMA");
});

test("the stop comes back out of pnl and R, and R survives the round trip", () => {
  const { positions } = swingbot.parseRows(closedRows);
  for (const [p, pnl, R] of [[positions[0], -18461, -1.01],
                             [positions[1], 54617, 2.91],
                             [positions[2], -5258, -0.28]]) {
    const perShare = p.entryPrice - p.stop;
    ok(p.stop > 0 && p.stop < p.entryPrice, `${p.symbol}: a stop below the entry`);
    /* R as the app will compute it: P&L over the risk the stop defines. */
    near(pnl / (perShare * p.quantity), R, 0.005);
  }
});

test("a row with no R keeps its honesty: no stop invented", () => {
  const { positions } = swingbot.parseRows(parseCsv(
    `symbol,pattern,entry_date,exit_date,entry,exit,qty,reason,score,gate_ok,bars,pnl,R,pct,mae_R,mfe_R
x,vcp,2026-01-01,2026-02-01,100,110,10,stop,3,True,20,100.0,0,10,0,0`));
  eq(positions.length, 1);
  eq(positions[0].stop, 0);
});

test("the open file: the stop is read straight off it, and nothing is sold", () => {
  const { positions } = swingbot.parseRows(openRows);
  eq(positions.length, 2);
  eq(positions[0].symbol, "ACMESOLAR");
  near(positions[0].stop, 376.3, 1e-9);
  eq(positions[0].exits.length, 0);
  eq(positions[1].pattern, "High Tight Flag");
});

test("patterns land on names the app groups by", () => {
  const { positions } = swingbot.parseRows(closedRows);
  for (const p of positions) ok(PATTERNS.includes(p.pattern), `${p.pattern} is a known pattern`);
  ok(PATTERNS.includes("Darvas Box"), "the bot's own base has a name, not 'Other'");
  ok(EXIT_REASONS.includes("Breached 50 SMA"));
});

test("rows reach the journal writer closed, stopped and recorded", () => {
  const { positions } = swingbot.parseRows(closedRows);
  const { rows } = toJournalRows(positions, { broker: "swingbot", targets: [] });
  eq(rows.length, 3);
  const g = rows[0];
  eq(g.status, "closed");
  eq(g.stop_source, "recorded");
  eq(g.entry_date_source, "recorded");
  eq(g.pattern, "Darvas Box");
  eq(g.exit_reason, "Stop hit");
  ok(/SwingBot/.test(g.notes) && /score 3/.test(g.notes), "the bot's remarks are kept as a note");
  eq(g.charges, 0);
});

test("an open row is open, and the same file twice adds nothing", () => {
  const { positions } = swingbot.parseRows(openRows);
  const first = toJournalRows(positions, { broker: "swingbot", targets: [] });
  eq(first.rows[0].status, "open");
  eq(first.rows[0].exits.length, 0);
  const again = toJournalRows(positions, {
    broker: "swingbot",
    targets: first.rows.map((r) => ({ symbol: r.symbol, entry_date: r.entry_date })),
  });
  eq(again.rows.length, 0);
  eq(again.duplicates.length, 2);
});

test("what the file says about itself is a note, not a lost row", () => {
  const { warnings, notes } = swingbot.parseRows(closedRows);
  ok(notes.some((w) => /Charges are worked out by LedgeRR/.test(w)), "who prices the charges is said");
  ok(notes.some((w) => /worked back from the P&L and R/.test(w)), "and the stops are explained");
  /* Under warnings these read as "2 rows unreadable — skipped before anything
     was matched", which claims a loss that did not happen. */
  eq(warnings.length, 0, "nothing was skipped, so nothing is reported as skipped");
});

test("the preview hands those notes through, and offers no stop to assume", () => {
  const src = read("components/ImportTrades.jsx");
  ok(/notes: raw\.notes \|\| \[\]/.test(src), "a journal file's notes reach the screen");
  ok(/!tradebook && !journal && parsed\.trades\.length > 0/.test(src),
     "the assume-a-stop control is hidden for a file that carries real stops");
  ok(/holdings \|\| journal \? parsed\.trades\.length : s\.trades/.test(src),
     "and the button counts the rows it is about to write");
});

test("the import screen tries it before the tax P&L parser", () => {
  const src = read("components/ImportTrades.jsx");
  const mine = src.indexOf("swingbot.detectRows");
  const tradebook = src.indexOf("zerodhaTradebook.detectRows(rows)");
  ok(mine > 0 && mine < tradebook, "a CSV falls to Zerodha by default, so this must come first");
  ok(/from "@\/lib\/brokers\/swingbot"/.test(src), "and it is imported");
});

/*
 * THE LEDGER — the bot's newer single file: both books in one, a `record`
 * column per row, renamed columns, a real stop on every row, and a P&L that
 * is NET of the bot's cost estimate. Rows from its real output, unchanged.
 */
import * as indmoney from "@/lib/brokers/indmoney";
import { derivePosition } from "@/lib/positions";

const LEDGER = `record,symbol,pattern,entry_date,exit_date,entry_price,exit_price,quantity,stop_loss,exit_reason,score,gate_ok,bars_held,pnl,r_multiple,pct,mae_r,mfe_r
closed,GVT&D,darvas_box,2026-06-18,2026-07-03,5257.88,4574.13,27,4581.0,stop,3,False,10,-18820.98,-1.03,-13.26,-1.39,0.58
closed,ATHERENERG,darvas_box,2026-08-04,2026-09-28,1452.58,1452.72,70,1188.1,close below 50 SMA,4,True,38,-279.42,-0.015,-0.27,-0.18,1.1
closed,CUPID,high_tight_flag,2026-06-11,2026-09-04,155.41,282.73,429,111.71,time stop,3,False,60,54348.94,2.899,81.52,-0.07,3.29
open,BHEL,darvas_box,2026-10-06,,452.68,,327,395.5,,3,False,7,,,,-0.5601455105110361,0.1980132218685509
open,KTKBANK,flat_base,2026-07-30,,291.19,,557,257.55,,3,True,53,,,,-0.24040001635146685,1.6266402565693874`;
const ledgerRows = parseCsv(LEDGER);

test("the ledger is recognised as one file holding both books", () => {
  eq(swingbot.fileKind(ledgerRows), "ledger");
  eq(indmoney.detectRows(ledgerRows), false, "and no other adapter checked first claims it");
  const { positions, warnings } = swingbot.parseRows(ledgerRows);
  eq(warnings.length, 0);
  eq(positions.length, 5);
  eq(positions.filter((p) => p.exits.length).length, 3, "three closed");
  eq(positions.filter((p) => !p.exits.length).length, 2, "two still open");
});

test("the ledger's stops are read straight off, on closed rows too", () => {
  const { positions, notes } = swingbot.parseRows(ledgerRows);
  eq(positions[0].stop, 4581, "GVT&D's stated stop, not one worked back from pnl");
  eq(positions[3].stop, 395.5, "BHEL, open");
  ok(!notes.some((n) => /worked back/.test(n)), "nothing reconstructed when the file states them");
});

/*
 * LEDGERR PRICES THE CHARGES. The ledger's pnl is net of the bot's own cost
 * estimate — ₹20 brokerage a side, an old DP figure — so it is not used: the
 * adapter brings none, and withOwnCharges costs every leg with the app's
 * calculator and the account's broker plan, as a typed trade is costed.
 */
import { withOwnCharges } from "@/lib/journalImport";
import { tradeCharges, mergeConfig, BROKER_PRESETS } from "@/lib/charges";
const ZERODHA = mergeConfig(BROKER_PRESETS["Zero brokerage (Zerodha, Groww, Upstox delivery)"]);

test("the adapter takes no charge from the file, and says LedgeRR will price them", () => {
  eq(swingbot.ownCharges, true);
  const { positions, notes } = swingbot.parseRows(ledgerRows);
  ok(positions.every((p) => !p.charges && p.exits.every((e) => e.charges === 0)), "nothing from the bot's pnl");
  ok(notes.some((n) => /bot's own cost estimate in this file is not used/.test(n)));
});

test("every leg is priced by the app's own calculator — buy on the position, each sell on its sell", () => {
  const priced = withOwnCharges(swingbot.parseRows(ledgerRows).positions, ZERODHA);
  const g = priced[0];                                         // GVT&D
  const c = tradeCharges({ exchange: "NSE", entry_date: g.entryDate, entry_price: g.entryPrice, quantity: g.quantity,
    exits: [{ exit_date: "2026-07-03", price: 4574.13, quantity: 27 }] }, ZERODHA);
  near(g.charges, c.buyTotal, 0.01, "the buy leg");
  near(g.exits[0].charges, c.sellTotal, 0.01, "the sell leg");
  near(g.charges + g.exits[0].charges, 312.03, 0.02, "₹312.03 at Zerodha's rates, not the bot's ₹359.73");
  ok(g.chargesAuto, "marked as computed");
  const bhel = priced[3];
  ok(bhel.charges > 0 && !bhel.exits.length, "an open position carries its buy charge now");

  /* Net P&L is then the price move less LedgeRR's charges — better than the
     bot's report by its brokerage and DP, which is the point. */
  const d = derivePosition({
    symbol: g.symbol, side: "long", status: "closed", entry_date: g.entryDate, entry_price: g.entryPrice,
    quantity: g.quantity, stop_loss: g.stop, stop_source: "recorded", charges: g.charges,
    exit_date: "2026-07-03", exit_price: 4574.13, exits: g.exits,
  }, 5e6);
  near(d.pnl, (4574.13 - 5257.88) * 27 - 312.03, 0.02);
  near(g.netProfit, d.pnl, 0.02, "and the preview shows the P&L that will be saved, not the bot's");
});

test("a later sale brings only its sell charge onto the trade already here", () => {
  const priced = withOwnCharges(swingbot.parseRows(ledgerRows).positions, ZERODHA);
  const out = toJournalRows([priced[0]], { broker: "swingbot",
    targets: [{ id: "t-g", symbol: "GVT&D", entry_date: "2026-06-18", quantity: 27, status: "open", broker: "swingbot", exits: [] }] });
  eq(out.completions.length, 1);
  near(out.completions[0].tranches[0].charges, priced[0].exits[0].charges, 0.001, "the sell leg alone — the buy was charged at import");
  ok(out.completions[0].tranches[0].charges < priced[0].charges + priced[0].exits[0].charges);
});

test("rows written from computed charges say so — charges_auto", () => {
  const priced = withOwnCharges(swingbot.parseRows(ledgerRows).positions, ZERODHA);
  const { rows } = toJournalRows(priced, { broker: "swingbot" });
  ok(rows.every((r) => r.charges_auto === true));
  const plain = toJournalRows(swingbot.parseRows(ledgerRows).positions, { broker: "swingbot" });
  ok(plain.rows.every((r) => r.charges_auto === false), "a file's own stated charges stay an override");
});

test("the import screen prices SwingBot files with the account's plan", () => {
  const imp = read("components/ImportTrades.jsx");
  ok(/broker\.ownCharges\s*\? withOwnCharges\(raw\.positions, chargeConfig/.test(imp));
});

test("a ledger row that is neither closed nor open is reported, not guessed", () => {
  const { positions, warnings } = swingbot.parseRows(parseCsv(LEDGER.replace("open,BHEL", "pending,BHEL")));
  eq(positions.length, 4);
  ok(warnings.some((w) => /BHEL: skipped — its record is "pending"/.test(w)));
});

/* r_multiple is a witness, not an import: the R its own stop, prices and P&L
   imply must match it, or something changed between the bot and the file. */
test("the ledger's r_multiple is checked, not imported", () => {
  const clean = swingbot.parseRows(ledgerRows);
  ok(!clean.notes.some((n) => /Check before importing/.test(n)), "the real file agrees with itself");

  /* GVT&D's stop typed over: 4581 → 4900. The file still says −1.03R. */
  const edited = swingbot.parseRows(parseCsv(LEDGER.replace(",27,4581.0,stop,", ",27,4900.0,stop,")));
  const n = edited.notes.find((x) => /Check before importing/.test(x));
  ok(n, "a stop that no longer matches the file's R is flagged");
  ok(/GVT&D \(2026-06-18: file -1.03R, its own stop gives -1.95R\)/.test(n), n);
  eq(edited.warnings.length, 0, "flagged, not refused — no row is lost");
  eq(edited.positions[0].stop, 4900, "and the stop is used as written");
});
