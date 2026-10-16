import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq, near } from "./harness.mjs";
import { toJournalRows } from "@/lib/journalImport";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/*
 * A BOT'S LEDGER IS RE-EXPORTED AS IT TRADES. A position imported while open
 * comes back sold, and treating the whole row as "already here" left it open
 * for good — seven of them on the first ledger tried. Its new sells are now a
 * completion onto the trade already here.
 */
const sold = (o = {}) => ({
  symbol: "WELCORP", side: "long", entryDate: "2026-07-09", entryPrice: 1604.3, quantity: 65,
  stop: 1320, exitReason: "Time stop", pattern: "High Tight Flag", notes: "SwingBot",
  exits: [{ exit_date: "2026-10-05", price: 2493.75, quantity: 65, charges: 355.05 }], ...o,
});
const here = (o = {}) => ({
  id: "t-wel", symbol: "WELCORP", entry_date: "2026-07-09", quantity: 65, status: "open",
  broker: "swingbot", exits: [], ...o,
});

test("an open trade the file now shows sold is completed, not skipped", () => {
  const out = toJournalRows([sold()], { broker: "swingbot", targets: [here()] });
  eq(out.rows.length, 0, "no second copy");
  eq(out.duplicates.length, 0, "and not waved through as a duplicate");
  eq(out.completions.length, 1);
  const c = out.completions[0];
  eq(c.tradeId, "t-wel", "onto the trade already here");
  eq(c.tranches.length, 1);
  eq(c.tranches[0].exit_date, "2026-10-05");
  near(c.tranches[0].charges, 355.05, 1e-9, "the sell's charges come with it");
  eq(c.tranches[0].reason, "Time stop");
  eq(c.exitReason, "Time stop", "and why it was sold, since this sell finishes it");
  eq([c.holding, c.already, c.adding].join(), "65,0,65", "what the preview line reads");
});

test("a sell already recorded is a duplicate, as before", () => {
  const out = toJournalRows([sold()], { broker: "swingbot",
    targets: [here({ status: "closed", exits: [{ exit_date: "2026-10-05", quantity: 65 }] })] });
  eq(out.completions.length, 0);
  eq(out.duplicates.length, 1);
});

test("a still-open position in the file changes nothing here", () => {
  const out = toJournalRows([sold({ exits: [] })], { broker: "swingbot", targets: [here()] });
  eq(out.completions.length, 0);
  eq(out.duplicates.length, 1);
});

test("another broker's position on the same day is left alone", () => {
  const out = toJournalRows([sold()], { broker: "swingbot", targets: [here({ broker: "zerodha" })] });
  eq(out.completions.length, 0, "never grafted onto a different broker's trade");
  eq(out.duplicates.length, 1);
});

test("two same-day trades, or more sold than held, are handed back to decide", () => {
  const two = toJournalRows([sold()], { broker: "swingbot", targets: [here(), here({ id: "t-2" })] });
  eq(two.completions.length, 0);
  ok(/2 trades already start on this date/.test(two.conflicts[0].reason));
  eq(two.conflicts[0].exitDate, "2026-10-05", "in the shape the held-back list reads");

  const over = toJournalRows([sold()], { broker: "swingbot", targets: [here({ quantity: 40 })] });
  eq(over.completions.length, 0);
  ok(/sells 65 but the trade here holds 40/.test(over.conflicts[0].reason));
});

test("a part-sale completes but leaves the reason off — it explains the last sell", () => {
  const out = toJournalRows([sold({ exits: [{ exit_date: "2026-09-01", price: 2000, quantity: 30, charges: 100 }] })],
    { broker: "swingbot", targets: [here()] });
  eq(out.completions.length, 1);
  eq(out.completions[0].exitReason, null);
});

test("the import screen passes completions through, and the write guards the reason", () => {
  const imp = read("components/ImportTrades.jsx");
  ok(/const \{ rows: made, duplicates, noStop, completions, conflicts \} =\s*toJournalRows/.test(imp));
  ok(/if \(!made\.length && !completions\.length\)/.test(imp), "a file of sales only is not 'nothing new'");
  ok(/completions, conflicts, nearMisses: \[\],/.test(imp));
  ok(/<b>\{parsed\.completions\.length\}<\/b><span>completed<\/span>/.test(imp), "the board counts what it completes");
  ok(/s\.tranches \+ parsed\.completions\.reduce\(\(a, c\) => a \+ c\.tranches\.length, 0\)/.test(imp), "and their sells as exits");
  ok(/\{s\.positions > 0 && \(\s*<p className="im-note">/.test(imp), "the new-positions paragraph only when there are some");
  const db = read("lib/db.js");
  ok(/\.update\(\{ exit_reason: c\.exitReason \}\)\s*\.is\("exit_reason", null\)/.test(db),
     "a reason typed by hand is never overwritten");
});

test("the import history counts completions apart from misses", () => {
  const h = read("components/journal/ImportHistory.jsx");
  ok(/filter\(\(i\) => i\.o === "completed"\)\.length/.test(h), "completed counted on their own");
  ok(/\{done\} completed/.test(h) && /\{missed\} not imported/.test(h),
     "a ledger that closed seven reads '7 completed', not '30 not imported'");
});

test("undoing an import that only completed positions says what it takes back", () => {
  const h = read("components/journal/ImportHistory.jsx");
  ok(/ake back the sells it added to \$\{sells\} position/.test(h), "the sells, and that the positions reopen");
  ok(/trades \|\| reopen \? `\$\{trades\}\$\{reopen\}\?` : "Nothing left from this import — remove the record\?"/.test(h),
     "'nothing left' only when it is true");
});

test("after a journal import, the message says the stops are the file's — not assumed", () => {
  const imp = read("components/ImportTrades.jsx");
  const i = imp.indexOf('parsed?.kind === "journal" ? (');
  ok(i > 0 && i < imp.indexOf("Each one got a stop {stopPct}% below its entry"),
     "the journal wording is reached before the assumed-stop wording");
  ok(/each with the stop from the file/.test(imp));
  ok(/!\(parsed\?\.kind === "journal" && journalStopless === 0\)/.test(imp), "no Stops button when nothing waits there");
});
