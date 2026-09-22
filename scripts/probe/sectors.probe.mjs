import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { sectorFileFor } from "@/lib/sectors";
import { REGIONS } from "@/lib/regions";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const pub = (f) => JSON.parse(read(path.join("public", f)));

/**
 * The sector columns, end to end: the built files, the lookup, and the two
 * tables that render it.
 *
 * The file is data rather than code, so most of what can go wrong here is a
 * builder that half-answered — a source that returns 200 and an empty table
 * writes a column of dashes and nothing errors. These read the real files.
 */

test("every region has a sector file of its own, and an unknown one falls back to India", () => {
  const seen = new Set();
  for (const r of REGIONS) {
    const f = sectorFileFor(r.id);
    ok(f, `${r.id} has no sector file`);
    ok(!seen.has(f), `${r.id} shares its sector file with another book`);
    seen.add(f);
  }
  eq(sectorFileFor("ZZ"), sectorFileFor("IN"), "an unknown book falls back to India");
});

test("each built file resolves every stock to real names", () => {
  for (const r of REGIONS) {
    const file = sectorFileFor(r.id).replace(/^\//, "");
    if (!existsSync(path.join(ROOT, "public", file))) continue;   // not built on this machine
    const raw = pub(file);
    eq(raw.region, r.id, `${file} says which book it is`);
    const rows = Object.entries(raw.map);
    ok(rows.length > 1000, `${file} classifies only ${rows.length} stocks`);
    for (const [sym, pair] of rows) {
      ok(sym === sym.toUpperCase(), `${file}: ${sym} is not upper-cased, so no lookup finds it`);
      ok(Array.isArray(pair) && pair.length === 2, `${file}: ${sym} is not a pair`);
      const [si, ii] = pair;
      ok(si === -1 || raw.sectors[si], `${file}: ${sym} points at sector ${si}, which is not there`);
      ok(ii === -1 || raw.industries[ii], `${file}: ${sym} points at industry ${ii}, which is not there`);
      ok(si !== -1 || ii !== -1, `${file}: ${sym} is in the map with nothing to say`);
    }
  }
});

/**
 * THE TWO TAXONOMIES ARE NOT ONE.
 *
 * India's sectors are NSE's ("Oil Gas & Consumable Fuels") and the US's are
 * Nasdaq's ("Energy") — the same company lands in differently-named buckets,
 * and a builder that ever fed one market's names into the other book's file
 * would produce a column that looks right and groups wrongly. They overlap on
 * a couple of words by coincidence; wholesale agreement would mean a mix-up.
 */
test("a book's sector names are its own market's", () => {
  const inFile = sectorFileFor("IN").replace(/^\//, "");
  const usFile = sectorFileFor("US").replace(/^\//, "");
  if (!existsSync(path.join(ROOT, "public", inFile))) return;
  if (!existsSync(path.join(ROOT, "public", usFile))) return;
  const a = new Set(pub(inFile).sectors);
  const b = new Set(pub(usFile).sectors);
  const shared = [...a].filter((s) => b.has(s));
  ok(shared.length < Math.min(a.size, b.size) / 2,
     `India and the US share ${shared.length} sector names of ${a.size} and ${b.size} — `
     + `one file was probably built from the other market's source`);
});

test("the stocks a probe can name are classified", () => {
  const inFile = sectorFileFor("IN").replace(/^\//, "");
  if (existsSync(path.join(ROOT, "public", inFile))) {
    const raw = pub(inFile);
    const of = (s) => raw.sectors[raw.map[s]?.[0]] || "";
    ok(/Oil Gas|Oil, Gas/.test(of("RELIANCE")), `RELIANCE reads "${of("RELIANCE")}"`);
    ok(/Financial Services/.test(of("HDFCBANK")), `HDFCBANK reads "${of("HDFCBANK")}"`);
  }
  const usFile = sectorFileFor("US").replace(/^\//, "");
  if (existsSync(path.join(ROOT, "public", usFile))) {
    const raw = pub(usFile);
    const of = (s) => raw.sectors[raw.map[s]?.[0]] || "";
    eq(of("AAPL"), "Technology", "AAPL");
    eq(of("JPM"), "Finance", "JPM");
  }
});

/**
 * NOTHING IS FETCHED FOR A COLUMN NOBODY IS LOOKING AT. The whole bargain of
 * shipping a classification file is that somebody who never turns the column
 * on never waits for it — `useSectors(true)` on either table would quietly
 * add a request to every visit.
 */
test("both tables ask for the file only while a sector column is showing", () => {
  for (const f of ["components/journal/Holdings.jsx", "components/journal/Trades.jsx"]) {
    const src = read(path.join("src", f));
    ok(/useSectors\(\s*show\("sector"\)\s*\|\|\s*show\("industry"\)\s*\)/.test(src),
       `${f} does not gate useSectors on its columns being shown`);
  }
});

/**
 * The lesson useColumnPrefs was fixed for, in the one other place it applies:
 * these tables stay mounted when the book changes, so a `useState` initializer
 * alone would keep showing the previous book's classifications.
 */
test("the lookup re-reads when the book changes under a mounted table", () => {
  const src = read("src/lib/sectors.js");
  ok(/state\.region\s*!==\s*region/.test(src),
     "useSectors does not compare the book it holds against the current one");
});

test("the trades export carries the classification", () => {
  const src = read("src/components/journal/Trades.jsx");
  const cols = src.slice(src.indexOf("const TRADE_COLS"), src.indexOf("];", src.indexOf("const TRADE_COLS")));
  ok(cols.includes('"sector"') && cols.includes('"industry"'), "TRADE_COLS is missing them");
  ok(/downloadCsv\(rows\.map\(\(t\) => \(\{ \.\.\.t, \.\.\.sectorOf\(t\.symbol\) \}\)\)/.test(src),
     "the export writes the columns but never fills them");
});

test("both columns explain themselves in a header hover", () => {
  const hints = read("src/lib/columns.js");
  for (const k of ["sector", "industry"]) {
    ok(new RegExp(`^\\s*${k}:`, "m").test(hints), `COLUMN_HINTS has no ${k}`);
  }
});
