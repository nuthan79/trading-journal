import { test, eq, ok } from "./harness.mjs";
import {
  FIELDS, fieldOf, opsFor, arityOf, matchesRule, matches, isComplete,
  windowFor, describeFilter, suggestName, seedFromTab, withField, withOp,
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

test("an unknown field never silently drops every trade", () => {
  /* A saved view survives a field being renamed in a later version. Matching
     nothing would look like the journal had emptied; ignoring the rule shows
     too much, which is visible and recoverable. */
  eq(matchesRule(T(), R("field_that_no_longer_exists", "gt", 0)), true);
  eq(matches(T(), F([R("gone", "gt", 0)])), true);
});
