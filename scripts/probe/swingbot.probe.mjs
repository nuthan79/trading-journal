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
  ok(notes.some((w) => /no charges/.test(w)), "charges are absent and said to be");
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
