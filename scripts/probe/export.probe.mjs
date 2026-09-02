import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, eq, ok } from "./harness.mjs";
import { exportFilename, monthShort } from "@/lib/format";

const AT = new Date(2026, 8, 1, 14, 32);        // 1 Sep 2026, 14:32 local

test("the filename carries the slice and the minute", () => {
  eq(exportFilename("Exit date is on or after 2025-03-15", { now: AT }),
     "ledgerr-exit-date-is-on-or-after-2025-03-15-2026-09-01-1432.csv");
  eq(exportFilename("all trades", { now: AT }), "ledgerr-all-trades-2026-09-01-1432.csv");

  /* The minute is what makes a second export a different file rather than
     silently becoming "(1)". */
  const a = exportFilename("losers", { now: new Date(2026, 8, 1, 14, 32) });
  const b = exportFilename("losers", { now: new Date(2026, 8, 1, 14, 37) });
  ok(a !== b, "two exports five minutes apart collided");
});

test("a stamp in local time, because that is the clock the file is read on", () => {
  /* 9am must not read 0330. This is the one place in the app where UTC is the
     wrong answer, so it is pinned rather than left to convention. */
  eq(exportFilename("x", { now: new Date(2026, 8, 1, 9, 5) }).endsWith("-2026-09-01-0905.csv"), true);
  eq(exportFilename("x", { now: new Date(2026, 0, 9, 0, 0) }).endsWith("-2026-01-09-0000.csv"), true,
     "single-digit month, day, hour and minute all pad");
});

test("a view name is free text and cannot reach the filesystem intact", () => {
  /* Every one of these is a legal saved-view name somebody could type. */
  const cases = [
    "P&L < 0", "Q3/Q4 review", "win:loss", "50% days", "..\\..\\etc\\passwd",
    "trades — 2R+", "  padded  ", "***", "café", "a\nb",
  ];
  for (const c of cases) {
    const f = exportFilename(c, { now: AT });
    ok(/^[a-z0-9.-]+$/.test(f), `unsafe filename from ${JSON.stringify(c)}: ${f}`);
    ok(!f.includes("/") && !f.includes("\\"), `path separator survived: ${f}`);
    ok(!f.includes("--."), `a hyphen ran into the extension: ${f}`);
    ok(f.endsWith(".csv"), f);
  }
});

test("a label that slugs away entirely still leaves a usable name", () => {
  for (const c of ["***", "   ", "", null, undefined, "…"]) {
    const f = exportFilename(c, { now: AT });
    eq(f, "ledgerr-2026-09-01-1432.csv", `from ${JSON.stringify(c)}`);
  }
});

test("a very long view name is cut without leaving a trailing hyphen", () => {
  const f = exportFilename("x".repeat(200), { now: AT });
  ok(f.length < 100, `not cut: ${f.length}`);
  ok(!f.includes("-2026") === false, "the stamp survived the cut");
  const f2 = exportFilename("word ".repeat(40), { now: AT });
  ok(!/-{2,}/.test(f2), `doubled hyphen at the cut: ${f2}`);
  ok(!f2.includes("--2026"), `cut landed on a separator: ${f2}`);
});

test("the CSV button exports what is on screen, not the whole book", () => {
  /* The bug this replaces: exportCsv(all) handed back 97 trades from a table
     showing 27. Read out of the source because the click path is React. */
  const src = readFileSync(path.resolve(fileURLToPath(import.meta.url),
    "..", "..", "..", "src/components/journal/Trades.jsx"), "utf8");
  ok(/onClick=\{\(\)\s*=>\s*exportCsv\(rows,/.test(src),
     "the CSV button is not passing the filtered rows");
  ok(!/exportCsv\(all\b/.test(src), "exportCsv(all) is back");
});

/* ------------------------------------------------------------------ */

import { toCsv } from "@/lib/csv";

const parse = (s) => s.split("\r\n").map((line) => {
  const out = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
});

test("a header comes from the column, a cell from the value", () => {
  const csv = toCsv([{ a: 1, b: "x" }], [{ key: "a", header: "amount" }, "b"]);
  const rows = parse(csv);
  eq(rows[0].join("|"), "amount|b", "a bare string column is its own header");
  eq(rows[1].join("|"), "1.0000|x");
  eq(csv.includes("\r\n"), true, "CRLF, or Excel on Windows reads one long line");
});

test("the values that break a naive writer", () => {
  /* Every one of these is legal in a trade note or a symbol, and each one
     shifts every following column by one if it escapes wrongly. */
  const rows = [{
    note: 'He said "buy the dip", so I did',
    tags: ["Oversized", "Revenge trade"],
    multiline: "line one\nline two",
    comma: "1,00,000 shares",
    lead: "   padded   ",
    r: NaN, inf: Infinity, zero: 0, nul: null, undef: undefined,
    yes: true, no: false,
  }];
  const cols = ["note","tags","multiline","comma","lead","r","inf","zero","nul","undef","yes","no"];
  const out = parse(toCsv(rows, cols));
  const rec = Object.fromEntries(out[0].map((h, i) => [h, out[1][i]]));

  eq(rec.note, 'He said "buy the dip", so I did', "a quote and a comma survived intact");
  eq(rec.tags, "Oversized | Revenge trade", "an array joins on a pipe, not a comma");
  eq(rec.comma, "1,00,000 shares");
  eq(rec.lead, "   padded   ", "leading space kept rather than eaten");
  eq(rec.zero, "0.0000", "zero is a number, not a blank");
  eq(rec.nul, "");
  eq(rec.undef, "");
  eq(rec.yes, "yes");
  eq(rec.no, "no", "false is a value; blanking it would read as missing");
  /* NaN and Infinity must never reach a spreadsheet — one poisons every
     formula summing the column. */
  eq(rec.r, "", "NaN becomes empty");
  eq(rec.inf, "", "Infinity becomes empty");

  /* The embedded newline is the one that silently corrupts a file: unquoted,
     it ends the record early and everything after shifts up a row. */
  ok(toCsv(rows, cols).split("\r\n").length === 2,
     "an embedded newline broke the record count");
});

test("every column of both exports resolves against a real row", () => {
  /* A column naming a field that does not exist is not an error anywhere —
     it exports a silent empty column, which looks like missing data. */
  const src = (f) => readFileSync(path.resolve(fileURLToPath(import.meta.url),
    "..", "..", "..", f), "utf8");
  const holdings = src("src/components/journal/Holdings.jsx");
  const keys = [...holdings.matchAll(/\{ key: "([a-zA-Z0-9_]+)", header:/g)].map((m) => m[1]);
  ok(keys.length > 15, `only ${keys.length} holding columns parsed`);

  /* EVERY COLUMN MUST PARSE, or the check below silently skips the ones it
     could not read. The first version used [a-zA-Z_]+ with no digits, so a
     deliberately broken column named broker9 was not extracted at all and the
     probe passed while pointing at a field that does not exist. A parser that
     drops what it cannot understand reports a clean bill of health on the
     subset it happened to manage. */
  const declared = (holdings.match(/\{ key: "/g) || []).length;
  eq(keys.length, declared,
     `${declared} columns are declared but only ${keys.length} parsed — ` +
     `the rest are being skipped, not checked`);

  /* A holdings row is `{ ...trade, ...derivePosition(trade), ...rowsMapAdds }`,
     so all three are where a legitimate key can come from. The first draft of
     this checked only Holdings.jsx and schema.sql and failed on slPct, which
     is real and born in positions.js — a probe too narrow to know where the
     data comes from reports its own blind spot as a bug. */
  /* WITH THE DECLARATION CUT OUT. The first version of this searched
     Holdings.jsx whole — which contains the column list itself, so every key
     matched its own declaration and the check passed with a column pointing at
     a field that does not exist. Verified the fix by breaking a column on
     purpose and watching it fail. */
  const decl = holdings.indexOf("const HOLDING_COLS");
  const end = holdings.indexOf("];", decl);
  ok(decl > 0 && end > decl, "could not locate the column declaration to exclude");
  const holdingsBody = holdings.slice(0, decl) + holdings.slice(end);
  ok(!/\bHOLDING_COLS\s*=/.test(holdingsBody), "the declaration was not actually removed");

  const universe = holdingsBody + src("src/lib/positions.js") + src("supabase/schema.sql");
  for (const k of keys) {
    ok(new RegExp(`\\b${k}\\b`).test(universe),
       `holdings CSV column "${k}" is produced by nothing in Holdings.jsx, ` +
       `positions.js or the schema — it would export a silent empty column`);
  }

  /* And the guard against a vacuous version of the check above. */
  ok(!/\bnotAFieldAnywhere\b/.test(universe), "the universe string is not being searched");
});

test("a stored date string never becomes a Date just to read its month", () => {
  /* `new Date("2026-09-01")` is UTC midnight and every getter reads it back
     LOCAL, so west of Greenwich that date is August. format.js already warns
     about this against dmy, and the holdings month total walked into it
     anyway — a trade closed on the 1st would have counted in the wrong month.

     monthShort is the helper most likely to be handed a date string next, so
     it is pinned here in both forms. */
  eq(monthShort("2026-09-01"), "Sep", "the first of the month stays in its month");
  eq(monthShort("2026-01-01"), "Jan");
  eq(monthShort("2026-12-31"), "Dec");
  eq(monthShort("2026-09-15T00:00:00.000Z"), "Sep", "a full stamp reads the same");
  eq(monthShort(new Date(2026, 8, 15)), "Sep", "a Date still works");
  eq(monthShort(""), "");

  /* And the comparison the holdings month actually uses is on text, not on a
     parsed date — the same fix, at the call site. */
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const h = readFileSync(path.join(root, "src/components/journal/Holdings.jsx"), "utf8");
  ok(/String\(t\.exit_date\)\.slice\(0, 7\) === ym/.test(h),
     "the month filter is back to parsing exit_date into a Date");
  ok(!/new Date\(t\.exit_date\)\.getMonth/.test(h),
     "exit_date is being parsed and read local again — that is the zone bug");
});
