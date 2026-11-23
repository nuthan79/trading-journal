import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { findRenames, mergeRenames, renamedTo } from "@/lib/renames";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

/**
 * A HELD SYMBOL THE EXCHANGE RETIRED STOPS PRICING, AND SAYS NOTHING.
 *
 * NOVARTIND became EVONILE in November 2026. A position stored under the old
 * name gets no quote, which on Holdings looks exactly like a slow one. The
 * symbol rebuild is the only moment that can see it happen — the ISIN moves
 * from one symbol to another — so it records it, and Holdings marks the row.
 */
const row = (s, e, i) => ({ s, e, i, n: s });

test("an ISIN that moved to a new symbol is a rename", () => {
  const f = findRenames([row("NOVARTIND", "NSE", "INE234A01025")],
                        [row("EVONILE", "NSE", "INE234A01025")], "2026-11-23");
  eq(JSON.stringify(f), JSON.stringify({ "NSE:NOVARTIND": { to: "EVONILE", since: "2026-11-23" } }));
});

test("a name that simply left the list is NOT claimed as renamed", () => {
  /* Suspended, delisted, or an SME listing the file never carries: marking
     these would warn on positions that are fine. */
  eq(Object.keys(findRenames([row("GONE", "NSE", "INE000X01011")], [], "d")).length, 0);
  eq(Object.keys(findRenames([row("NOISIN", "NSE", "")], [row("OTHER", "NSE", "")], "d")).length, 0);
});

test("still listed under its old name is not a rename, whatever else shares the ISIN", () => {
  const prev = [row("PUSHPIN", "BSE", "INE1")];
  /* The newcomer first: the order must not decide it. */
  const next = [row("CHASBRT", "BSE", "INE1"), row("PUSHPIN", "BSE", "INE1")];
  eq(Object.keys(findRenames(prev, next, "d")).length, 0);
});

test("each exchange is followed on its own", () => {
  const f = findRenames([row("HEG", "NSE", "I"), row("HEG", "BSE", "I")],
                        [row("HEGAM", "NSE", "I"), row("HEG", "BSE", "I")], "d");
  eq(Object.keys(f).join(), "NSE:HEG", "BSE still lists HEG, so only NSE renamed");
  /* Gone from NSE, and BSE carries the ISIN under its own spelling: that is
     not an NSE rename, and telling someone to type the BSE name on NSE would
     price nothing. */
  eq(Object.keys(findRenames([row("HEG", "NSE", "I")], [row("HEGBSE", "BSE", "I")], "d")).length, 0);
});

test("the record keeps old finds, collapses chains, and drops a relisted name", () => {
  const next = [row("C", "NSE", "I"), row("OLD", "NSE", "J")];
  const m = mergeRenames(
    { "NSE:A": { to: "B", since: "2026-10-28" }, "NSE:OLD": { to: "NEWER", since: "2026-10-28" } },
    { "NSE:B": { to: "C", since: "2026-11-23" } },
    next);
  eq(m["NSE:A"]?.to, "C", "A became B became C: A points at C");
  eq(m["NSE:A"]?.since, "2026-10-28", "and keeps the day it was first seen");
  ok(!("NSE:OLD" in m), "OLD is listed again — it prices, and may be someone else");
});

test("a lookup reads the trade's exchange, NSE when it has none", () => {
  const r = { "NSE:X": { to: "Y", since: "d" }, "BSE:Z": { to: "W", since: "d" } };
  eq(renamedTo(r, "x")?.to, "Y");
  eq(renamedTo(r, "Z", "NSE"), null, "a BSE rename says nothing about NSE");
  eq(renamedTo(r, "Z", "bse")?.to, "W");
  eq(renamedTo(null, "X"), null);
});

test("the shipped file agrees with the shipped symbol list", () => {
  /* Every old name is gone from symbols.json and every new one is in it, on
     the same exchange — otherwise Holdings would tell someone to type a
     symbol that does not price either. */
  const { renames } = JSON.parse(read("public/renames.json"));
  const listed = new Set(JSON.parse(read("public/symbols.json")).map((r) => `${r.e}:${r.s}`));
  const keys = Object.keys(renames);
  ok(keys.length > 0, "the record is not empty");
  eq(renames["NSE:NOVARTIND"]?.to, "EVONILE");
  for (const k of keys) {
    ok(!listed.has(k), `${k} is still listed, so it is not renamed`);
    const ex = k.split(":")[0];
    ok(listed.has(`${ex}:${renames[k].to}`), `${k} points at ${renames[k].to}, which is not listed`);
    ok(/^\d{4}-\d{2}-\d{2}$/.test(renames[k].since), `${k} has a day`);
  }
});

test("the builder records renames only once the new list has passed the shrink guard", () => {
  const src = read("scripts/build-symbols.mjs");
  ok(/import \{ findRenames, mergeRenames \} from "\.\.\/src\/lib\/renames\.js";/.test(src));
  const guard = src.indexOf("Refusing to write");
  const write = src.indexOf("await writeFile(RENAMES");
  ok(guard > 0 && write > guard, "a refused build must not touch the record either");
  ok(/timeZone: "Asia\/Kolkata"/.test(src), "dated by India's day, wherever the job runs");
  ok(!/toISOString\(\)\.slice\(0, 10\)/.test(src), "never the UTC day");
});

test("Holdings marks a renamed holding, once per stock, in India only", () => {
  const h = read("src/components/journal/Holdings.jsx");
  ok(/import \{ useRenames \} from "@\/lib\/useRenames";/.test(h));
  ok(/\{renameMark\(g\.symbol, g\.exchange\)\}/.test(h), "on the grouped row");
  ok(/\{!nested && renameMark\(r\.symbol, r\.exchange\)\}/.test(h), "on a position, not on each lot under it");
  ok(/now \{rn\.to\}/.test(h), "it says what to type");
  ok(/activeRegion\(\) === "IN"/.test(read("src/lib/useRenames.js")), "a US book has no ISINs to follow");
});

/**
 * THE WEEKLY JOB COMMITS FIVE FILES BY NAME, AND NOTHING ELSE.
 *
 * The repo is public, and one `git add -A` has already pushed a PAN to it.
 * A job that commits on its own, unwatched, must name what it commits.
 */
test("the weekly job refreshes on a schedule and on demand, naming its files", () => {
  const y = read(".github/workflows/refresh-symbols.yml");
  ok(/schedule:\s*\n\s*- cron: "30 2 \* \* 6"/.test(y), "Saturday 08:00 IST");
  ok(/workflow_dispatch:/.test(y), "and a Run button, to test it by hand");
  ok(/contents: write/.test(y));
  for (const s of ["symbols", "symbols:us", "sectors", "sectors:us", "probe", "probe:tz"]) {
    ok(new RegExp(`npm run ${s}\\s*$`, "m").test(y), `runs ${s}`);
  }
  ok(/git add public\/symbols\.json public\/symbols\.us\.json public\/sectors\.json public\/sectors\.us\.json public\/renames\.json\s*$/m.test(y),
     "adds exactly the five data files");
  ok(!/git add (-A|--all|\.)(\s|$)/m.test(y), "never everything");
  ok(/git diff --cached --quiet/.test(y), "commits only when something changed");
});
