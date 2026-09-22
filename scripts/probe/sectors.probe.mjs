import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { sectorFileFor } from "@/lib/sectors";
import { DIMENSIONS, dimensionRows, edgeFilterFor, matchesEdgeFilter, NOT_RECORDED } from "@/lib/edge";
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
    /* Trades has a third trigger — a filter arriving from the sector
       breakdown, which needs the lookup with no column on screen. What must
       not appear anywhere is a bare `useSectors(true)`, which would put the
       request on every visit to the table. */
    ok(/useSectors\(\s*show\("sector"\)\s*\|\|\s*show\("industry"\)/.test(src),
       `${f} does not gate useSectors on its columns being shown`);
    ok(!/useSectors\(\s*true\s*\)/.test(src), `${f} asks for the file unconditionally`);
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

/* ---- the breakdown on Analysis ------------------------------------- */

/**
 * The sector grouping is a categorical dimension like any other, so it is
 * tested the way the others are: by running it.
 */
test("trades group by sector, and the grouping hides itself on an unclassified book", () => {
  const D = DIMENSIONS.find((d) => d.id === "sector");
  ok(D, "there is no sector dimension");

  const book = [
    { symbol: "RELIANCE", sector: "Oil Gas & Consumable Fuels", r: 2, pnl: 100 },
    { symbol: "HDFCBANK", sector: "Financial Services", r: -1, pnl: -50 },
    { symbol: "AUBANK", sector: "Financial Services", r: 3, pnl: 150 },
    { symbol: "NEWLISTING", r: 1, pnl: 10 },
  ];
  const rows = dimensionRows(book, "sector", { accountSize: 100000 });
  const by = new Map(rows.map((r) => [r.key, r]));
  eq(by.get("Financial Services")?.n, 2, "the two banks are one group");
  eq(by.get("Oil Gas & Consumable Fuels")?.n, 1, "and the refiner is its own");
  ok(by.has(NOT_RECORDED), "a stock with no classification is not silently dropped");
  eq(rows.reduce((a, r) => a + r.n, 0), book.length, "every trade lands in exactly one group");

  ok(D.showIf(book), "offered where something is classified");
  ok(!D.showIf(book.map(({ sector, ...t }) => t)),
     "still offered on a book where nothing is classified");
});

/**
 * THE ROUND TRIP. Clicking a sector row goes to /trades with that group as a
 * filter, and the membership test is the dimension's own `get` — which reads
 * `t.sector`, a field no trade carries until something looks it up. Filling it
 * on the way in is the whole of what makes the link land on trades rather than
 * on an empty table under a banner naming a group with trades in it.
 */
test("a sector filter arriving from Analysis is tested against a filled-in trade", () => {
  const t = { symbol: "AUBANK", status: "closed" };
  const q = edgeFilterFor("sector", { key: "Financial Services" });
  ok(!matchesEdgeFilter(t, q), "a bare trade cannot match — that is the trap");
  ok(matchesEdgeFilter({ ...t, sector: "Financial Services" }, q), "a filled one does");

  const src = read("src/components/journal/Trades.jsx");
  ok(/matchesEdgeFilter\(\{ \.\.\.t, \.\.\.sectorOf\(t\.symbol\) \}, edge\)/.test(src),
     "the trades screen tests the raw trade, so a sector filter would show nothing");
  ok(/edge\?\.dim === "sector"/.test(src),
     "the lookup is not switched on for a filter that needs it");

  const edge = read("src/components/journal/Edge.jsx");
  ok(/\.\.\.sectorOf\(t\.symbol\)/.test(edge), "Edge never lays the classification on");
});
