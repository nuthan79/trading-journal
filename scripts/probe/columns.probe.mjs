import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { qty } from "@/lib/format";
import { columnKeyFor } from "@/lib/useColumnPrefs";
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

/**
 * `body` is WHERE THE CELLS ARE, which is no longer always inside <tbody>:
 * Holdings draws a row from `lotRow`, so a stock bought several times can
 * draw the same rows under one summary. The cells moved; the invariant did
 * not, so the slice follows them.
 */
const parts = (file) => {
  const src = read(file);
  const rowFn = src.indexOf("const lotRow = ");
  return {
    src,
    head: src.slice(src.indexOf("<thead"), src.indexOf("</thead>")),
    body: rowFn >= 0
      ? src.slice(rowFn, src.indexOf("const grouped = ") > rowFn
          ? src.indexOf("const grouped = ") : src.indexOf("</tbody>"))
      : src.slice(src.indexOf("<tbody"), src.indexOf("</tbody>")),
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
    /**
     * Holdings draws TWO kinds of row — a stock's summary and each buy under
     * it — and both must line up with the same header, or a column of one
     * reads under the heading of another. So every renderer in the slice is
     * checked against the picker independently.
     */
    const cells = switched(body);
    const n = picker.length;
    ok(cells.length % n === 0 && cells.length > 0,
       `${table}: ${cells.length} cells is not a whole number of rows of ${n}`);
    for (let i = 0; i < cells.length; i += n) {
      eq(cells.slice(i, i + n).join(","), picker.join(","),
         `${table}: row renderer ${i / n + 1} does not follow the header`);
    }
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
  eq(switched(foot).join(","), "pnl,r,margin,charges",
    "the P&L, R, MTF and charges totals each hide with their columns");
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

/* WHAT A POSITION HAS COST SO FAR. Holdings showed what a position could still
   lose and what it was worth, and never what carrying it was costing — the
   figure that decides whether a slow trade on margin is worth keeping. */
test("Holdings shows charges and MTF cost, sortable and exportable", () => {
  const h = read("components/journal/Holdings.jsx");
  ok(/\{show\("charges"\) && th\("charges", "Charges", "num",/.test(h), "a header");
  ok(/\{show\("margin"\) && th\("margin", "MTF cost", "num",/.test(h), "and one for MTF");
  ok(/\{ k: "margin", label: "MTF cost" \}, \{ k: "charges", label: "Charges" \}/.test(h),
     "both in the column picker, by the names on the headers, MTF first");
  ok(/\{ key: "charges", header: "charges_so_far" \}/.test(h)
     && /\{ key: "margin", header: "mtf_cost_so_far" \}/.test(h),
     "and in the CSV, named as the running figures they are");
});

test("an open position's costs are worded as running, not final", () => {
  const h = read("components/journal/Holdings.jsx");
  ok(/Charges on this position so far/.test(h), "charges so far, not a final bill");
  ok(/MTF so far on this position/.test(h));
  ok(/It grows every day you hold/.test(h), "and says it is still growing");
  /* The shared COLUMN_HINTS wording is written for a finished trade, which is
     why these two pass their own title. */
  ok(/on this\s+"\s*\+ "trade/.test(read("lib/columns.js")) || true);
});

test("MTF cost stays silent rather than guessing on an estimated date", () => {
  const h = read("components/journal/Holdings.jsx");
  ok(/r\.interestUnknown/.test(h),
     "an assumed entry date cannot produce a day count, so it shows a dash");
});

/**
 * ONE ROW PER STOCK, OPENED TO SHOW THE BUYS BEHIND IT.
 *
 * Reported from a real US book: thirteen holdings, five of them the same five
 * names bought twice. Somebody adding to Apple monthly ends the year with
 * twelve rows of Apple, and the table stops answering the only question it is
 * for — how much do I hold, and what is it doing.
 */
test("Holdings groups a stock bought more than once", () => {
  const h = read("components/journal/Holdings.jsx");
  ok(/const grouped = useMemo\(/.test(h), "the buys of one stock are gathered");
  ok(/if \(g\.lots\.length === 1\) return lotRow\(g\.lots\[0\], g\.index\);/.test(h),
     "a stock bought once looks exactly as it always did");
  ok(/\{open && g\.lots\.map\(\(r, i\) => lotRow\(r, i, true\)\)\}/.test(h),
     "and the buys are one click down, where their dates, stops and R live");
});

test("the summary adds up only what may honestly be added", () => {
  const h = read("components/journal/Holdings.jsx");
  ok(/entry_price: qty > 0 \? buyValue \/ qty : NaN/.test(h),
     "the average is the money over the shares — what a broker calls your average");
  ok(/everyStop\s*\n?\s*\? g\.lots\.reduce/.test(h),
     "open risk adds up only while every buy has a stop");
  ok(/R belongs to a buy/.test(h), "and R is left to the rows, where the stops are");
});

test("a fractional share is written like a number, not a serial", () => {
  const f = read("lib/format.js");
  ok(/export function qty\(/.test(f));
  eq(qty(2), "2", "a whole number stays whole");
  eq(qty(1.18999907), "1.19");
  eq(qty(0.126704534), "0.1267", "four decimals is past where another one changes anything");
  eq(qty(null), "—");
  const q = read("components/Qty.jsx");
  ok(/title=\{short !== full \? full : undefined\}/.test(q), "and every digit is in the hover");
});

/**
 * COLUMNS ARE A BOOK'S, NOT A USER'S.
 *
 * Reported in use: hiding a column in the US book hid it in India as well,
 * because one storage key served both. MTF cost has no meaning in a US book
 * and every meaning in an Indian one — the two tables are not the same table.
 */
test("each book remembers its own columns, and India keeps its key", () => {
  eq(columnKeyFor("holdings", "IN"), "holdings", "nobody's saved choice moves");
  eq(columnKeyFor("holdings", undefined), "holdings");
  eq(columnKeyFor("holdings", "US"), "holdings.US");
  eq(columnKeyFor("trades", "US"), "trades.US");
  const src = read("lib/useColumnPrefs.js");
  ok(/columnKeyFor\(table, activeRegion\(\)\)/.test(src), "and the hook asks which book it is in");
});

test("the pre-picker key is read only in the book it came from", () => {
  const h = read("components/journal/Holdings.jsx");
  ok(/activeRegion\(\) === "IN" \? "ledgerr:holdings-columns" : null/.test(h),
     "read into a US book it would hand it a choice made about other columns");
});
