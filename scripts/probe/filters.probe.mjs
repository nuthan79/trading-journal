import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, eq, ok } from "./harness.mjs";
import {
  FIELDS, fieldOf, opsFor, arityOf, matchesRule, matches, isComplete,
  windowFor, describeFilter, suggestName, seedFromTab, withField, withOp,
  sortForFilter, realisedWindow,
} from "@/lib/filters";

const T = (o = {}) => ({
  id: "t1", symbol: "RELIANCE", exchange: "NSE", side: "long", status: "closed",
  entry_date: "2026-05-10", exit_date: "2026-06-02",
  pnl: 12000, r: 1.4, slPct: 6.5, heldDays: 23, mistakes: [], stop_source: "recorded",
  ...o,
});

const R = (field, op, value, value2) => ({ field, op, value, value2 });
const F = (rules, conjunction = "and") => ({ rules, conjunction });

/* ------------------------------------------------------------------ */

test("every field offers operators, and every operator has a label", () => {
  for (const f of FIELDS) {
    const ops = opsFor(f.type);
    ok(ops.length > 0, `${f.key} (${f.type}) has no operators`);
    for (const o of ops) ok(!!o.label, `${f.key}/${o.op} has no label`);
  }
});

test("an enum field always carries the options its operators need", () => {
  /* "is any of" draws a picker from field.options. A field typed enum with no
     options renders an empty dropdown — a rule that can never be completed. */
  for (const f of FIELDS) {
    if (f.type === "enum" || f.type === "tags") {
      ok(Array.isArray(f.options) && f.options.length > 0,
         `${f.key} is ${f.type} but has no options to pick from`);
    }
  }
});

/* ------------------------------------------------------------------ */

test("numbers compare, and the boundary operators mean the boundary", () => {
  eq(matchesRule(T(), R("pnl", "gt", 0)), true);
  eq(matchesRule(T({ pnl: -5 }), R("pnl", "gt", 0)), false);
  eq(matchesRule(T({ pnl: 0 }), R("pnl", "gt", 0)), false, "zero is not above zero");
  eq(matchesRule(T({ pnl: 0 }), R("pnl", "lte", 0)), true, "but it is at most zero");
  eq(matchesRule(T({ pnl: 0 }), R("pnl", "lt", 0)), false);
  eq(matchesRule(T({ pnl: 0 }), R("pnl", "gte", 0)), true);
  eq(matchesRule(T({ r: 2.5 }), R("r", "between", 2, 3)), true);
  eq(matchesRule(T({ r: 2.5 }), R("r", "between", 3, 2)), true, "a reversed range still reads as one");
  eq(matchesRule(T({ r: 3.5 }), R("r", "between", 2, 3)), false);
});

test("a trade with no R is not a trade with R of zero", () => {
  /* The whole reason hasRealStop exists. A stopless trade has r === NaN, and
     NaN silently fails every comparison — which is the behaviour we want, but
     it must be the DECLARED behaviour, not luck. */
  const noR = T({ r: NaN, pnl: 9000 });
  eq(matchesRule(noR, R("r", "lt", 1)), false, "absent must not read as small");
  eq(matchesRule(noR, R("r", "gt", -1)), false, "nor as large");
  eq(matchesRule(noR, R("r", "eq", 0)), false, "nor as zero");
  eq(matchesRule(noR, R("r", "between", -99, 99)), false);
  eq(matchesRule(noR, R("r", "empty")), true, "empty is the only way to ask for it");
  eq(matchesRule(T({ r: 1.4 }), R("r", "empty")), false);
  eq(matchesRule(noR, R("pnl", "gt", 0)), true, "and its money is still knowable");
});

test("null and undefined are absent, not zero", () => {
  for (const v of [null, undefined, "", NaN]) {
    eq(matchesRule(T({ rs_rank: v }), R("rs_rank", "lt", 50)), false, `rs_rank=${String(v)}`);
    eq(matchesRule(T({ rs_rank: v }), R("rs_rank", "empty")), true);
  }
});

/* ------------------------------------------------------------------ */

test("dates compare by day, whatever the stamp carries", () => {
  const t = T({ entry_date: "2026-05-10T00:00:00.000Z" });
  eq(matchesRule(t, R("entry_date", "after", "2026-05-10")), true, "inclusive on the day");
  eq(matchesRule(t, R("entry_date", "before", "2026-05-10")), true);
  eq(matchesRule(t, R("entry_date", "after", "2026-05-11")), false);
  eq(matchesRule(t, R("entry_date", "between", "2026-01-01", "2026-12-31")), true);
  eq(matchesRule(T({ exit_date: null }), R("exit_date", "empty")), true, "an open trade");
  eq(matchesRule(T({ exit_date: null }), R("exit_date", "after", "2020-01-01")), false);
});

/* eq is Object.is, so two equal arrays are never the same array. */
const win = (preset, d) => (windowFor(preset, d) || []).join(" to ");

test("the financial year runs April to March, and follows calc.js", () => {
  /* Two definitions of "this year" would disagree by a day at the boundary —
     on 31 March, when it matters most. */
  eq(win("thisfy", new Date(2026, 2, 31)), "2025-04-01 to 2026-03-31",
     "31 March is still the OLD financial year");
  eq(win("thisfy", new Date(2026, 3, 1)), "2026-04-01 to 2027-03-31",
     "1 April starts the new one");
  eq(win("lastfy", new Date(2026, 3, 1)), "2025-04-01 to 2026-03-31");
  eq(win("thiscal", new Date(2026, 3, 1)), "2026-01-01 to 2026-12-31",
     "the calendar year is a different question");
  eq(windowFor("nonsense", new Date(2026, 3, 1)), null);

  /* And the window is what "is in" actually asks against. Pinned to a fixed
     date rather than to today, or the probe would mean something different
     each side of an April. */
  const inFY = (entry, now) => {
    const w = windowFor("thisfy", now);
    return entry >= w[0] && entry <= w[1];
  };
  eq(inFY("2026-03-31", new Date(2026, 2, 15)), true, "March asks about FY25-26");
  eq(inFY("2026-03-31", new Date(2026, 5, 15)), false, "June asks about FY26-27");
});

/* ------------------------------------------------------------------ */

test("tags ask about a list, not about a string", () => {
  const t = T({ mistakes: ["Oversized", "Chased extended"] });
  eq(matchesRule(t, R("mistakes", "includes", ["Oversized"])), true);
  eq(matchesRule(t, R("mistakes", "includes", ["Oversized", "Revenge trade"])), true, "any of");
  eq(matchesRule(t, R("mistakes", "includesall", ["Oversized", "Revenge trade"])), false, "all of");
  eq(matchesRule(t, R("mistakes", "includesall", ["Oversized", "Chased extended"])), true);
  eq(matchesRule(t, R("mistakes", "excludes", ["Revenge trade"])), true);
  eq(matchesRule(t, R("mistakes", "excludes", ["Oversized"])), false);
  eq(matchesRule(T({ mistakes: [] }), R("mistakes", "empty")), true);
  eq(matchesRule(T({ mistakes: null }), R("mistakes", "empty")), true, "null is empty too");
  eq(matchesRule(t, R("mistakes", "notempty")), true);
});

test("enum and text match case-insensitively", () => {
  eq(matchesRule(T({ status: "closed" }), R("status", "anyof", ["closed"])), true);
  eq(matchesRule(T({ status: "closed" }), R("status", "anyof", ["Closed"])), true, "case");
  eq(matchesRule(T({ status: "open" }), R("status", "noneof", ["closed"])), true);
  eq(matchesRule(T({ symbol: "RELIANCE" }), R("symbol", "contains", "reli")), true);
  eq(matchesRule(T({ notes: "Broke out on volume" }), R("notes", "contains", "VOLUME")), true);
  eq(matchesRule(T({ notes: "" }), R("notes", "empty")), true);
  eq(matchesRule(T({ notes: "   " }), R("notes", "empty")), true, "whitespace is empty");
});

/* ------------------------------------------------------------------ */

test("a half-written rule filters nothing out", () => {
  /* The builder shows a live count WHILE you type, so incomplete is the
     normal state. Applying it would drop the count to zero the moment a new
     row appears and make the preview useless exactly when it is read. */
  eq(isComplete(R("pnl", "gt", "")), false);
  eq(isComplete(R("pnl", "gt", 0)), true, "zero is a value, not a blank");
  eq(isComplete(R("r", "between", 1, "")), false);
  eq(isComplete(R("r", "between", 1, 2)), true);
  eq(isComplete(R("mistakes", "includes", [])), false);
  eq(isComplete(R("r", "empty")), true, "needs no value at all");
  eq(isComplete(R("", "", "")), false);

  eq(matches(T({ pnl: -1 }), F([R("pnl", "gt", "")])), true, "ignored, not applied");
  eq(matches(T(), F([])), true, "no rules is not no trades");
});

test("and narrows, or widens", () => {
  const t = T({ pnl: 12000, slPct: 6.5 });
  eq(matches(t, F([R("pnl", "gt", 0), R("slPct", "lt", 5)])), false);
  eq(matches(t, F([R("pnl", "gt", 0), R("slPct", "lt", 5)], "or")), true);
  eq(matches(t, F([R("pnl", "lt", 0), R("slPct", "lt", 5)], "or")), false);
});

/* ------------------------------------------------------------------ */

test("the tab seeds reproduce the tab exactly, boundary included", () => {
  /* Trades.jsx counts a break-even trade as a LOSER (pnl <= 0). A seed that
     used "is below" would move those trades to the other side while the
     builder's count still looked right. */
  const breakeven = T({ pnl: 0 });
  eq(matches(breakeven, F(seedFromTab("losers"))), true, "break-even is a loser, as on the tab");
  eq(matches(breakeven, F(seedFromTab("winners"))), false);
  eq(matches(T({ pnl: 5 }), F(seedFromTab("winners"))), true);
  eq(matches(T({ status: "open" }), F(seedFromTab("open"))), true);
  eq(matches(T({ status: "open" }), F(seedFromTab("closed"))), false);
  eq(matches(T({ stop_source: "none" }), F(seedFromTab("nostop"))), true);
  eq(matches(T({ stop_source: "assumed" }), F(seedFromTab("nostop"))), false,
     "assumed is a to-do, not an answer");
  eq(seedFromTab("all").length, 0, "All seeds nothing, because it narrows nothing");

  /* Every seeded rule must be complete, or "Save what I am looking at" opens
     a builder with the Save button already disabled. */
  for (const tab of ["open", "closed", "winners", "losers", "nostop"]) {
    for (const r of seedFromTab(tab)) {
      ok(isComplete(r), `${tab} seeds an unfinished rule`);
      ok(!!fieldOf(r.field), `${tab} seeds an unknown field: ${r.field}`);
      const ops = opsFor(fieldOf(r.field).type).map((o) => o.op);
      ok(ops.includes(r.op), `${tab} seeds ${r.op}, which ${r.field} does not offer`);
    }
  }
});

/* ------------------------------------------------------------------ */

test("changing the field or the operator does not strand the old value", () => {
  /* A value typed for one shape must not survive into another: ["Oversized"]
     left behind in a numeric box, or a lone number left in a range, both
     produce a rule that looks finished and matches nothing. */
  const tags = withField({}, "mistakes");
  eq(Array.isArray(tags.value), true, "a picker starts as a list");
  const money = withField({ ...tags, value: ["Oversized"] }, "pnl");
  eq(money.value, "", "the list did not follow into a number box");
  eq(money.op, opsFor("money")[0].op);

  const range = withOp({ field: "pnl", op: "gt", value: 5, value2: "" }, "between");
  eq(range.value, "", "widening to a range clears rather than half-fills");
  const back = withOp({ field: "pnl", op: "gt", value: 5, value2: "" }, "lt");
  eq(back.value, 5, "but same-shaped operators keep what you typed");
});

test("arity says how many boxes to draw, for every field and operator", () => {
  for (const f of FIELDS) {
    for (const o of opsFor(f.type)) {
      const n = arityOf(f.type, o.op);
      ok(n === 0 || n === 1 || n === 2 || n === "many",
         `${f.key}/${o.op} has arity ${String(n)}`);
    }
  }
});

/* ------------------------------------------------------------------ */

test("a filter reads back as a sentence", () => {
  const f = F([R("pnl", "lt", 0), R("mistakes", "includes", ["Oversized"])]);
  const s = describeFilter(f);
  ok(s.includes("Net P&L"), s);
  ok(s.includes("is below"), s);
  ok(s.includes(" and "), s);
  ok(!s.includes("undefined"), `a label went missing: ${s}`);
  ok(!s.includes("[object"), `an object reached the text: ${s}`);

  eq(describeFilter(F([])), "Every trade");
  ok(suggestName(f).length > 0, "a name is proposed so saving is one click");
  eq(suggestName(F([])), "", "and nothing is proposed for nothing");

  /* Every operator on every field must produce readable text — this is what
     the chip above the table prints. */
  let seen = 0;
  for (const fl of FIELDS) {
    for (const o of opsFor(fl.type)) {
      const rule = { field: fl.key, op: o.op, value: fl.options ? [fl.options[0]] : "1",
                     value2: "2" };
      const txt = describeFilter(F([rule]));
      ok(!txt.includes("undefined") && !txt.includes("[object"),
         `${fl.key}/${o.op} reads as: ${txt}`);
      seen++;
    }
  }
  ok(seen > 60, `only ${seen} field/operator pairs were exercised`);
});

/* ------------------------------------------------------------------ */

test("every sortable field has a real column in the trades table", () => {
  /* sortable means "the table has a th() for this". Sorting on a field with
     no header reorders the list with nothing on screen to explain why, and
     the arrow that says which column is driving it has nowhere to appear.
     Read out of Trades.jsx so the two cannot drift apart. */
  const src = readFileSync(path.resolve(
    fileURLToPath(import.meta.url), "..", "..", "..",
    "src/components/journal/Trades.jsx"), "utf8");
  const columns = new Set(
    [...src.matchAll(/\bth\("([a-zA-Z_]+)"/g)].map((m) => m[1]));
  ok(columns.size > 10, `only ${columns.size} th() columns parsed — has the syntax changed?`);

  for (const f of FIELDS) {
    if (f.sortable) {
      ok(columns.has(f.key),
         `${f.key} is marked sortable but Trades.jsx has no th("${f.key}")`);
    }
  }
});

test("a view opens in the order the question implies", () => {
  const F1 = (field, op, value) => ({ conjunction: "and",
    rules: [{ field, op, value, value2: "" }] });

  /* Reaching upward puts the largest first — the whole point of asking. */
  eq(JSON.stringify(sortForFilter(F1("r", "gt", 5))), '{"k":"r","dir":-1}');
  eq(JSON.stringify(sortForFilter(F1("r", "gte", 5))), '{"k":"r","dir":-1}');

  /* Reaching down puts the worst first: "Net P&L is at most 0" opens on the
     biggest loss, not on the trade that lost eleven rupees. */
  eq(JSON.stringify(sortForFilter(F1("pnl", "lte", 0))), '{"k":"pnl","dir":1}');
  eq(JSON.stringify(sortForFilter(F1("pnl", "lt", 0))), '{"k":"pnl","dir":1}');

  /* Dates are newest-first, like every other list in the app. */
  eq(JSON.stringify(sortForFilter(F1("exit_date", "after", "2025-03-15"))),
     '{"k":"exit_date","dir":-1}');

  /* A middle has no direction, and neither does a name. */
  eq(sortForFilter({ conjunction: "and",
    rules: [{ field: "r", op: "between", value: 1, value2: 3 }] }), null);
  eq(sortForFilter(F1("pattern", "anyof", ["VCP"])), null, "no order in a pattern name");
  eq(sortForFilter(F1("r", "empty")), null);
  eq(sortForFilter({ rules: [] }), null);

  /* Fields with no column are skipped rather than sorted on invisibly. */
  eq(sortForFilter(F1("charges", "gt", 500)), null, "charges has no column");
  eq(sortForFilter(F1("mfe_r", "gt", 2)), null, "mfe_r has no column");

  /* The FIRST condition that yields an order wins — a rule somebody can hold
     in their head, unlike a scoring scheme across several conditions. */
  eq(JSON.stringify(sortForFilter({ conjunction: "and", rules: [
    { field: "pattern", op: "anyof", value: ["VCP"] },
    { field: "r", op: "gt", value: 2, value2: "" },
    { field: "pnl", op: "gt", value: 0, value2: "" },
  ] })), '{"k":"r","dir":-1}', "pattern gives no order, so R decides — not P&L");

  /* An incomplete condition must not steer the order either. */
  eq(JSON.stringify(sortForFilter({ conjunction: "and", rules: [
    { field: "pnl", op: "gt", value: "", value2: "" },
    { field: "r", op: "gt", value: 2, value2: "" },
  ] })), '{"k":"r","dir":-1}');

  /* A stored sort beats derivation. Nothing writes one yet. */
  eq(JSON.stringify(sortForFilter({ sort_key: "heldDays", sort_dir: 1,
    rules: [{ field: "r", op: "gt", value: 5, value2: "" }] })),
    '{"k":"heldDays","dir":1}');
});

test("the suggested name is recognisable as its own suggestion", () => {
  /* How the builder decides whether an EDIT's name should keep following the
     rules: a name equal to the suggestion was generated and should track; any
     other name was typed and is the user's. That test only works while
     suggestName is a pure function of the rules — if it ever picked up a
     timestamp or a count of anything outside them, every saved name would
     stop matching and every edit would start overwriting chosen names. */
  const f = { conjunction: "and",
    rules: [{ field: "r", op: "gt", value: 2, value2: "" }] };
  eq(suggestName(f), suggestName({ ...f, name: "Big winners" }),
     "the name must not feed back into the suggestion");
  eq(suggestName(f), suggestName({ ...f, id: "x", position: 4 }),
     "nor may anything else stored alongside the rules");
  eq(suggestName(f) === "R multiple is above 2", true, suggestName(f));
});

test("an unknown field never silently drops every trade", () => {
  /* A saved view survives a field being renamed in a later version. Matching
     nothing would look like the journal had emptied; ignoring the rule shows
     too much, which is visible and recoverable. */
  eq(matchesRule(T(), R("field_that_no_longer_exists", "gt", 0)), true);
  eq(matches(T(), F([R("gone", "gt", 0)])), true);
});

test("'sold on' asks about every sell; 'exit date' asks about the last one", () => {
  /* The distinction that surfaced the periodisation bug. A view for the
     financial year matched a position whose FIRST sells were sixteen months
     earlier, because the position finished inside the year. Both questions
     are legitimate; they were just not both askable. */
  const split = {
    id: "pgel", status: "closed",
    entry_date: "2024-05-28", exit_date: "2025-08-28",
    exits: [{ exit_date: "2024-11-19" }, { exit_date: "2025-05-07" },
            { exit_date: "2025-08-28" }],
  };
  const fy2526 = (field) => ({ field, op: "between",
    value: "2025-04-01", value2: "2026-03-31" });
  const fy2425 = (field) => ({ field, op: "between",
    value: "2024-04-01", value2: "2025-03-31" });

  eq(matchesRule(split, fy2526("exit_date")), true, "it did finish in FY25-26");
  eq(matchesRule(split, fy2425("exit_date")), false, "and not in FY24-25");
  eq(matchesRule(split, fy2526("soldOn")), true, "it sold in FY25-26");
  eq(matchesRule(split, fy2425("soldOn")), true, "AND in FY24-25 — the point");

  /* On a position closed in one go the two must agree exactly, or the new
     field is a second answer to a question that only has one. */
  const whole = { id: "w", status: "closed", exit_date: "2025-06-10",
                  exits: [{ exit_date: "2025-06-10" }] };
  for (const f of [fy2526, fy2425]) {
    eq(matchesRule(whole, f("soldOn")), matchesRule(whole, f("exit_date")),
       "the two fields disagree on a position with one sell");
  }

  /* A legacy row with no tranche list is still findable. */
  const legacy = { id: "l", status: "closed", exit_date: "2025-06-10" };
  eq(matchesRule(legacy, fy2526("soldOn")), true);

  /* And the unknown-field escape hatch must not be what makes it work: an
     unknown field returns TRUE by design, so a broken implementation would
     match everything and look correct. */
  eq(matchesRule(split, { ...fy2425("soldOn"), op: "after", value: "2030-01-01" }), false,
     "soldOn is matching everything — it is falling through to the unknown-field path");
});

test("a view's date window is read only from the SELL dates", () => {
  /* The footer uses this to say how much of the money on screen landed inside
     the window. A window on entry_date bounds when positions were OPENED and
     says nothing about when money arrived — asking it for a realised figure
     would produce a number that looks like an answer and is not. */
  const V = (rules, conjunction = "and") => ({ rules, conjunction });
  const between = (field) => ({ field, op: "between",
    value: "2025-04-01", value2: "2026-03-31" });

  eq(JSON.stringify(realisedWindow(V([between("exit_date")]))),
     '{"from":"2025-04-01","to":"2026-03-31"}');
  eq(JSON.stringify(realisedWindow(V([between("soldOn")]))),
     '{"from":"2025-04-01","to":"2026-03-31"}');
  eq(realisedWindow(V([between("entry_date")])), null, "entry dates bound nothing here");
  eq(realisedWindow(V([{ field: "r", op: "gt", value: 3 }])), null);

  /* A reversed range still reads as one, the same as the matcher. */
  eq(JSON.stringify(realisedWindow(V([{ field: "exit_date", op: "between",
      value: "2026-03-31", value2: "2025-04-01" }]))),
     '{"from":"2025-04-01","to":"2026-03-31"}');

  /* Open-ended is still a window. */
  ok(realisedWindow(V([{ field: "exit_date", op: "after", value: "2025-04-01" }])).to > "2100");
  ok(realisedWindow(V([{ field: "exit_date", op: "before", value: "2026-03-31" }])).from < "1900");

  /* Ambiguous cases give nothing rather than a guess: two windows, or an OR
     where "inside the window" stops having one meaning. */
  eq(realisedWindow(V([between("exit_date"), between("soldOn")])), null, "two windows");
  eq(realisedWindow(V([between("exit_date")], "or")), null, "an OR");
  eq(realisedWindow(V([{ field: "exit_date", op: "between", value: "", value2: "" }])), null,
     "an unfinished rule is not a window");
  eq(realisedWindow(null), null);

  /* And it must not fire on a rule that has no window at all. */
  eq(realisedWindow(V([{ field: "exit_date", op: "empty" }])), null);
});
