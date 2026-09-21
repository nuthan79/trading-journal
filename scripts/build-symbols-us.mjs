/**
 * Builds public/symbols.us.json — the US half of the autocomplete.
 *
 *   node scripts/build-symbols-us.mjs
 *
 * SAME IDEA AS THE INDIAN ONE, AND A SEPARATE FILE ON PURPOSE. A region is a
 * separate book, and an Indian trader should not download six thousand US
 * tickers to type three characters of RELIANCE — nor the reverse. The
 * autocomplete fetches whichever file the open book needs, once.
 *
 * SOURCE: Nasdaq Trader's own symbol directory, the files the exchanges
 * publish nightly and everything downstream is built from. No key, no
 * scraping, pipe-delimited:
 *
 *   nasdaqlisted.txt   everything listed on Nasdaq
 *   otherlisted.txt    NYSE, NYSE American, Arca, BATS, IEX
 *
 * WHAT IS THROWN AWAY, AND WHY EACH ONE WOULD OTHERWISE HURT:
 *
 *   Test issues — exchange-created dummies (Nasdaq's ZXZZT and friends). A
 *   trader typing ZX would be offered a security that does not exist.
 *
 *   The trailing "File Creation Time" line, which parses as a symbol called
 *   "File Creation Time: 0921202609:16" if nothing drops it.
 *
 *   Warrants, units, rights and preferred shares — anything whose symbol
 *   carries $ or ^, and anything the security name calls a Warrant, Unit or
 *   Right. They are not what a swing trader means by a stock, and they crowd
 *   the four-character prefixes that matter.
 *
 * ETFs ARE KEPT, and marked. SPY and QQQ are traded exactly like stocks and
 * leaving them out would look like a missing symbol; the flag is there so a
 * later screen can say what it is.
 *
 * The exchange codes in otherlisted.txt are single letters — N is the NYSE,
 * A is NYSE American (the old AMEX), P is Arca, Z is Cboe BZX, V is IEX. The
 * first two are where equities a swing trader holds actually list; the rest
 * are almost entirely ETFs, which is fine, they keep their own venue name.
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "public", "symbols.us.json");
const NASDAQ_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt";
const OTHER_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt";

/* Where a row actually trades. Arca, BZX and IEX list ETFs rather than
   operating companies, and calling them all "NYSE" would be wrong in a column
   the user can see. */
const VENUE = { N: "NYSE", A: "AMEX", P: "ARCA", Z: "BATS", V: "IEXG" };

const NOT_A_STOCK = /\b(Warrant|Warrants|Unit|Units|Right|Rights|Depositary|Preferred|Notes?|Debenture)\b/i;

async function grab(url, what) {
  try {
    const res = await fetch(url, { headers: { "user-agent": "ledgerr-symbols/1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    /* The header is the first line and the creation stamp is the last. */
    return lines.slice(1).filter((l) => !/^File Creation Time/i.test(l));
  } catch (e) {
    console.warn(`  ! ${what} failed: ${e.message}`);
    return [];
  }
}

const clean = (name) => String(name || "")
  /* Every row says what KIND of security it is, and for ordinary shares that
     is noise in an autocomplete: "Apple Inc. Common Stock" is Apple. */
  .replace(/\s*-?\s*(Common Stock|Common Shares|Class [A-Z] Common Stock|Ordinary Shares|American Depositary Shares).*$/i, "")
  .replace(/\s+/g, " ")
  .trim();

const usable = (symbol, name, test) =>
  test !== "Y" && symbol && !/[$^]/.test(symbol) && !NOT_A_STOCK.test(name);

console.log("Building the US symbol list…");

const rows = [];
const seen = new Set();
const add = (s, n, e, etf) => {
  const key = `${s}|${e}`;
  if (seen.has(key)) return;
  seen.add(key);
  const row = { s, n: clean(n) || s, e };
  if (etf) row.f = 1;      // an ETF, not an operating company
  rows.push(row);
};

for (const line of await grab(NASDAQ_URL, "nasdaqlisted")) {
  const [symbol, name, , test, , , etf] = line.split("|");
  if (!usable(symbol, name, test)) continue;
  add(symbol.trim(), name, "NASDAQ", etf === "Y");
}

for (const line of await grab(OTHER_URL, "otherlisted")) {
  const [actSymbol, name, exchange, , etf, , test] = line.split("|");
  if (!usable(actSymbol, name, test)) continue;
  const venue = VENUE[String(exchange).trim()];
  if (!venue) continue;
  add(actSymbol.trim(), name, venue, etf === "Y");
}

rows.sort((a, b) => (a.s === b.s ? a.e.localeCompare(b.e) : a.s.localeCompare(b.s)));

if (!rows.length) {
  console.error("\nNothing to write — both downloads failed.");
  process.exit(1);
}

/* A SHRINKING FILE IS A FAILED BUILD, the same rule the Indian builder learned
   the hard way: one rate-limited source once replaced 7,524 symbols with 2,553
   and reported success. */
const FORCE = process.argv.includes("--force");
let previous = [];
if (existsSync(OUT)) {
  try { previous = JSON.parse(await readFile(OUT, "utf8")); } catch { /* corrupt is not a reason to refuse */ }
}
if (!FORCE && previous.length && rows.length < previous.length * 0.9) {
  console.error(
    `\nRefusing to write: ${rows.length} symbols would replace ${previous.length}.` +
    `\nA source probably failed above. Re-run, or pass --force if the list really did shrink.`
  );
  process.exit(1);
}

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(rows));

const kb = (Buffer.byteLength(JSON.stringify(rows)) / 1024).toFixed(0);
console.log(`\nWrote ${rows.length} symbols to public/symbols.us.json (${kb} KB)`);
for (const e of ["NASDAQ", "NYSE", "AMEX", "ARCA", "BATS", "IEXG"]) {
  const n = rows.filter((x) => x.e === e).length;
  if (n) console.log(`  ${e} ${n}`);
}
