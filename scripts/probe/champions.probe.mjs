import { test, eq, ok, near } from "./harness.mjs";
import * as champions from "@/lib/brokers/champions";
import { toJournalRows, journalSummary } from "@/lib/journalImport";
import { BROKERS, kindOf } from "@/lib/brokers/index.js";

/**
 * A JOURNAL EXPORT, WHICH IS THE ONLY FILE THAT KNOWS THE STOP.
 *
 * Every other importer can be wrong about money. This one can be wrong about
 * RISK, which is worse: a mis-read stop produces a 1R that every R in the app
 * then divides by, and the resulting figures look entirely reasonable.
 *
 * The sheet is header-row-plus-continuation-rows, so the parsing rule is the
 * first thing to pin: read row by row without it and every exit tranche looks
 * like a trade with no symbol.
 */

/* The real file's header, verbatim. */
const HEAD = ["Date", "Symbol", "Quantity", "Entry", "Type", "SL", "SL %", "RPT",
  "Position Size", "Exit Price", "Exit %", "Days", "RR", "Charges", "Net Profit",
  "Exit Date", "Exit Price", "Exit Quantity", "Exit %", "Exit Charges", "Exit Profit", "Tags"];

const entry = (o) => {
  const r = new Array(22).fill("");
  r[0] = o.date; r[1] = o.symbol; r[2] = o.qty; r[3] = o.entry; r[4] = o.type || "Long";
  r[5] = o.sl; r[6] = o.slPct ?? 5; r[7] = o.rpt ?? null; r[8] = o.size ?? null;
  r[13] = o.charges ?? 0; r[14] = o.net ?? 0; r[21] = o.tags ?? "";
  return r;
};
const exitRow = (o) => {
  const r = new Array(22).fill("");
  r[15] = o.date; r[16] = o.price; r[17] = o.qty; r[18] = o.pct ?? 100;
  r[19] = o.charges ?? 0; r[20] = o.profit ?? 0;
  return r;
};

/* 45707 is 19 Feb 2025 in the real file — the anchor every date check uses. */
test("Excel serials become calendar days, exactly", () => {
  const { positions } = champions.parseRows([HEAD,
    entry({ date: 45707, symbol: "ERIS", qty: 61, entry: 1283.2, sl: 1217.5 })]);
  eq(positions[0].entryDate, "2025-02-19");
});

test("a serial is never read as a price, and a price never as a date", () => {
  /*
    The two are indistinguishable as numbers — 45707 is a plausible share
    price and 1283.2 is a plausible serial. Only the column decides, and the
    guard below refuses anything outside the range a trade date can occupy.
  */
  const { positions } = champions.parseRows([HEAD,
    entry({ date: 45707, symbol: "X", qty: 1, entry: 45707, sl: 40000 })]);
  eq(positions[0].entryDate, "2025-02-19");
  eq(positions[0].entryPrice, 45707, "the price column stays a price");
});

test("continuation rows attach to the position above them", () => {
  /*
    THE RULE THE WHOLE READER RESTS ON. GABRIEL from the real file: one entry
    and five exits, each on its own row with the first fifteen columns blank.
  */
  const { positions, warnings } = champions.parseRows([HEAD,
    entry({ date: 45709, symbol: "GABRIEL", qty: 999, entry: 496.34, sl: 455.06,
            rpt: 41238.72, charges: 589.6, net: 36998.15 }),
    exitRow({ date: 45716, price: 460.28, qty: 331, charges: 173.95, profit: -11935.86 }),
    exitRow({ date: 45743, price: 583.45, qty: 63, charges: 54.38, profit: 5487.93 }),
    exitRow({ date: 45782, price: 545.2, qty: 306, charges: 201.33, profit: 14951.16 }),
    exitRow({ date: 45793, price: 637.45, qty: 63, charges: 81.12, profit: 8889.93 }),
    exitRow({ date: 45831, price: 584.8, qty: 236, charges: 171.19, profit: 20876.56 }),
  ]);
  eq(positions.length, 1, "five exits are not five trades");
  eq(positions[0].exits.length, 5);
  eq(positions[0].quantity, 999);
  eq(warnings.length, 0);
  near(positions[0].exits.reduce((a, e) => a + e.quantity, 0), 999, 1e-9,
    "and they account for the whole position");
});

test("two positions in a row do not bleed into each other", () => {
  const { positions } = champions.parseRows([HEAD,
    entry({ date: 45707, symbol: "ERIS", qty: 61, entry: 1283.2, sl: 1217.5 }),
    exitRow({ date: 45715, price: 1222.45, qty: 61 }),
    entry({ date: 45708, symbol: "SRF", qty: 97, entry: 2779.05, sl: 2695.68 }),
    exitRow({ date: 45750, price: 2850.89, qty: 97 }),
  ]);
  eq(positions.length, 2);
  eq(positions[0].exits.length, 1);
  eq(positions[1].symbol, "SRF");
  eq(positions[1].exits.length, 1, "SRF must not inherit ERIS's exit");
});

test("a position with no exit rows is open, not broken", () => {
  const { positions, warnings } = champions.parseRows([HEAD,
    entry({ date: 45859, symbol: "KTKBANK", qty: 970, entry: 278.1, sl: 271 })]);
  eq(positions.length, 1);
  eq(positions[0].exits.length, 0);
  eq(warnings.length, 0, "nothing is wrong with a position you still hold");
  const { rows } = toJournalRows(positions, { batchId: "b" });
  eq(rows[0].status, "open");
  eq(rows[0].exit_date, null);
  eq(rows[0].exit_price, null);
});

test("the stop comes across as RECORDED, which is the point of the file", () => {
  const { positions } = champions.parseRows([HEAD,
    entry({ date: 45707, symbol: "ERIS", qty: 61, entry: 1283.2, sl: 1217.5 })]);
  const { rows } = toJournalRows(positions, { batchId: "b" });
  eq(rows[0].stop_loss, 1217.5);
  eq(rows[0].stop_source, "recorded", "not assumed — R becomes a measurement");
  eq(rows[0].entry_date_source, "recorded");
});

test("a stop on the wrong side of the entry is dropped, not imported", () => {
  /*
    On a long the stop must sit below the entry. Above it, 1R is negative and
    every R divided by it has its sign inverted — a losing trade reading as a
    winner, in a figure nobody would think to check. Those arrive with no stop
    and join the /stops queue, which is the honest outcome.
  */
  const { positions } = champions.parseRows([HEAD,
    entry({ date: 45707, symbol: "BAD", qty: 10, entry: 100, sl: 120 }),
    entry({ date: 45707, symbol: "ZERO", qty: 10, entry: 100, sl: 0 }),
    entry({ date: 45707, symbol: "SHORTOK", qty: 10, entry: 100, sl: 120, type: "Short" }),
  ]);
  const { rows, noStop } = toJournalRows(positions, { batchId: "b" });
  const by = Object.fromEntries(rows.map((r) => [r.symbol, r]));
  eq(by.BAD.stop_loss, null, "a long stopped above its entry");
  eq(by.BAD.stop_source, null);
  eq(by.ZERO.stop_loss, null, "and a zero is not a stop");
  eq(by.SHORTOK.stop_loss, 120, "while above IS correct for a short");
  eq(by.SHORTOK.side, "short");
  eq(noStop.length, 1, "only the genuinely wrong one is reported");
});

test("charges are split entry-side and per-exit, never doubled", () => {
  /*
    derivePosition adds trades.charges to the tranche charges, so putting the
    file's total in both places deducts the exit costs twice — the same trap
    the tax P&L path documents.
  */
  const { positions } = champions.parseRows([HEAD,
    entry({ date: 45707, symbol: "ERIS", qty: 61, entry: 1283.2, sl: 1217.5, charges: 93.09 }),
    exitRow({ date: 45715, price: 1222.45, qty: 61, charges: 93.87 }),
  ]);
  const { rows } = toJournalRows(positions, { batchId: "b" });
  near(rows[0].charges, 93.09, 1e-9, "the entry leg only");
  near(rows[0].exits[0].charges, 93.87, 1e-9, "and the exit carries its own");
});

test("a position already in the journal is not written again", () => {
  const { positions } = champions.parseRows([HEAD,
    entry({ date: 45707, symbol: "ERIS", qty: 61, entry: 1283.2, sl: 1217.5 }),
    entry({ date: 45708, symbol: "SRF", qty: 97, entry: 2779.05, sl: 2695.68 }),
  ]);
  const { rows, duplicates } = toJournalRows(positions, { batchId: "b",
    targets: [{ symbol: "ERIS", entry_date: "2025-02-19" }] });
  eq(rows.length, 1);
  eq(rows[0].symbol, "SRF");
  eq(duplicates.length, 1, "re-importing the same export doubles nothing");
});

test("nothing beyond the essentials is written", () => {
  /*
    The file carries tags, a recorded risk-per-trade, position size, holding
    days and an R:R ratio. None is imported: each is either something the app
    computes for itself from what IS imported, or something it has no honest
    place for.

    Two versions of one number that can disagree is the failure this avoids,
    and the imported one is always the copy nobody recomputes.
  */
  const { positions } = champions.parseRows([HEAD,
    entry({ date: 45707, symbol: "ERIS", qty: 61, entry: 1283.2, sl: 1217.5,
            rpt: 4007.7, size: 78275.2, tags: "A Trade, MTF" })]);
  const { rows } = toJournalRows(positions, { batchId: "b" });
  const r = rows[0];

  eq(r.pattern, undefined, "pattern is the trader's, not a funding method");
  eq(r.notes, undefined, "and the tags stay in the file");
  for (const derived of ["position_size", "held_days", "rr", "r", "pnl", "risk_amt"]) {
    eq(r[derived], undefined, `${derived} is computed, never imported`);
  }

  /* What DOES come across is exactly what the app cannot work out alone. */
  for (const need of ["symbol", "entry_date", "entry_price", "quantity",
                      "stop_loss", "side", "charges", "exits"]) {
    ok(r[need] !== undefined, `${need} must be imported`);
  }
});

test("a part-sold position is open, and says how much is left", () => {
  const { positions } = champions.parseRows([HEAD,
    entry({ date: 45820, symbol: "KMEW", qty: 349, entry: 2052.7, sl: 1993 }),
    exitRow({ date: 45825, price: 2284, qty: 72 }),
    exitRow({ date: 45905, price: 3103, qty: 151 }),
  ]);
  const { rows } = toJournalRows(positions, { batchId: "b" });
  eq(rows[0].status, "open", "223 of 349 sold is still a holding");
  eq(rows[0]._preview.sold, 223);
  eq(rows[0]._preview.stillOpen, 126);
  eq(rows[0].exits.length, 2);
});

test("it is detected before the broker adapters get a look", () => {
  /*
    Its sheet is called "Trades" and has Symbol and Quantity columns, which is
    enough shape for a looser matcher to claim it — and a journal read as a tax
    P&L would silently discard every stop in it.
  */
  eq(BROKERS[0].id, "champions", "first in the order");
  eq(kindOf(BROKERS[0]), "journal", "and its own kind, not taxpnl");
  ok(champions.detectRows([HEAD]), "its own header is recognised");
  ok(!champions.detectRows([["Symbol", "Quantity", "Buy Value", "Sell Value"]]),
    "a tax P&L header is not");
  ok(!champions.detectRows([["Date", "Symbol", "Quantity", "Entry"]]),
    "and neither is a partial match — every mark is required");
});

test("the summary counts what the preview promises", () => {
  const { positions } = champions.parseRows([HEAD,
    entry({ date: 45707, symbol: "A", qty: 10, entry: 100, sl: 90, net: 500 }),
    exitRow({ date: 45715, price: 150, qty: 10 }),
    entry({ date: 45820, symbol: "B", qty: 20, entry: 200, sl: 180, net: 0 }),
    entry({ date: 45830, symbol: "C", qty: 30, entry: 300, sl: 400, net: 0 }),
  ]);
  const { rows } = toJournalRows(positions, { batchId: "b" });
  const S = journalSummary(rows);
  eq(S.positions, 3);
  eq(S.closed, 1);
  eq(S.open, 2);
  eq(S.withStop, 2, "C's stop is above its entry and was dropped");
  eq(S.tranches, 1);
  eq(S.from, "2025-02-19");
});

/* ------------------- dates, which is where this can go wrong quietly ----- */

const dated = (v) => champions.parseRows([HEAD,
  entry({ date: v, symbol: "X", qty: 1, entry: 100, sl: 90 })]).positions[0]?.entryDate;

test("a Date from the sheet is read in LOCAL time, not through UTC", () => {
  /*
    THE MISTAKE THIS CODEBASE MAKES MOST.

    SheetJS with cellDates builds a Date at LOCAL midnight, so 19 February
    2025 arrives as 2025-02-18T18:30:00Z in IST. Read with toISOString() —
    the obvious thing — every date east of Greenwich lands a day early, and
    the whole book imports shifted by one day while looking perfectly normal.

    Constructed here the same way SheetJS constructs it, so this holds in any
    zone the suite runs in.
  */
  eq(dated(new Date(2025, 1, 19)), "2025-02-19");
  eq(dated(new Date(2026, 0, 1)), "2026-01-01", "and on a year boundary");
  eq(dated(new Date(2025, 11, 31)), "2025-12-31");
});

test("an Excel serial is exact arithmetic, not a parse", () => {
  eq(dated(45707), "2025-02-19");
  eq(dated(45292), "2024-01-01");
  ok(!dated(59), "and the 1900 leap-year fiction is refused, not shifted");
});

test("a formatted date is read the way the FILE says, not the way we guess", () => {
  /*
    "2/19/25" is unambiguous — there is no nineteenth month — and it proves
    the whole column is month-first. That decision is then applied to
    "2/3/25", which on its own could be either.
  */
  const { positions } = champions.parseRows([HEAD,
    entry({ date: "2/19/25", symbol: "A", qty: 1, entry: 100, sl: 90 }),
    entry({ date: "2/3/25", symbol: "B", qty: 1, entry: 100, sl: 90 }),
  ]);
  eq(positions[0].entryDate, "2025-02-19");
  eq(positions[1].entryDate, "2025-02-03", "March 2nd would be the other reading");
});

test("and the other way round, when the file says so", () => {
  const { positions } = champions.parseRows([HEAD,
    entry({ date: "19/2/25", symbol: "A", qty: 1, entry: 100, sl: 90 }),
    entry({ date: "3/2/25", symbol: "B", qty: 1, entry: 100, sl: 90 }),
  ]);
  eq(positions[0].entryDate, "2025-02-19");
  eq(positions[1].entryDate, "2025-02-03", "day-first, proved by the row above");
});

test("a file that cannot prove its orientation imports nothing", () => {
  /*
    Every date under the 13th, so both readings are possible. Guessing would
    put a whole book out by up to eleven months and look entirely ordinary —
    so it refuses, loudly, one warning per row.
  */
  const { positions, warnings } = champions.parseRows([HEAD,
    entry({ date: "2/3/25", symbol: "A", qty: 1, entry: 100, sl: 90 }),
    entry({ date: "5/6/25", symbol: "B", qty: 1, entry: 100, sl: 90 }),
  ]);
  eq(positions.length, 0, "nothing is imported on a guess");
  eq(warnings.length, 2, "and each row says so");
  ok(/no entry date/.test(warnings[0]));
});

test("ISO strings need no interpretation at all", () => {
  eq(dated("2025-02-19"), "2025-02-19");
  eq(dated("2025-02-19T00:00:00.000Z"), "2025-02-19");
});

test("exit dates go through the same rule as entry dates", () => {
  /* They are read from a different column and were a separate code path once;
     an orientation decided from entries alone would not reach them. */
  const { positions } = champions.parseRows([HEAD,
    entry({ date: "2/19/25", symbol: "A", qty: 10, entry: 100, sl: 90 }),
    exitRow({ date: "2/27/25", price: 120, qty: 10 }),
  ]);
  eq(positions[0].exits[0].exit_date, "2025-02-27");
});
