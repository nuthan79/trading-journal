import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, eq, ok } from "./harness.mjs";
import { isOpen, isClosed, isPartial, derivePosition } from "@/lib/positions";
import { matches, seedFromTab, fieldOf } from "@/lib/filters";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("a part-sold position is open", () => {
  eq(isOpen({ status: "partial" }), true, "this is the whole bug");
  eq(isOpen({ status: "open" }), true);
  eq(isOpen({ status: "closed" }), false);
  eq(isClosed({ status: "partial" }), false);
  eq(isClosed({ status: "closed" }), true);
  eq(isPartial({ status: "partial" }), true);
  eq(isPartial({ status: "open" }), false);

  /* Every status must land in exactly one of the two states — the failure was
     a position that belonged to neither and vanished from both tabs. */
  for (const status of ["open", "partial", "closed"]) {
    const t = { status };
    eq(isOpen(t) !== isClosed(t), true, `${status} is in neither state or in both`);
  }
  for (const junk of [null, undefined, {}, { status: "" }]) {
    eq(isOpen(junk), false);
    eq(isClosed(junk), false);
  }
});

test("derivePosition really does produce 'partial'", () => {
  /* If it never did, the predicates above would be guarding nothing. */
  const t = { entry_price: 100, quantity: 100, stop_loss: 93, charges: 0,
              exits: [{ exit_date: "2026-05-01", quantity: 40, price: 120 }] };
  eq(derivePosition(t, 1e6).status, "partial");
  eq(derivePosition({ ...t, exits: [] }, 1e6).status, "open");
  eq(derivePosition({ ...t, exits: [{ exit_date: "2026-05-01", quantity: 100, price: 120 }] },
     1e6).status, "closed");
});

test("the Open tab's saved-view seed means the same as the tab", () => {
  const part = { status: "partial", pnl: 500 };
  eq(matches(part, { conjunction: "and", rules: seedFromTab("open") }), true,
     "seeding only 'open' would exclude the position the tab now includes");
  eq(matches({ status: "closed" }, { conjunction: "and", rules: seedFromTab("open") }), false);
  eq(matches(part, { conjunction: "and", rules: seedFromTab("closed") }), false);
});

test("a saved view can ask for every status the schema stores", () => {
  /* Offering only open and closed made a part-sold position unaskable. */
  const f = fieldOf("status");
  for (const v of ["open", "partial", "closed"]) {
    ok(f.options.includes(v), `Status cannot be filtered on "${v}"`);
    ok(f.display?.[v], `"${v}" has no readable label`);
  }
});

test("nobody hand-writes the open test any more", () => {
  /* The rule had six copies and the seventh got it wrong. This fails on a new
     one, wherever it appears. */
  const files = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(full); }
      else if (/\.(js|jsx)$/.test(e.name)) files.push(full);
    }
  })(path.join(root, "src"));

  const pattern = /status\s*===\s*["']partial["']/g;
  const allowed = new Set([
    "src/lib/positions.js",                       // where the rule and the status live
    "src/components/journal/TradeForm.jsx",        // labels a form state, not a filter
    "src/components/journal/Holdings.jsx",         // draws the "part sold" tag
  ]);
  const offenders = [];
  for (const f of files) {
    const rel = path.relative(root, f);
    if (allowed.has(rel)) continue;
    const hits = (readFileSync(f, "utf8").match(pattern) || []).length;
    if (hits) offenders.push(`${rel} (${hits})`);
  }
  eq(offenders.length, 0,
     `a hand-written partial test is back in: ${offenders.join(", ")} — use isOpen/isPartial`);

  /* And the guard against this test passing because the pattern is wrong. */
  const known = readFileSync(path.join(root, "src/lib/positions.js"), "utf8");
  ok(pattern.test(known), "the pattern matches nothing at all — it is not testing anything");
});

test("the Open and Closed tabs go through the predicates", () => {
  /* THE GUARD ABOVE DID NOT CATCH THE ACTUAL BUG. It looks for a hand-written
     `status === "partial"`, and the fault was `status === "open"` — a
     different string, so reintroducing the bug left every probe passing. A
     regression guard that does not fail on the regression it was written for
     is worse than none, because it is read as coverage.
     
     This one names the two lines that were wrong. */
  const src = readFileSync(path.join(root, "src/components/journal/Trades.jsx"), "utf8");
  ok(/filter === "open"\)\s*r = r\.filter\(isOpen\)/.test(src),
     'the Open tab is not filtering with isOpen — a part-sold position will ' +
     'fall out of both tabs again');
  ok(/filter === "closed"\)\s*r = r\.filter\(isClosed\)/.test(src),
     "the Closed tab is not filtering with isClosed");
  ok(!/filter === "open"\)\s*r = r\.filter\(\(t\) => t\.status/.test(src),
     "the Open tab is back to testing the status string by hand");
});

test("the SQL twin still asks for both", () => {
  /* db.js cannot import isOpen, so its .in(...) is the one copy that has to be
     kept in step by hand. Named here so it is not forgotten. */
  const db = readFileSync(path.join(root, "src/lib/db.js"), "utf8");
  ok(/\.in\("status",\s*\["open",\s*"partial"\]\)/.test(db),
     'db.js no longer queries .in("status", ["open", "partial"])');
});
