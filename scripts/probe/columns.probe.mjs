import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { loadHidden, serializeHidden } from "@/lib/columnPrefs";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * THE COLUMN PICKER, ON TRADES AND ON HOLDINGS.
 *
 * Every failure here is silent. Hide a header without its cell and each column
 * to its right slides under the wrong heading — Unrealised under "Change %" —
 * and nothing errors. Leave the totals row's spans fixed and it drifts out
 * from under the table the same way. So the tests are about AGREEMENT: the
 * picker's list, the headers, the cells and the spans must all describe the
 * same columns in the same order.
 */

const parts = (file) => {
  const src = read(file);
  return {
    src,
    head: src.slice(src.indexOf("<thead"), src.indexOf("</thead>")),
    body: src.slice(src.indexOf("<tbody"), src.indexOf("</tbody>")),
  };
};
const switched = (part) => [...part.matchAll(/show\("([^"]+)"\)/g)].map((m) => m[1]);
const listed = (src, name) => {
  const block = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))[1];
  return [...block.matchAll(/k: "([^"]+)"/g)].map((m) => m[1]);
};

for (const [file, table, list] of [
  ["components/journal/Trades.jsx", "Trades", "TRADE_COLUMNS"],
  ["components/journal/Holdings.jsx", "Holdings", "HOLDINGS_COLUMNS"],
]) {
  test(`${table}: the picker, the headers and the cells name the same columns in the same order`, () => {
    const { src, head, body } = parts(file);
    const picker = listed(src, list);
    eq(switched(head).join(","), picker.join(","), "headers switched = the picker's list");
    eq(switched(body).join(","), picker.join(","), "and every one of their cells, in order");
  });

  test(`${table}: the symbol cannot be hidden`, () => {
    const { src } = parts(file);
    ok(!listed(src, list).includes("symbol"), "a row with no name cannot be read");
  });

  test(`${table}: every column in the picker says what it is`, () => {
    /* The picker shows each column's hover text, so a missing hint is a blank
       in the one list that explains the table. */
    const hints = read("lib/columns.js");
    for (const k of listed(parts(file).src, list)) {
      if (k === "chart") continue;   // described on its own header
      ok(new RegExp(`\\b${k}:`).test(hints), `${table} column ${k} has no hint`);
    }
  });

  test(`${table}: the picker's labels are the headers' labels`, () => {
    /* The list is how somebody finds a column they can see, so it must use
       the name printed above it. */
    const { src, head } = parts(file);
    const block = src.match(new RegExp(`const ${list} = \\[([\\s\\S]*?)\\];`))[1];
    for (const [, k, label] of block.matchAll(/k: "([^"]+)", label: "([^"]+)"/g)) {
      const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const shown = new RegExp(`th\\("${k}", "${esc}"`).test(head)
        || (k === "chart" && />Chart<\/th>/.test(head));
      ok(shown, `${table}: picker calls ${k} "${label}", the header does not`);
    }
  });
}

test("Trades: the totals row splits exactly where the header does", () => {
  const { src, head } = parts("components/journal/Trades.jsx");
  /* The header's own order, read off the markup. */
  const order = [...head.matchAll(/th\("([^"]+)"|show\("(chart)"\)/g)].map((m) => m[1] || m[2]);
  const arr = (name) => [...src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))[1]
    .matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  eq(order.join(","), [...arr("BEFORE_PNL"), "pnl", "r", ...arr("COSTS"), ...arr("AFTER_COSTS")].join(","),
    "BEFORE_PNL, P&L and R, the two cost columns, then AFTER_COSTS — the header left to right");
  ok(/<th><\/th>\s*<\/tr><\/thead>/.test(src), "and the actions column closes it — the +1 in trailSpan");
});

test("Trades: the totals row spans follow the picker, not fixed numbers", () => {
  const { src } = parts("components/journal/Trades.jsx");
  const foot = src.slice(src.indexOf("<tfoot"), src.indexOf("</tfoot>"));
  ok(/colSpan=\{leadSpan\}/.test(foot) && /colSpan=\{trailSpan\}/.test(foot));
  ok(!/colSpan=\{\d+\}/.test(foot), "no hard-coded span is left");
  eq(switched(foot).join(","), "pnl,r,charges,margin",
    "the P&L, R, charges and MTF totals each hide with their columns");
});

/* ---- what is stored ------------------------------------------------ */

test("a table nobody has touched shows its default", () => {
  eq(serializeHidden(loadHidden(null)), "[]", "Trades: everything");
  eq(serializeHidden(loadHidden(null, { defaults: ["qtyOpen", "slPct"] })),
     '["qtyOpen","slPct"]', "Holdings: the essentials");
});

test("the choice is stored as what is hidden, so a new column appears", () => {
  /* Saved before MFE existed: it hid Stg. MFE, added later, must show. */
  const hidden = loadHidden('["weinstein_stage"]');
  ok(hidden.has("weinstein_stage"));
  ok(!hidden.has("mfe"), "a column the saved choice has never heard of is shown");
});

test("somebody who chose Everything yesterday keeps every column", () => {
  const hidden = loadHidden(null, { defaults: ["qtyOpen"], legacy: "all" });
  eq(hidden.size, 0);
  eq(loadHidden(null, { defaults: ["qtyOpen"], legacy: "essentials" }).size, 1,
    "while Essentials, the old default, stays the default");
});

test("an unreadable stored value falls back to the default, not to extremes", () => {
  eq(serializeHidden(loadHidden("{not json", { defaults: ["a"] })), '["a"]');
  eq(serializeHidden(loadHidden('{"a":1}', { defaults: ["a"] })), '["a"]', "not an array");
  eq(serializeHidden(loadHidden("[1,2]", { defaults: ["a"] })), '["a"]', "not strings");
});

test("storage is only ever touched inside a guard", () => {
  const hook = read("lib/useColumnPrefs.js");
  const calls = hook.match(/localStorage\.\w+\(/g) || [];
  ok(calls.length >= 2, "reads and writes storage");
  /* Each access sits between a `try {` and its `catch`. */
  const unguarded = hook.split(/try \{[\s\S]*?\} catch \{\}/).join("").match(/localStorage\./g);
  eq(unguarded, null, "every storage access is inside try/catch");
});

test("Trades: MTF cost is hidden by default only for someone with no margin trades", () => {
  const src = read("components/journal/Trades.jsx");
  ok(/defaults: all\.some\(\(t\) => Number\(t\.mtf_leverage\) > 1\) \? \[\] : \["margin"\],/.test(src));
});

test("Trades: the cost columns total the same rows the P&L does", () => {
  const src = read("components/journal/Trades.jsx");
  ok(/charges: rows\.reduce\(\(a, t\) => a \+ \(Number\(t\.charges\) \|\| 0\), 0\),/.test(src));
  ok(/margin: rows\.reduce\(\(a, t\) => a \+ \(Number\(t\.margin\) \|\| 0\), 0\),/.test(src));
});
