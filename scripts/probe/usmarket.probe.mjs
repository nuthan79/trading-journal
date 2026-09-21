import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { yahooTicker, INDICES, indicesFor } from "@/lib/quotes";
import { region } from "@/lib/regions";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

/**
 * PHASE 3 — a US stock can be found and priced.
 *
 * Both halves are one-way doors: a ticker spelled wrong returns 404 and the
 * holding simply never prices, with nothing on screen to say why.
 */
test("India's tickers are spelled exactly as they were", () => {
  eq(yahooTicker("RELIANCE", "NSE"), "RELIANCE.NS");
  eq(yahooTicker("MMLF", "BSE"), "MMLF.BO");
  /* A row with no exchange at all — a hand-entered trade, or anything written
     before the exchange column — is India, which is what it has always been. */
  eq(yahooTicker("RELIANCE", ""), "RELIANCE.NS");
  eq(yahooTicker("RELIANCE", "SOMETHING"), "RELIANCE.NS");
});

test("a US ticker is bare, and a share class takes a dash", () => {
  eq(yahooTicker("AAPL", "NASDAQ"), "AAPL");
  eq(yahooTicker("aapl", "nasdaq"), "AAPL", "case is not a different stock");
  eq(yahooTicker("SPY", "ARCA"), "SPY");
  /* MEASURED against Yahoo: BRK-B answers with a price, BRK.B returns 404.
     The exchanges publish the dot, so this conversion is the difference
     between a holding that prices and one that silently never does. */
  eq(yahooTicker("BRK.B", "NYSE"), "BRK-B");
  eq(yahooTicker("BRK.A", "NYSE"), "BRK-A");
});

test("each book has its own benchmarks, and nothing is blended", () => {
  eq(indicesFor("IN").map((i) => i.id).join(","), "nifty500,nifty50,midcap150,smallcap250");
  eq(indicesFor("US").map((i) => i.id).join(","), "sp500,nasdaq100,russell2000");
  eq(indicesFor().length, 4, "no region named means India, as everywhere else");
  for (const i of INDICES) ok(i.region === "IN" || i.region === "US", `${i.id} says which book`);
  /* Checked live while this was written: each returns a level AND history. */
  eq(INDICES.find((i) => i.id === "sp500").ticker, "^GSPC");
});

test("the US symbol list is built, sane, and holds the names people type", () => {
  const file = path.join(ROOT, "public/symbols.us.json");
  ok(existsSync(file), "run `npm run symbols:us` to build it");
  const list = JSON.parse(readFileSync(file, "utf8"));
  ok(list.length > 5000, `${list.length} symbols is too few — a source probably failed`);

  const find = (s) => list.find((r) => r.s === s);
  for (const s of ["AAPL", "MSFT", "NVDA", "TSLA", "SPY", "QQQ", "BRK.B"]) {
    ok(find(s), `${s} is missing from the list`);
  }
  eq(find("AAPL").n, "Apple Inc.", "the security type is trimmed off the name");
  eq(find("AAPL").e, "NASDAQ");
  eq(find("SPY").f, 1, "an ETF is marked as one");
  /* Exchange-created dummies would be offered to somebody typing ZX. */
  ok(!list.some((r) => /^ZXZZT|^ZVZZT|^ZWZZT/.test(r.s)), "no test issues");
  ok(!list.some((r) => /[$^]/.test(r.s)), "no warrants or units");
  ok(!list.some((r) => /File Creation Time/i.test(r.s)), "the trailing stamp line is dropped");
  for (const r of list.slice(0, 200)) {
    ok(r.s && r.n && r.e, "every row has a symbol, a name and a venue");
    ok(region("US").exchanges.includes(r.e) || ["ARCA", "BATS", "IEXG"].includes(r.e),
       `${r.e} is a venue the app knows`);
  }
});

test("only the open book's symbols are downloaded", () => {
  const src = read("src/components/SymbolSearch.jsx");
  ok(/FILES = \{ IN: "\/symbols\.json", US: "\/symbols\.us\.json" \}/.test(src));
  ok(/loadSymbols\(regionId\)/.test(src), "the fetch follows the region");
  ok(!/fetch\("\/symbols\.json"\)/.test(src), "never both files, and never the wrong one");
});

test("the builder refuses to replace a good list with a broken one", () => {
  const src = read("scripts/build-symbols-us.mjs");
  ok(/rows\.length < previous\.length \* 0\.9/.test(src),
     "the same rule the Indian builder learned the hard way");
  ok(/--force/.test(src), "with a way out for a list that really did shrink");
});
