/**
 * Saved views — what a filter is, and what it is allowed to ask.
 *
 * THE SHAPE IS FLAT ON PURPOSE.
 *
 * A filter is a list of rules joined by one conjunction:
 *
 *   { name, conjunction: "and" | "or", rules: [{ field, op, value, value2 }] }
 *
 * There are no nested groups, and that is a decision rather than an omission.
 * Nesting is where a filter UI turns into a database console: `(A and B) or
 * (C and not D)` cannot be read without parentheses, cannot be edited without
 * understanding them, and every builder that offers it ends up drawing a tree
 * nobody can follow at a glance.
 *
 * What nesting is usually FOR is absorbed by one operator instead. The common
 * case is "RELIANCE or TCS or INFY, and this financial year" — a group in a
 * tree, but really one field with several accepted values. `is any of` says
 * that in one row. Between that and `is between` on the numeric fields, the
 * flat list covers the filters a trader actually writes.
 *
 * If a real case turns up that a flat list genuinely cannot express, the shape
 * above can grow a nested node without breaking a saved filter: every existing
 * rule stays a leaf. Better to add it against a concrete example than to ship
 * the tree first and discover nobody wanted it.
 *
 * EVERY VALUE IS COMPARED AGAINST THE DERIVED ROW, NOT THE DB ROW. Trades.jsx
 * filters `all`, which has already been through `withExits()` and
 * `derivePosition()` — so `pnl`, `r`, `slPct`, `heldDays` and `exposure` are
 * present as numbers. A filter written against a raw DB row would silently
 * match nothing on exactly those fields, which are the interesting ones.
 */

import { PATTERNS, EXIT_REASONS, MISTAKES } from "./constants";
import { fyStartYear } from "./calc";

/* ------------------------------------------------------------------ *
 *  Fields
 * ------------------------------------------------------------------ */

/**
 * The vocabulary, grouped the way the trade itself is grouped.
 *
 * `type` decides three things at once: which operators the rule offers, which
 * editor the value gets, and how the comparison is done. That is why there are
 * separate `money`, `percent` and `r` types rather than one `number` — they
 * compare identically but they are typed, displayed and suffixed differently,
 * and a rule that reads "Net P&L is below ₹0" is worth the extra type.
 */
/**
 * `sortable` means THE TRADES TABLE HAS A COLUMN FOR THIS, and nothing more.
 *
 * It is what lets a view open in an order that suits what it asks — "R is
 * above 5" landing biggest-R-first rather than by entry date. The flag is
 * about the column existing, not about the order being meaningful: sorting on
 * a field with no header would reorder the list with nothing on screen to
 * explain why, and the arrow that normally says which column is driving it
 * would have nowhere to appear. `sortForFilter` decides direction separately,
 * and declines on the ones with no natural direction.
 *
 * Kept honest by a probe that reads the th() calls out of Trades.jsx.
 */
export const FIELDS = [
  // --- the position -------------------------------------------------
  { key: "symbol", label: "Symbol", type: "symbol", group: "Position", sortable: true },
  { key: "exchange", label: "Exchange", type: "enum", group: "Position",
    options: ["NSE", "BSE"] },
  { key: "side", label: "Side", type: "enum", group: "Position",
    options: ["long", "short"], display: { long: "Long", short: "Short" } },
  /* All THREE, because the schema stores three. Offering only open and closed
     made a part-sold position unaskable: it matched neither value, so no saved
     view could reach it and "Status is any of Open" quietly excluded positions
     that are open. */
  { key: "status", label: "Status", type: "enum", group: "Position",
    options: ["open", "partial", "closed"],
    display: { open: "Open", partial: "Part sold", closed: "Closed" } },
  { key: "broker", label: "Broker", type: "text", group: "Position" },
  { key: "quantity", label: "Quantity", type: "number", group: "Position", sortable: true },
  { key: "entry_price", label: "Entry price", type: "money", group: "Position", sortable: true },
  { key: "exposure", label: "Position size", type: "money", group: "Position", sortable: true },

  // --- dates --------------------------------------------------------
  { key: "entry_date", label: "Entry date", type: "date", group: "Dates", sortable: true },
  { key: "exit_date", label: "Exit date", type: "date", group: "Dates", sortable: true },
  { key: "heldDays", label: "Days held", type: "number", group: "Dates", unit: "days",
    sortable: true },

  // --- risk ---------------------------------------------------------
  { key: "stop_loss", label: "Stop", type: "money", group: "Risk", sortable: true },
  { key: "slPct", label: "Stop distance", type: "percent", group: "Risk", sortable: true },
  { key: "riskAmt", label: "Risk taken", type: "money", group: "Risk", sortable: true },
  { key: "riskPct", label: "Risk of account", type: "percent", group: "Risk" },
  /* The three stop states, as a filter. This is what makes the "No stop" chip
     expressible as a saved view rather than a hard-coded tab. */
  { key: "stop_source", label: "Stop record", type: "enum", group: "Risk",
    options: ["recorded", "assumed", "none"],
    display: { recorded: "Recorded", assumed: "Assumed by import", none: "No stop on record" } },

  // --- outcome ------------------------------------------------------
  { key: "pnl", label: "Net P&L", type: "money", group: "Outcome", sortable: true },
  { key: "r", label: "R multiple", type: "r", group: "Outcome", sortable: true },
  { key: "exitPct", label: "Return", type: "percent", group: "Outcome", sortable: true },
  { key: "charges", label: "Charges", type: "money", group: "Outcome" },
  { key: "exit_reason", label: "Exit reason", type: "enum", group: "Outcome",
    options: EXIT_REASONS },
  { key: "mfe_r", label: "Best it reached", type: "r", group: "Outcome" },
  { key: "mae_r", label: "Worst it reached", type: "r", group: "Outcome" },

  // --- the setup ----------------------------------------------------
  { key: "pattern", label: "Pattern", type: "enum", group: "Setup",
    options: PATTERNS, sortable: true },
  { key: "weinstein_stage", label: "Weinstein stage", type: "number", group: "Setup",
    sortable: true },
  { key: "rs_rank", label: "RS rank", type: "number", group: "Setup", sortable: true },
  { key: "vol_pct_avg", label: "Breakout volume", type: "percent", group: "Setup",
    sortable: true },
  { key: "distPivot", label: "Distance from pivot", type: "percent", group: "Setup",
    sortable: true },

  // --- review -------------------------------------------------------
  { key: "mistakes", label: "Tags", type: "tags", group: "Review",
    options: MISTAKES },
  { key: "notes", label: "Notes", type: "text", group: "Review" },
];

export const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));
export const fieldOf = (key) => FIELD_BY_KEY.get(key) || null;

export const FIELD_GROUPS = FIELDS.reduce((acc, f) => {
  (acc[f.group] = acc[f.group] || []).push(f);
  return acc;
}, {});

const NUMERIC = new Set(["number", "money", "percent", "r"]);
export const isNumeric = (type) => NUMERIC.has(type);

/* ------------------------------------------------------------------ *
 *  Operators
 * ------------------------------------------------------------------ */

/**
 * Worded for the field, not for the database.
 *
 * A generic `=` on every field is what makes a query builder feel like one.
 * `=` on a date is almost never what somebody means, `=` on a tag list is
 * wrong outright, and `=` on a rupee figure is a coin flip. So each type gets
 * operators phrased the way the question is actually asked, and the row reads
 * as a sentence: "Net P&L · is below · 0".
 */
const OPS = {
  number: [
    { op: "gt", label: "is above" },
    { op: "lt", label: "is below" },
    /* "at least" and "at most" are here because the boundary is often the
       whole question — a break-even trade is not a winner, and "Losers" on
       this screen has always meant P&L at most zero. Without them the nearest
       expressible rule quietly moves those trades to the other side. */
    { op: "gte", label: "is at least" },
    { op: "lte", label: "is at most" },
    { op: "between", label: "is between", arity: 2 },
    { op: "eq", label: "equals" },
    { op: "empty", label: "is not recorded", arity: 0 },
  ],
  date: [
    { op: "within", label: "is in", arity: 1 },
    { op: "after", label: "is on or after" },
    { op: "before", label: "is on or before" },
    { op: "between", label: "is between", arity: 2 },
    { op: "empty", label: "is not set", arity: 0 },
  ],
  text: [
    { op: "contains", label: "contains" },
    { op: "is", label: "is" },
    { op: "isnot", label: "is not" },
    { op: "empty", label: "is empty", arity: 0 },
    { op: "notempty", label: "is not empty", arity: 0 },
  ],
  enum: [
    { op: "anyof", label: "is any of", arity: "many" },
    { op: "noneof", label: "is none of", arity: "many" },
    { op: "empty", label: "is not recorded", arity: 0 },
  ],
  tags: [
    { op: "includes", label: "includes any of", arity: "many" },
    { op: "includesall", label: "includes all of", arity: "many" },
    { op: "excludes", label: "includes none of", arity: "many" },
    { op: "empty", label: "is empty", arity: 0 },
    { op: "notempty", label: "is not empty", arity: 0 },
  ],
  symbol: [
    { op: "anyof", label: "is any of", arity: "many" },
    { op: "noneof", label: "is none of", arity: "many" },
    { op: "contains", label: "contains" },
  ],
};
OPS.money = OPS.number;
OPS.percent = OPS.number;
OPS.r = OPS.number;

export const opsFor = (type) => OPS[type] || OPS.text;
export const opDef = (type, op) => opsFor(type).find((o) => o.op === op) || opsFor(type)[0];

/** How many value boxes this rule draws. 0 = none, 2 = a range, "many" = a picker. */
export const arityOf = (type, op) => {
  const d = opDef(type, op);
  return d.arity === undefined ? 1 : d.arity;
};

/* ------------------------------------------------------------------ *
 *  Date windows
 * ------------------------------------------------------------------ */

const iso = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const dayIso = (v) => (v ? String(v).slice(0, 10) : "");

/**
 * The presets behind "is in".
 *
 * Financial years follow `fyStartYear` rather than a second April-to-March
 * rule written here, because the app periodizes on the Indian FY everywhere
 * else and two definitions of "this year" would eventually disagree by a day
 * at the boundary — on 31 March, of all days, when it matters most.
 *
 * Each returns [from, to] inclusive, as ISO dates.
 */
export function windowFor(preset, now = new Date()) {
  const y = now.getFullYear();
  const fy = fyStartYear(now);
  const back = (days) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return iso(d);
  };
  switch (preset) {
    case "last7": return [back(7), iso(now)];
    case "last30": return [back(30), iso(now)];
    case "last90": return [back(90), iso(now)];
    case "last365": return [back(365), iso(now)];
    case "thismonth": return [iso(new Date(y, now.getMonth(), 1)), iso(now)];
    case "lastmonth": {
      const s = new Date(y, now.getMonth() - 1, 1);
      return [iso(s), iso(new Date(y, now.getMonth(), 0))];
    }
    case "thisfy": return [`${fy}-04-01`, `${fy + 1}-03-31`];
    case "lastfy": return [`${fy - 1}-04-01`, `${fy}-03-31`];
    case "thiscal": return [`${y}-01-01`, `${y}-12-31`];
    case "lastcal": return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    default: return null;
  }
}

export const DATE_PRESETS = [
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "last90", label: "Last 90 days" },
  { key: "last365", label: "Last 365 days" },
  { key: "thismonth", label: "This month" },
  { key: "lastmonth", label: "Last month" },
  { key: "thisfy", label: "This financial year" },
  { key: "lastfy", label: "Last financial year" },
  { key: "thiscal", label: "This calendar year" },
  { key: "lastcal", label: "Last calendar year" },
];

const presetLabel = (k) => (DATE_PRESETS.find((p) => p.key === k) || {}).label || k;

/* ------------------------------------------------------------------ *
 *  Matching
 * ------------------------------------------------------------------ */

const asNum = (v) => {
  if (v === "" || v === null || v === undefined) return NaN;
  const n = Number(v);
  return isFinite(n) ? n : NaN;
};

const asList = (v) => (Array.isArray(v) ? v : v === "" || v == null ? [] : [v]);

const low = (v) => String(v ?? "").trim().toLowerCase();

/**
 * Does one rule hold for one trade?
 *
 * ABSENT IS NOT ZERO, AND IT IS NOT A MATCH EITHER. A trade with no R has
 * `r === NaN`, and NaN fails every comparison in JavaScript silently — which
 * is the behaviour we want, but only by accident, so it is made explicit: a
 * numeric rule on a field the trade does not have is false, never true. The
 * exception is the `empty` operator, which is the only way to ASK for absence
 * and therefore the only operator that treats it as a match.
 */
export function matchesRule(t, rule) {
  if (!t || !rule || !rule.field) return true;
  const f = fieldOf(rule.field);
  if (!f) return true;
  const raw = t[rule.field];
  const op = rule.op;

  if (op === "empty" || op === "notempty") {
    const absent = f.type === "tags"
      ? !(Array.isArray(raw) && raw.length)
      : isNumeric(f.type)
      ? !isFinite(asNum(raw))
      : raw === null || raw === undefined || String(raw).trim() === "";
    return op === "empty" ? absent : !absent;
  }

  if (isNumeric(f.type)) {
    const n = asNum(raw);
    if (!isFinite(n)) return false;
    const a = asNum(rule.value), b = asNum(rule.value2);
    if (op === "gt") return isFinite(a) && n > a;
    if (op === "lt") return isFinite(a) && n < a;
    if (op === "gte") return isFinite(a) && n >= a;
    if (op === "lte") return isFinite(a) && n <= a;
    if (op === "eq") return isFinite(a) && n === a;
    if (op === "between") {
      if (!isFinite(a) || !isFinite(b)) return false;
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return n >= lo && n <= hi;
    }
    return false;
  }

  if (f.type === "date") {
    const d = dayIso(raw);
    if (!d) return false;
    if (op === "within") {
      const w = windowFor(rule.value);
      return !!w && d >= w[0] && d <= w[1];
    }
    if (op === "after") return !!rule.value && d >= dayIso(rule.value);
    if (op === "before") return !!rule.value && d <= dayIso(rule.value);
    if (op === "between") {
      const a = dayIso(rule.value), b = dayIso(rule.value2);
      if (!a || !b) return false;
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return d >= lo && d <= hi;
    }
    return false;
  }

  if (f.type === "tags") {
    const have = new Set((Array.isArray(raw) ? raw : []).map(low));
    const want = asList(rule.value).map(low).filter(Boolean);
    if (!want.length) return true;
    if (op === "includes") return want.some((w) => have.has(w));
    if (op === "includesall") return want.every((w) => have.has(w));
    if (op === "excludes") return !want.some((w) => have.has(w));
    return false;
  }

  // enum, symbol, text
  const s = low(raw);
  if (op === "anyof" || op === "noneof") {
    const want = asList(rule.value).map(low).filter(Boolean);
    if (!want.length) return true;
    const hit = want.includes(s);
    return op === "anyof" ? hit : !hit;
  }
  if (op === "contains") return !!rule.value && s.includes(low(rule.value));
  if (op === "is") return s === low(rule.value);
  if (op === "isnot") return s !== low(rule.value);
  return false;
}

/**
 * A rule nobody has finished typing must not filter anything out.
 *
 * The builder shows a live count while you build, so a half-written rule is
 * the NORMAL state, not an error — you have picked a field and are reaching
 * for the value. Applying it at that moment would drop the count to zero on
 * every new row and make the preview useless exactly when it is being read.
 */
export function isComplete(rule) {
  if (!rule || !rule.field) return false;
  const f = fieldOf(rule.field);
  if (!f) return false;
  const n = arityOf(f.type, rule.op);
  if (n === 0) return true;
  if (n === "many") return asList(rule.value).length > 0;
  if (n === 2) return rule.value !== "" && rule.value != null
    && rule.value2 !== "" && rule.value2 != null;
  return rule.value !== "" && rule.value != null;
}

/** Does a trade satisfy the whole filter? Incomplete rules sit it out. */
export function matches(t, filter) {
  const rules = (filter?.rules || []).filter(isComplete);
  if (!rules.length) return true;
  return filter?.conjunction === "or"
    ? rules.some((r) => matchesRule(t, r))
    : rules.every((r) => matchesRule(t, r));
}

export const applyFilter = (trades, filter) =>
  !filter ? (trades || []) : (trades || []).filter((t) => matches(t, filter));

/* ------------------------------------------------------------------ *
 *  Reading a filter back
 * ------------------------------------------------------------------ */

const valueWords = (f, rule) => {
  const n = arityOf(f.type, rule.op);
  if (n === 0) return "";
  if (n === "many") {
    const list = asList(rule.value).map((v) => (f.display && f.display[v]) || v);
    if (list.length <= 2) return list.join(" or ");
    return `${list.slice(0, 2).join(", ")} +${list.length - 2}`;
  }
  if (f.type === "date" && rule.op === "within") return presetLabel(rule.value);
  if (n === 2) return `${rule.value} and ${rule.value2}`;
  const v = (f.display && f.display[rule.value]) || rule.value;
  return f.type === "percent" ? `${v}%` : String(v);
};

/** One rule as a sentence — used by the chip and by the suggested name. */
export function describeRule(rule) {
  const f = fieldOf(rule?.field);
  if (!f) return "";
  const words = valueWords(f, rule);
  return `${f.label} ${opDef(f.type, rule.op).label}${words ? ` ${words}` : ""}`.trim();
}

export function describeFilter(filter) {
  const rules = (filter?.rules || []).filter(isComplete);
  if (!rules.length) return "Every trade";
  return rules.map(describeRule).join(filter?.conjunction === "or" ? " or " : " and ");
}

/**
 * A name proposed from the rules, so saving is one click.
 *
 * Requiring a name BEFORE the rules — which is the order the field appears in
 * on most builders — asks you to name a thing you have not built yet. Here the
 * name is filled in from what you actually wrote and stays editable, so the
 * common path is: build it, glance at the name, save.
 */
export function suggestName(filter) {
  const rules = (filter?.rules || []).filter(isComplete);
  if (!rules.length) return "";
  const first = describeRule(rules[0]);
  const rest = rules.length - 1;
  return rest > 0 ? `${first} +${rest} more` : first;
}

/**
 * The order a view should open in.
 *
 * A view that asks for R above 5 is a question about the big ones, and
 * answering it in entry-date order buries the answer — you wrote the
 * condition to find the extremes, so the extremes go at the top.
 *
 * THE OPERATOR CARRIES THE DIRECTION, which is why this is derived rather
 * than configured. "is above" and "is at least" are reaching upward, so the
 * largest come first; "is below" and "is at most" are reaching down, so
 * "Net P&L is at most 0" opens with the worst loss rather than the smallest.
 * `between` and `equals` are asking about a middle and get no opinion. Dates
 * always come back newest-first, matching every other list in the app.
 *
 * Only the FIRST condition that yields an order is used — "the first thing
 * you asked for decides the order" is a rule somebody can hold in their head,
 * where a scoring scheme across several conditions is not. And this is only
 * ever a starting position: clicking a column still wins, until the view
 * changes.
 *
 * A stored sort_key wins over all of it. Nothing writes one yet; it is the
 * home for a per-view order somebody pins by hand, if that is ever wanted.
 */
export function sortForFilter(filter) {
  if (filter?.sort_key) {
    return { k: filter.sort_key, dir: filter.sort_dir === 1 ? 1 : -1 };
  }
  for (const rule of (filter?.rules || []).filter(isComplete)) {
    const f = fieldOf(rule.field);
    if (!f || !f.sortable) continue;
    if (f.type === "date") return { k: f.key, dir: -1 };
    if (!isNumeric(f.type)) continue;
    if (rule.op === "gt" || rule.op === "gte") return { k: f.key, dir: -1 };
    if (rule.op === "lt" || rule.op === "lte") return { k: f.key, dir: 1 };
  }
  return null;
}

/**
 * The tab you are on, as rules — so "Save what I am looking at" opens the
 * builder already filled in rather than asking you to rebuild it.
 *
 * Each mapping reproduces the tab's own test EXACTLY, including the boundary:
 * Trades.jsx counts a break-even trade as a loser (`pnl <= 0`), so this uses
 * "is at most" and not "is below". A seed that quietly disagreed with the tab
 * it came from would be worse than no seed, because the count in the builder
 * would be right while the rules were wrong, and you would trust it.
 */
export function seedFromTab(tab) {
  const r = (field, op, value) => ({ field, op, value, value2: "" });
  switch (tab) {
    /* Both values, because the tab means both — a part-sold position is open.
       Seeding only "open" would have produced a saved view that quietly
       disagreed with the tab it was copied from. */
    case "open": return [r("status", "anyof", ["open", "partial"])];
    case "closed": return [r("status", "anyof", ["closed"])];
    case "winners": return [r("pnl", "gt", 0)];
    case "losers": return [r("pnl", "lte", 0)];
    case "nostop": return [r("stop_source", "anyof", ["none"])];
    default: return [];
  }
}

export const emptyRule = () => ({ field: "", op: "", value: "", value2: "" });

export const emptyFilter = () => ({ name: "", conjunction: "and", rules: [emptyRule()] });

/** Picking a field resets the operator and value — an op from the old type would not apply. */
export function withField(rule, key) {
  const f = fieldOf(key);
  if (!f) return { ...rule, field: "", op: "", value: "", value2: "" };
  const op = opsFor(f.type)[0].op;
  return { field: key, op, value: arityOf(f.type, op) === "many" ? [] : "", value2: "" };
}

/** Changing the operator keeps the value only when the new shape can hold it. */
export function withOp(rule, op) {
  const f = fieldOf(rule.field);
  if (!f) return { ...rule, op };
  const was = arityOf(f.type, rule.op), now = arityOf(f.type, op);
  if (was === now) return { ...rule, op };
  return { ...rule, op, value: now === "many" ? [] : "", value2: "" };
}
