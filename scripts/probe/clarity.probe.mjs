import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * A NEW USER HAS TO BE ABLE TO FIND THINGS WITHOUT BEING TOLD WHERE THEY ARE.
 *
 * Pinned from a review of the whole app, whose finding was that it explains
 * itself well inside each section and barely at all at the level where
 * someone decides where to go. Each test here is one of those gaps, closed.
 */

/* 1 — Import was reachable only from a button inside the settings sheet. */
test("Import is in the main navigation", () => {
  const src = read("app/(app)/layout.jsx");
  ok(/\{ id: "import", href: "\/import", label: "Import"/.test(src),
    "the fastest way to a full journal must not live behind Settings");
});

test("the sample-data banner points at Import", () => {
  /* The one thing every new user reads — the journal is sample data until
     their first trade. */
  const src = read("components/journal/DemoBanner.jsx");
  ok(/href="\/import"/.test(src));
});

test("an empty journal offers Import, and a filtered-out view does not claim to be empty", () => {
  const src = read("components/journal/Trades.jsx");
  const empty = src.slice(src.indexOf("rows.length === 0 ?"), src.indexOf('<table className="t">'));
  ok(/all\.length === 0/.test(empty), "must tell an empty journal from an empty filter");
  ok(/href="\/import"/.test(empty), "the empty journal offers the importer");
  ok(/No trades match/.test(empty), "and a filter with no matches says so, not 'nothing here yet'");
});
