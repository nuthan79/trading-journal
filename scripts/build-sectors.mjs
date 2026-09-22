/**
 * Builds the sector/industry files the Sector and Industry columns read.
 *
 *   node scripts/build-sectors.mjs            # India  → public/sectors.json
 *   node scripts/build-sectors.mjs --region=US  #  US   → public/sectors.us.json
 *   node scripts/build-sectors.mjs --fill       # ask only about India's gaps
 *
 * Same shape as symbols.json and for the same reason: the whole universe is
 * small enough to ship once, so a column that names a stock's sector costs no
 * API call and no wait. It goes stale only when a company is reclassified,
 * which is rare — re-run it when you re-run `npm run symbols`.
 *
 * ONE FILE PER REGION, because sector is a fact about a market's own
 * classification and the two markets do not share one. India's is the NSE
 * scheme and the US's is Nasdaq's; "Oil Gas & Consumable Fuels → Petroleum
 * Products" and "Energy → Oil & Gas Production" describe the same company in
 * two taxonomies, and blending them would make the column mean neither.
 *
 * THE FILE IS KEYED BY SYMBOL, NOT BY ISIN. The lookup happens on a trade row,
 * which carries a symbol and an exchange and never an ISIN — going through
 * ISIN at runtime would mean loading the 650 KB symbol file on screens that
 * have no autocomplete on them. The ISIN hop happens HERE instead, where it
 * is free: BSE answers by scrip code, and symbols.json is what turns that back
 * into the ticker the journal stores.
 *
 * SOURCES
 *   India — the NSE classification, which is the four-level scheme SEBI has
 *           both exchanges on: Macro-Economic Sector / Sector / Industry /
 *           Basic Industry. RELIANCE is Energy / Oil Gas & Consumable Fuels /
 *           Petroleum Products / Refineries & Marketing, and the two columns
 *           here are the middle two, which is what a trader actually groups by.
 *
 *           NSE publishes it two ways and neither one alone is enough. Its
 *           index constituent CSVs are public and carry the SECTOR of the ~750
 *           names in NIFTY Total Market, and nothing below it. Its per-symbol
 *           API carries all four levels but is behind Akamai: server-side it
 *           answers 403 to a quote and 404 to the meta endpoint however the
 *           cookies are warmed, so no build can depend on it.
 *
 *           BSE's ComHeadernew endpoint answers the same classification for
 *           the whole universe without a fight — IndustryNew is the sector
 *           level and IGroup the industry. It is the delivery route, not a
 *           second opinion: checked on 300 names carried by both, NSE's
 *           published sector and BSE's IndustryNew agreed on all 265 that
 *           answered and disagreed on none. So where NSE publishes the string
 *           it wins, down to its own spelling ("Oil Gas & Consumable Fuels",
 *           no comma), and BSE fills in everything NSE does not list and the
 *           industry level throughout.
 *
 *           It is per scrip: ~5,000 requests, four at a time, about four
 *           minutes. The BSE list endpoint has an INDUSTRY column of its own
 *           and it is null on every row, which is why this crawls instead.
 *   US    — Nasdaq's screener download, one request for the whole market, with
 *           sector and industry on each row.
 *
 * A stock with no classification is left out of the map rather than written as
 * an empty string: the column shows a dash, which is honest, and the file
 * stays small.
 */

import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const REGION = (argv.find((a) => a.startsWith("--region="))?.slice(9) || "IN").toUpperCase();
const FORCE = argv.includes("--force");
/* Keep what the last run classified and ask only about the gaps. BSE
   rate-limits under a sustained crawl and leaves a few hundred scrips
   unanswered however patient the retries are; a second pass picks up most
   of them in a minute instead of repeating the whole four. */
const FILL = argv.includes("--fill");

const PUB = path.join(process.cwd(), "public");
const FILES = {
  IN: { symbols: "symbols.json", sectors: "sectors.json" },
  US: { symbols: "symbols.us.json", sectors: "sectors.us.json" },
};

const BROWSER = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };

async function fetchRetry(url, opts, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      last = err;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw last;
}

/** Run `work` over `items` with a fixed number of workers, in order. */
async function pool(items, width, work) {
  const queue = items.slice();
  let done = 0;
  const tick = () => {
    done++;
    if (done % 250 === 0 || done === items.length) {
      process.stdout.write(`\r     ${done}/${items.length}`);
    }
  };
  await Promise.all(Array.from({ length: width }, async () => {
    while (queue.length) { await work(queue.shift()); tick(); }
  }));
  process.stdout.write("\n");
}

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * ONE SECTOR, ONE SPELLING.
 *
 * The two exchanges punctuate the same name differently — NSE publishes "Oil
 * Gas & Consumable Fuels" and BSE "Oil, Gas & Consumable Fuels" — and a file
 * carrying both has twenty-four sectors where the scheme has twenty-two. The
 * cost is not cosmetic: sorted by sector, one group breaks into two that sit
 * apart in the table, and the whole point of the column is that a theme reads
 * as one block.
 *
 * Matched on the letters alone, and the NSE spelling wins, because NSE is what
 * the scheme is published as and what a user will have read elsewhere.
 */
const spellingKey = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");

function speller(preferred) {
  const by = new Map();
  for (const name of preferred) by.set(spellingKey(name), name);
  return (name) => {
    const key = spellingKey(name);
    if (!key) return "";
    if (!by.has(key)) by.set(key, clean(name));    // first spelling seen wins from here on
    return by.get(key);
  };
}

/* --------------------------------- India -------------------------------- */

const BSE_LIST =
  "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w" +
  "?Group=&Scripcode=&industry=&segment=Equity&status=Active";
const BSE_HEAD = (code) =>
  `https://api.bseindia.com/BseIndiaAPI/api/ComHeadernew/w?quotetype=EQ&scripcode=${code}&seriesid=`;
const BSE_HEADERS = { ...BROWSER, Referer: "https://www.bseindia.com/" };

/* NSE's own lists. The column they head "Industry" is the SECTOR level of the
   four-level scheme — "Financial Services", not "Banks" — and these are the
   authority for it wherever a name appears, spelling included. Total Market is
   the widest NSE publishes at ~750; Microcap 250 is read too because it is not
   wholly inside it. */
const NSE_LISTS = [
  "https://nsearchives.nseindia.com/content/indices/ind_niftytotalmarket_list.csv",
  "https://nsearchives.nseindia.com/content/indices/ind_niftymicrocap250_list.csv",
];

async function nseSectors() {
  const byIsin = new Map();               // ISIN → sector, NSE's own string
  for (const url of NSE_LISTS) {
    try {
      const text = await fetchRetry(url, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "text/csv,*/*",
                   Referer: "https://www.nseindia.com/" },
      }).then((r) => r.text());
      for (const line of text.split("\n").slice(1)) {
        if (!line.trim()) continue;
        const cells = line.split(",").map((c) => c.trim());
        const sector = clean(cells[1]);
        const isin = clean(cells[4]);
        if (isin && sector && !byIsin.has(isin)) byIsin.set(isin, sector);
      }
    } catch (err) {
      console.warn(`NSE  → ${url.split("/").pop()} failed (${err.message})`);
    }
  }
  console.log(`NSE  → ${byIsin.size} sectors published`);
  return byIsin;
}

async function indiaByIsin(skip = new Set()) {
  const byIsin = new Map();               // ISIN → { sector, industry }
  const nse = await nseSectors();

  const list = await fetchRetry(BSE_LIST, { headers: BSE_HEADERS }).then((r) => r.json());
  const scrips = list
    .filter((r) => r.Segment === "Equity" && r.Status === "Active")
    .map((r) => ({ code: String(r.SCRIP_CD || "").trim(), isin: String(r.ISIN_NUMBER || "").trim() }))
    .filter((r) => r.code && r.isin);
  const todo = scrips.filter((r) => !skip.has(r.isin));
  console.log(`BSE  → ${todo.length} scrips to classify`
    + (skip.size ? ` (${scrips.length - todo.length} already known)` : " (about four minutes)"));

  let failed = 0;
  await pool(todo, 4, async ({ code, isin }) => {
    try {
      const h = await fetchRetry(BSE_HEAD(code), { headers: BSE_HEADERS }, 3).then((r) => r.json());
      /* IndustryNew is the SECTOR level of the scheme and IGroup the INDUSTRY
         level — "Oil, Gas & Consumable Fuels" then "Petroleum Products". The
         field BSE calls Sector is the macro sector above both ("Energy"),
         which is too coarse to group a book by, and ISubGroup below them
         ("Refineries & Marketing") is too fine to read across a table. */
      const sector = nse.get(isin) || clean(h?.IndustryNew);
      const industry = clean(h?.IGroup);
      if (sector || industry) byIsin.set(isin, { sector, industry });
    } catch { failed++; }
  });
  console.log(`BSE  → ${byIsin.size} classified${failed ? `, ${failed} unanswered` : ""}`);

  /* Listings BSE has never seen — NSE-only, so sector and no industry. */
  let added = 0;
  for (const [isin, sector] of nse) {
    if (byIsin.has(isin)) continue;
    byIsin.set(isin, { sector, industry: "" });
    added++;
  }
  if (added) console.log(`NSE  → ${added} listings BSE does not carry`);
  return { byIsin, published: [...new Set(nse.values())] };
}

/* ----------------------------------- US ---------------------------------- */

const NASDAQ = "https://api.nasdaq.com/api/screener/stocks?download=true";

async function usBySymbol() {
  const j = await fetchRetry(NASDAQ, { headers: BROWSER }).then((r) => r.json());
  const rows = j?.data?.rows;
  if (!Array.isArray(rows)) throw new Error("unexpected response shape");
  const bySym = new Map();
  for (const r of rows) {
    const sector = clean(r.sector);
    const industry = clean(r.industry);
    const sym = clean(r.symbol).toUpperCase();
    if (sym && (sector || industry)) bySym.set(sym, { sector, industry });
  }
  console.log(`NASDAQ → ${bySym.size} of ${rows.length} rows classified`);
  return bySym;
}

/* --------------------------------- write --------------------------------- */

/**
 * Names go in two lists and each stock points at an index.
 *
 * Twenty-two sectors and a hundred-odd industries spelled out on five thousand
 * rows is most of a megabyte of the same few strings; as indices the file is a
 * fifth of that. The map is what a browser holds anyway once it parses either
 * shape, so the saving is pure.
 */
function pack(bySymbol, preferredSectors = []) {
  const spell = speller(preferredSectors);
  const sectors = [], industries = [];
  const sIdx = new Map(), iIdx = new Map();
  const idx = (name, list, seen) => {
    if (!name) return -1;
    if (!seen.has(name)) { seen.set(name, list.length); list.push(name); }
    return seen.get(name);
  };
  const map = {};
  for (const [sym, v] of [...bySymbol].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    map[sym] = [idx(spell(v.sector), sectors, sIdx), idx(v.industry, industries, iIdx)];
  }
  return { sectors, industries, map };
}

async function main() {
  const names = FILES[REGION];
  if (!names) throw new Error(`unknown region ${REGION} — IN or US`);
  const out = path.join(PUB, names.sectors);
  const symbolsFile = path.join(PUB, names.symbols);
  if (!existsSync(symbolsFile)) {
    throw new Error(`${names.symbols} is not built — run npm run symbols${REGION === "US" ? ":us" : ""} first`);
  }
  const symbols = JSON.parse(await readFile(symbolsFile, "utf8"));

  /* What the last run already knows. Its keys are tickers, so the crawl is
     skipped for a scrip whose ticker is already classified — which is what
     makes --fill a minute rather than four. */
  const known = new Map();
  /* India only. The US is one request for the whole market, so there is
     nothing to spare and keeping the old answers would only make a
     reclassification invisible. */
  if (FILL && REGION === "IN" && existsSync(out)) {
    const raw = JSON.parse(await readFile(out, "utf8"));
    for (const [sym, [si, ii]] of Object.entries(raw.map || {})) {
      known.set(sym, { sector: raw.sectors[si] || "", industry: raw.industries[ii] || "" });
    }
    console.log(`have → ${known.size} tickers from the last run`);
  }

  const bySymbol = new Map(known);
  let published = [];
  if (REGION === "IN") {
    /* An ISIN whose ticker is already classified needs no second ask. */
    const settled = new Set();
    for (const row of symbols) {
      if (known.has(clean(row.s).toUpperCase())) settled.add(clean(row.i));
    }
    const { byIsin, published: fromNse } = await indiaByIsin(settled);
    published = fromNse;
    /* One entry per TICKER. A dual-listed company is two rows in symbols.json
       and both point at the same ISIN, so both get the classification; where
       NSE and BSE spell the ticker differently that is two keys, which is
       exactly right, because a trade row carries whichever one its exchange
       uses. NSE first, so the handful of tickers BSE reuses for another
       company resolve the way isin.js already resolves them. */
    for (const venue of ["NSE", "BSE"]) {
      for (const row of symbols) {
        if (row.e !== venue) continue;
        const sym = clean(row.s).toUpperCase();
        const hit = byIsin.get(clean(row.i));
        if (sym && hit && !bySymbol.has(sym)) bySymbol.set(sym, hit);
      }
    }
  } else {
    const bySym = await usBySymbol();
    for (const row of symbols) {
      const sym = clean(row.s).toUpperCase();
      const hit = bySym.get(sym);
      if (sym && hit && !bySymbol.has(sym)) bySymbol.set(sym, hit);
    }
  }

  /* NSE's spellings are handed in first, so they are the ones the file
     keeps wherever BSE writes the same name differently. */
  const packed = pack(bySymbol, published);
  const covered = bySymbol.size;
  const total = new Set(symbols.map((r) => clean(r.s).toUpperCase())).size;
  console.log(`${REGION}   → ${covered} of ${total} tickers classified `
    + `(${packed.sectors.length} sectors, ${packed.industries.length} industries)`);

  /* The same guard the symbol builders carry: a source that answers but
     answers thinly writes a file that quietly empties the column. */
  if (existsSync(out) && !FORCE) {
    const had = Object.keys(JSON.parse(await readFile(out, "utf8")).map || {}).length;
    if (covered < had * 0.9) {
      throw new Error(`refusing to write: ${covered} classified vs ${had} already there. `
        + `Pass --force if the drop is real.`);
    }
  }

  await writeFile(out, JSON.stringify({
    region: REGION,
    built: new Date().toISOString().slice(0, 10),
    ...packed,
  }));
  console.log(`wrote public/${names.sectors}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
