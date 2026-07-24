/**
 * Builds public/symbols.json — the list the autocomplete searches.
 *
 *   node scripts/build-symbols.mjs
 *
 * Why a static file rather than a search API: the whole NSE + BSE equity
 * universe is small enough to ship to the browser once, which makes typing
 * three characters feel instant and costs zero API calls. It goes stale only
 * when listings change, so re-run this every month or two.
 *
 * SOURCES
 *   NSE — fetched automatically from the NSE archives.
 *   BSE — NSE blocks nothing, but BSE's list sits behind a form. Download it
 *         yourself once and drop the CSV in ./data/ :
 *           https://www.bseindia.com/corporates/List_Scrips.html
 *           (Segment: Equity, Status: Active → download)
 *         The script picks up any CSV in ./data/ automatically.
 *
 * If a download fails the script still writes whatever it did get, so you can
 * start with NSE only and add BSE later.
 */

import { writeFile, mkdir, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "public", "symbols.json");
const DATA_DIR = path.join(process.cwd(), "data");
const NSE_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";

/* --- tiny CSV parser: handles quoted fields, which BSE's export uses ---- */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

function toObjects(rows) {
  const head = rows[0].map((h) => h.trim().toUpperCase().replace(/\s+/g, "_"));
  return rows.slice(1).map((r) => {
    const o = {};
    head.forEach((h, i) => (o[h] = (r[i] || "").trim()));
    return o;
  });
}

const pick = (o, ...keys) => {
  for (const k of keys) if (o[k]) return o[k];
  return "";
};

/* ---------------------------------- NSE -------------------------------- */
async function nse() {
  try {
    const res = await fetch(NSE_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/csv,*/*",
        Referer: "https://www.nseindia.com/",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const objs = toObjects(parseCsv(await res.text()));
    // EQ is normal rolling settlement; BE/BZ are the trade-to-trade segment
    // (compulsory delivery, no intraday) — still real, tradable NSE stocks,
    // e.g. MTARTECH and BLISSGVS both list under BE.
    const out = objs
      .filter((o) => ["EQ", "BE", "BZ"].includes(pick(o, "SERIES")) || !o.SERIES)
      .map((o) => ({
        s: pick(o, "SYMBOL"),
        n: pick(o, "NAME_OF_COMPANY", "COMPANY_NAME"),
        e: "NSE",
      }))
      .filter((x) => x.s && x.n);
    console.log(`NSE  → ${out.length} symbols`);
    return out;
  } catch (err) {
    console.warn(`NSE  → failed (${err.message}). Drop the CSV in ./data/ instead.`);
    return [];
  }
}

/* -------------------------- Local CSVs (BSE etc.) ---------------------- */
async function local() {
  if (!existsSync(DATA_DIR)) return [];
  const files = (await readdir(DATA_DIR)).filter((f) => f.toLowerCase().endsWith(".csv"));
  const out = [];
  for (const f of files) {
    const objs = toObjects(parseCsv(await readFile(path.join(DATA_DIR, f), "utf8")));
    const looksBse = objs[0] && Object.keys(objs[0]).some((k) => k.includes("SECURITY"));
    for (const o of objs) {
      const s = pick(o, "SECURITY_ID", "SYMBOL", "SC_CODE", "SCRIP_ID");
      const n = pick(o, "ISSUER_NAME", "SECURITY_NAME", "NAME_OF_COMPANY", "COMPANY_NAME");
      const status = pick(o, "STATUS", "SECURITY_STATUS").toUpperCase();
      if (!s || !n) continue;
      if (status && status !== "ACTIVE") continue;
      out.push({ s, n, e: looksBse ? "BSE" : "NSE" });
    }
    console.log(`${f} → ${out.length} rows so far`);
  }
  return out;
}

/* ---------------------------------- run -------------------------------- */
const all = [...(await nse()), ...(await local())];

// De-dupe on symbol+exchange, prefer NSE when a name exists on both
const seen = new Map();
for (const x of all) {
  const key = `${x.e}:${x.s}`;
  if (!seen.has(key)) seen.set(key, x);
}

const list = [...seen.values()].sort((a, b) =>
  a.s === b.s ? (a.e === "NSE" ? -1 : 1) : a.s.localeCompare(b.s)
);

if (!list.length) {
  console.error("\nNothing to write. Put at least one CSV in ./data/ and retry.");
  process.exit(1);
}

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(list));

const kb = (Buffer.byteLength(JSON.stringify(list)) / 1024).toFixed(0);
console.log(`\nWrote ${list.length} symbols to public/symbols.json (${kb} KB)`);
console.log(`  NSE ${list.filter((x) => x.e === "NSE").length}  ·  BSE ${list.filter((x) => x.e === "BSE").length}`);
