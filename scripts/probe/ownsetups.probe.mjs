import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { customPatterns, patternOptions, checkPatternName, patternUsage,
         MAX_CUSTOM_PATTERNS } from "@/lib/patterns";
import { PATTERNS } from "@/lib/constants";
import { dimensionRows } from "@/lib/edge";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * A TRADER'S OWN SETUPS — three, beside the built-in eleven.
 *
 * The four rules this was built to, each of which is a way it goes wrong:
 * a trade never loses its setup; renaming moves the history; a name in use
 * cannot be deleted; near-duplicates are refused.
 */
const withMine = (...names) => ({ custom_patterns: names });

test("the profile's list is read safely, capped and de-duplicated", () => {
  eq(customPatterns(null).length, 0, "no profile is not a crash");
  eq(customPatterns({}).length, 0, "nor is a profile from before the migration");
  eq(customPatterns({ custom_patterns: "Support" }).length, 0, "nor is a stray string");
  eq(customPatterns(withMine("A", "B", "C", "D")).join(), "A,B,C", `${MAX_CUSTOM_PATTERNS} is the cap`);
  eq(customPatterns(withMine("Support Entry", "support entry")).join(), "Support Entry");
});

test("RULE 1: a trade keeps a setup the list no longer offers", () => {
  /* Removed from the list, or retired from the built-ins as Power Play was in
     023. Either way the option is still there on the trade that carries it. */
  ok(patternOptions(withMine("Support Entry"), "Bounce Back").includes("Bounce Back"),
     "an unlisted value the trade already has is offered");
  ok(patternOptions(withMine(), "Power Play").includes("Power Play"));
  /* And nothing is lost from the built-ins. */
  for (const p of PATTERNS) ok(patternOptions(withMine("X")).includes(p), `${p} still offered`);
});

test("the trader's own sit before Other, which stays last", () => {
  const opts = patternOptions(withMine("Support Entry"));
  eq(opts[opts.length - 1], "Other");
  ok(opts.indexOf("Support Entry") < opts.indexOf("Other"));
  eq(opts.filter((o) => o === "Support Entry").length, 1, "listed once");
});

test("RULE 4: near-duplicates are refused, against the built-ins too", () => {
  eq(checkPatternName("", []), "Give the setup a name.");
  ok(/already in the list/.test(checkPatternName("flat base", [])), "case alone is not a new setup");
  ok(/already in the list/.test(checkPatternName("High-Tight-Flag", [])), "nor is punctuation");
  ok(/already have/.test(checkPatternName("SUPPORT ENTRY", ["Support Entry"])));
  ok(/under 24 characters/.test(checkPatternName("x".repeat(25), [])));
  eq(checkPatternName("Support Entry", ["Bounce Back"]), null, "a genuinely new name passes");
});

test("RULE: three is the limit, and it says why", () => {
  const full = ["A", "B", "C"];
  const msg = checkPatternName("D", full);
  ok(/Three is the limit/.test(msg) && /too small to read/.test(msg),
     "the reason is the breakdowns, and it is given");
});

test("RULE 3: usage is counted so a delete can be refused with a number", () => {
  const book = [{ pattern: "Support Entry" }, { pattern: "support entry" },
                { pattern: "VCP" }, { pattern: null }];
  eq(patternUsage(book, "Support Entry"), 2, "counted however it was typed");
  eq(patternUsage(book, "Bounce Back"), 0);
  const src = read("components/journal/OwnSetups.jsx");
  ok(/still use/.test(src) && /Rename it, or change those trades first/.test(src),
     "the refusal names the count and what to do");
});

test("RULE 2: renaming writes the trades, and only then the list", () => {
  const db = read("lib/db.js");
  ok(/export async function renamePattern/.test(db));
  ok(/\.eq\("user_id", id\)\.eq\("pattern", before\)/.test(db),
     "scoped to this user: pattern is free text and another book's is not ours");
  const src = read("components/journal/OwnSetups.jsx");
  const work = src.indexOf("if (work) await work();");
  const save = src.indexOf("saveProfile({ custom_patterns: list })");
  ok(work > 0 && work < save,
     "trades first — a list saved without them splits one setup across two names");
});

test("a custom setup is just a string to the breakdowns", () => {
  /* The point of the whole design: nothing in the analysis knows about the
     list. It groups by what the trade says. */
  const t = (pattern, r) => ({ pattern, status: "closed", r, rMultiple: r,
                               pnl: r * 1000, exit_date: "2026-01-01", stop_source: "recorded" });
  const rows = dimensionRows(
    [t("Support Entry", 2), t("Support Entry", -1), t("VCP", 1)], "pattern");
  const mine = rows.find((x) => x.key === "Support Entry");
  ok(mine, "the trader's own setup appears as its own row");
  eq(mine.trades, 2);
});

test("the form and the filters both offer them", () => {
  const form = read("components/journal/TradeForm.jsx");
  ok(/patternOptions\(profile, t\.pattern\)/.test(form), "the form asks for this profile's list");
  ok(!/\{PATTERNS\.map/.test(form), "and no longer renders the built-ins alone");
  const views = read("components/journal/SavedViews.jsx");
  ok(/field === "pattern" \? patternsInBook/.test(views),
     "a filter can pick a setup the book actually uses");
});
