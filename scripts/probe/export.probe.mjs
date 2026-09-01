import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, eq, ok } from "./harness.mjs";
import { exportFilename } from "@/lib/format";

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
