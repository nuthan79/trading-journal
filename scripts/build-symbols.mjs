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
 *   BSE — fetched automatically from BSE's own ListofScripData endpoint, the
 *         one the List of Scrips page calls to fill its table.
 *   ./data/*.csv — any CSV dropped in there, still read, as a manual fallback.
 *
 * BSE USED TO BE A MANUAL STEP and the note here said its list "sits behind a
 * form". The form posts to a JSON endpoint that answers a plain GET, so the
 * download was never actually necessary — and because it was manual it never
 * happened. symbols.json shipped NSE-only for months, which is why the
 * exchange picker was written and then reverted the same day (08549ca): there
 * were no BSE rows for it to offer, so a dual-listed name silently stayed NSE.
 *
 * WHAT THE SCRIP CODE IS FOR, AND WHAT IT IS EMPHATICALLY NOT FOR.
 *
 * BSE rows carry `c`, the numeric scrip code — the canonical identifier for a
 * BSE listing, the one BSE's own endpoints are keyed on and the one a broker
 * API will want. It is kept for that.
 *
 * IT IS NOT A YAHOO TICKER. The reverted commit 4e6db9b intended exactly that:
 * ask Yahoo for `SYMBOL.BO` and fall back to `CODE.BO`, on the stated grounds
 * that "many smaller BSE-only scrips only answer to their numeric scrip code".
 * That was never tested, and it is false in both halves:
 *
 *   - Twenty BSE-only names sampled across the alphabet ALL resolved by
 *     ticker. There is nothing for a fallback to rescue.
 *   - The code form returns a DIFFERENT SECURITY. Yahoo already uses numeric
 *     tickers for other instruments, so `535910.BO` answers with a price —
 *     ₹189.20 — while MMLF, the scrip that code belongs to, trades at ₹0.66.
 *     RELIANCE resolves by ticker and returns nothing for `500325.BO`.
 *
 * So the fallback would not have filled gaps; it would have marked positions
 * at another company's price, in rupees, beside correct figures, with nothing
 * saying which was which. Left unbuilt on purpose. If a future quote source
 * genuinely keys on scrip codes, the field is already here.
 *
 * NSE rows have no `c` and need none.
 *
 * If a download fails the script still writes whatever it did get, so a BSE
 * outage leaves you with a working NSE-only file rather than no file.
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
        // The feed has carried this all along and it was being dropped.
        // Brokers other than Zerodha identify a stock by ISIN and company
        // name and never give a ticker, so this column is the only thing
        // that makes their exports readable. It also survives a rename,
        // which a ticker does not.
        i: pick(o, "ISIN_NUMBER", "ISIN"),
      }))
      .filter((x) => x.s && x.n);
    console.log(`NSE  → ${out.length} symbols`);
    return out;
  } catch (err) {
    console.warn(`NSE  → failed (${err.message}). Drop the CSV in ./data/ instead.`);
    return [];
  }
}

/* ---------------------------------- BSE -------------------------------- */

/**
 * The endpoint the List of Scrips page calls to fill its own table.
 *
 * It answers a plain GET with the whole active equity universe — roughly five
 * thousand rows — provided a browser User-Agent and a bseindia.com Referer are
 * sent. Without the Referer it returns 403.
 */
const BSE_URL =
  "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w" +
  "?Group=&Scripcode=&industry=&segment=Equity&status=Active";

/**
 * Fetch with a couple of retries, because BSE rate-limits.
 *
 * Observed while building this: the endpoint answered fine, then refused the
 * next few calls made in quick succession, then recovered. A single attempt
 * therefore turns a working build into an NSE-only one at random, which is
 * precisely the outcome the guard at the bottom of this file exists to catch —
 * but not failing in the first place is better than being told you failed.
 */
async function fetchRetry(url, opts, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      last = err;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

async function bse() {
  try {
    const res = await fetchRetry(BSE_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
        Referer: "https://www.bseindia.com/",
      },
    });
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("unexpected response shape");

    const out = rows
      /**
       * Every group is kept — A, B, T, X, Z and the rest. They describe
       * surveillance and settlement rather than whether a thing is a share:
       * a T-group scrip is compulsory-delivery, and Z is a company behind on
       * its filings, but both are stock somebody can be holding and therefore
       * needs to log. The filter that matters is Equity, which excludes debt
       * and the mutual-fund segment.
       */
      .filter((r) => r.Segment === "Equity" && r.Status === "Active")
      .map((r) => {
        const isin = String(r.ISIN_NUMBER || "").trim();
        const scripId = String(r.scrip_id || "").trim().toUpperCase();
        /**
         * An INF ISIN is a fund rather than a company. Two very different
         * things arrive under it and only one of them belongs here — see the
         * filter below.
         */
        const fund = isin.startsWith("INF");
        return {
          s: scripId,
          /**
           * Which name, and it depends on what the row is.
           *
           * For a company, Issuer_Name is the legal name ("ABB India Limited")
           * and matches the shape NSE supplies, so search behaves the same
           * across both halves of the file.
           *
           * For a fund it is the asset manager — every Nippon ETF would be
           * called "Nippon India Mutual Fund", making two hundred rows
           * indistinguishable in an autocomplete. Scrip_Name is the actual
           * product there: "Kotak S&P BSE Sensex ETF", "Motilal Oswal NASDAQ
           * 100 ETF".
           */
          n: String((fund ? r.Scrip_Name : r.Issuer_Name) || r.Scrip_Name || "").trim(),
          e: "BSE",
          i: isin,
          c: String(r.SCRIP_CD || "").trim(),
          _fund: fund,
        };
      })
      /**
       * ETFs stay, mutual fund scheme codes go.
       *
       * BSE files both under segment "Equity", but they are not the same
       * animal. An ETF trades on the exchange like a share and somebody can
       * genuinely be holding BANKBEES or NIFTYIETF — 227 of those. The other
       * 30 are BSE StAR MF platform codes for ordinary open-ended schemes,
       * which arrive as symbols like `08ABB` and `08ADD`; they are bought from
       * the fund, not traded, and no swing trading journal has a use for them.
       *
       * The tell is the symbol: a traded instrument has a ticker, a StAR MF
       * scheme has a number. Checked against the whole list rather than
       * assumed — every digit-leading INF row was a scheme code and every
       * named one was a real ETF.
       */
      .filter((x) => !(x._fund && /^[0-9]/.test(x.s)))
      .map(({ _fund, ...x }) => x)
      .filter((x) => x.s && x.n && x.c);

    console.log(`BSE  → ${out.length} symbols`);
    return out;
  } catch (err) {
    console.warn(
      `BSE  → failed (${err.message}). Falling back to any CSV in ./data/ — ` +
      `download one from https://www.bseindia.com/corporates/List_Scrips.html`
    );
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
      const i = pick(o, "ISIN_NO", "ISIN_NUMBER", "ISIN");
      const status = pick(o, "STATUS", "SECURITY_STATUS").toUpperCase();
      if (!s || !n) continue;
      if (status && status !== "ACTIVE") continue;
      out.push({ s, n, e: looksBse ? "BSE" : "NSE", ...(i ? { i } : {}) });
    }
    console.log(`${f} → ${out.length} rows so far`);
  }
  return out;
}

/* ---------------------------------- run -------------------------------- */
const all = [...(await nse()), ...(await bse()), ...(await local())];

// De-dupe on symbol+exchange, prefer NSE when a name exists on both
const seen = new Map();
for (const x of all) {
  const key = `${x.e}:${x.s}`;
  if (!seen.has(key)) seen.set(key, x);
}

/**
 * NSE FIRST FOR A SHARED SYMBOL, AND THIS ORDERING IS LOAD-BEARING.
 *
 * `isin.js` builds its lookup with `if (!by.has(r.i))` — first row wins — so
 * whichever listing appears first in this file is the one every broker import
 * resolves to. Roughly 2,270 companies are listed on both exchanges and carry
 * the same ISIN, so without this the exchange an imported trade lands on would
 * be decided by alphabetical accident.
 *
 * NSE is the right winner: it is where the volume is, and every broker tax
 * P&L seen so far reports NSE trades. A trade that really happened on BSE is
 * still selectable by hand in the picker, which is what the `e` field is for.
 *
 * Verified when BSE was added: of the dual-listed names, zero disagree with
 * NSE on the ticker, so this only decides the exchange, never the symbol.
 */
const list = [...seen.values()].sort((a, b) =>
  a.s === b.s ? (a.e === "NSE" ? -1 : 1) : a.s.localeCompare(b.s)
);

if (!list.length) {
  console.error("\nNothing to write. Put at least one CSV in ./data/ and retry.");
  process.exit(1);
}

/**
 * A SHRINKING FILE IS A FAILED BUILD, NOT A SMALLER UNIVERSE.
 *
 * This script used to write whatever it managed to collect, on the reasoning
 * that a partial file beats no file. That is true the first time and wrong
 * every time after: BSE rate-limited one run during development and the script
 * cheerfully replaced 7,524 symbols with 2,553, reporting the failure in a
 * warning line above a confident success message. Nothing downstream would
 * have noticed — the autocomplete would simply have stopped offering half the
 * market, and an import resolving a BSE ISIN would quietly keep the company
 * name instead.
 *
 * So a build that loses more than a tenth of what is already there stops and
 * says which source came back empty. `--force` is there for the legitimate
 * case of a genuinely shorter list, which is rare enough to be worth typing.
 */
const FORCE = process.argv.includes("--force");
let previous = [];
if (existsSync(OUT)) {
  try {
    previous = JSON.parse(await readFile(OUT, "utf8"));
  } catch {
    // An unreadable existing file is not a reason to refuse to write a good
    // one — that would leave the project stuck with a corrupt symbols.json.
  }
}

if (!FORCE && previous.length && list.length < previous.length * 0.9) {
  const was = (e) => previous.filter((x) => x.e === e).length;
  const now = (e) => list.filter((x) => x.e === e).length;
  const lost = ["NSE", "BSE"].filter((e) => now(e) < was(e) * 0.9);
  console.error(
    `\nRefusing to write: ${list.length} symbols would replace ${previous.length}.` +
    `\n  ${lost.map((e) => `${e} ${was(e)} → ${now(e)}`).join("  ·  ") || "no single source accounts for it"}` +
    `\nA source probably failed above. Re-run, or pass --force if the list really did shrink.`
  );
  process.exit(1);
}

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(list));

const kb = (Buffer.byteLength(JSON.stringify(list)) / 1024).toFixed(0);
console.log(`\nWrote ${list.length} symbols to public/symbols.json (${kb} KB)`);
console.log(`  NSE ${list.filter((x) => x.e === "NSE").length}  ·  BSE ${list.filter((x) => x.e === "BSE").length}`);
