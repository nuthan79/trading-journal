/**
 * Builds public/mcap.json — large, mid, small or micro cap for every Indian
 * listing, as it stood in each half-year since SEBI drew the line.
 *
 *   node scripts/build-mcap.mjs           # → public/mcap.json
 *   node scripts/build-mcap.mjs --force   # write even if it shrank
 *
 * THE RULE IS SEBI'S, THE LIST IS AMFI'S. SEBI's circular of 6 October 2017
 * ranks every listed company by full market capitalisation: 1–100 are large
 * cap, 101–250 mid cap, 251 onwards small cap. AMFI publishes the ranking
 * twice a year from the six-month average across NSE, BSE and MSEI — the list
 * for January–June takes effect from 1 August, the one for July–December from
 * 1 February. A ranking, not a rupee threshold, so the cut-offs drift up in a
 * rising market and nobody has to maintain a number.
 *
 * MICRO IS OURS, AND SAYS SO. "Small cap" is everything from rank 251 down —
 * about 5,000 companies, from ₹30,000 Cr to a few crore. Swing traders live
 * in that tail, so it is split at rank 750: 251–750 stay small, 751 onwards
 * are micro. Not a SEBI category; the column hint says so.
 *
 * WHY 750 AND NOT A RUPEE FIGURE. The user's line was "below ₹5,000 Cr", and
 * in the 2025–26 lists that is rank ~750–800. But a fixed rupee line drifts:
 * only 297 companies cleared ₹5,000 Cr in June 2020 against 795 in December
 * 2025, so "micro" would have started straight after the mid caps in 2020.
 * A rank keeps the same share of the market in every year, like AMFI's own
 * lines, and the hover still quotes each list's rupee figure. (NSE's indices
 * draw it at 500 — Nifty Microcap 250 is ranks 501–750 — so this is
 * deliberately the user's convention, not NSE's.)
 *
 * EVERY LIST IS KEPT, BECAUSE A TRADE IS CLASSIFIED AS IT WAS WHEN TAKEN. A
 * stock that doubled after you bought it may be mid cap now; read your trades
 * by today's list and the small caps you did best in get counted as mid-cap
 * wins, while the losers slide down into small. So the lookup picks the list
 * in force on the entry date, and this file carries all of them.
 *
 * KEYED BY SYMBOL, like sectors.json, because a trade row carries a symbol and
 * never an ISIN. Each list gives the symbols of its own day. The ISIN is used
 * HERE to stitch a company across renames — ZOMATO and ETERNAL are one ISIN —
 * so a trade stored under either name finds the lists from before and after:
 * a symbol takes its own row in a list where it appears, and its company's row
 * where it does not.
 *
 * PACKED AS ONE CHARACTER PER LIST: "1" large, "2" mid, "3" small, "4" micro,
 * "-" not ranked in that list. Eighteen lists make an eighteen-character
 * string per symbol, oldest first, which gzips to almost nothing.
 *
 * WHERE THE FILES ARE. AMFI's site lists them on its categorisation page and
 * the file names follow no pattern at all from one half-year to the next, so
 * the page is read for its links rather than guessing names. Re-run this each
 * January and July, when a new list appears.
 */

import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const FORCE = process.argv.includes("--force");
const OUT = path.join(process.cwd(), "public", "mcap.json");
const PAGE = "https://www.amfiindia.com/otherdata/categorisation-of-stocks";
const BROWSER = { "User-Agent": "Mozilla/5.0" };

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8,
                 sep: 9, oct: 10, nov: 11, dec: 12 };

/** The links to every list's spreadsheet, as the page currently publishes them. */
async function listUrls() {
  const html = await fetch(PAGE, { headers: BROWSER }).then((r) => {
    if (!r.ok) throw new Error(`AMFI page answered ${r.status}`);
    return r.text();
  });
  const urls = [...new Set(html.match(/https:\/\/[^"\\]*?\.xlsx/g) || [])]
    /* Letters only before matching: the names spell it "Market Capitalization",
       "MarketCapitalization" and "Market_Capitalization", and the page links
       other PDFs and spreadsheets beside these. */
    .filter((u) => /marketcap/i.test(decodeURIComponent(u).replace(/[^a-z]/gi, "")));
  if (!urls.length) throw new Error("no spreadsheets found on AMFI's categorisation page");
  return urls.map((u) => u.replace(/ /g, "%20"));
}

/**
 * When the six months ended, read from the sheet's own title — "the six
 * months ended 31 December 2025", "ended 31-Dec 2017", "30 June 2022".
 * Never from the file name, which AMFI has spelt eight different ways.
 */
function periodEnd(title) {
  const m = String(title).match(/ended\s+(\d{1,2})[\s-]*([A-Za-z]+)[\s,-]*(\d{4})/i);
  if (!m) return null;
  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (month !== 6 && month !== 12) return null;
  return { year: Number(m[3]), month };
}

/** The list for Jan–Jun applies from 1 August; for Jul–Dec, from 1 February. */
const inForceFrom = ({ year, month }) =>
  month === 6 ? `${year}-08-01` : `${year + 1}-02-01`;

const clean = (v) => String(v ?? "").trim().toUpperCase();
const real = (s) => s && s !== "-" && s !== "NA" && s !== "N.A.";

async function readList(url) {
  const buf = Buffer.from(await fetch(url, { headers: BROWSER }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} for ${url}`);
    return r.arrayBuffer();
  }));
  const wb = XLSX.read(buf, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const hi = rows.findIndex((r) => r.some((c) => /^isin$/i.test(String(c).trim())));
  if (hi < 0) throw new Error(`no header row in ${url}`);
  const head = rows[hi].map((c) => String(c).trim().toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const at = {
    rank: col(/^sr\.?\s*no/), isin: col(/^isin$/),
    bse: col(/^bse symbol$/), nse: col(/^nse symbol$/), cat: col(/^categori[sz]ation/),
    avg: col(/^average of all exchanges/),
  };
  for (const [k, v] of Object.entries(at)) if (v < 0) throw new Error(`no ${k} column in ${url}`);

  const end = periodEnd(rows.slice(0, hi).flat().join(" "));
  if (!end) throw new Error(`could not read the period from ${url}`);

  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const rank = Number(r[at.rank]);
    const cat = String(r[at.cat]).trim().toLowerCase();
    if (!(rank > 0) || !/cap/.test(cat)) continue;           // notes, blanks, footers
    out.push({ rank, isin: clean(r[at.isin]), nse: clean(r[at.nse]), bse: clean(r[at.bse]), cat,
               avg: Number(r[at.avg]) });
  }
  return { end, from: inForceFrom(end), rows: out };
}

/**
 * One character for a row. AMFI's own category decides large, mid and small —
 * it is the published answer, and a rank that disagrees with it is reported
 * rather than trusted. Rank only splits AMFI's small caps at 750.
 */
function code(row) {
  if (row.cat.startsWith("large")) return "1";
  if (row.cat.startsWith("mid")) return "2";
  return row.rank > LAST_SMALL_RANK ? "4" : "3";
}
const LAST_SMALL_RANK = 750;       // the last rank still called small — see the top of this file

/**
 * Where each size started in this list, in crore: the smallest large cap,
 * mid cap and small cap, from the six-month average AMFI ranked by. So the
 * hover can say "Small cap — ₹12,165 Cr to ₹34,758 Cr" for the list a trade
 * was actually placed by; the line moves with the market, list to list.
 */
function floorsOf(rows) {
  const min = (c) => Math.round(Math.min(...rows.filter((r) => code(r) === c && r.avg > 0).map((r) => r.avg)));
  const floors = { large: min("1"), mid: min("2"), small: min("3") };
  for (const [k, v] of Object.entries(floors)) {
    if (!(v > 0)) throw new Error(`no ${k}-cap floor in a list — the average column moved?`);
  }
  if (!(floors.large > floors.mid && floors.mid > floors.small)) {
    throw new Error(`floors out of order: ${JSON.stringify(floors)}`);
  }
  return floors;
}

async function main() {
  const urls = await listUrls();
  const lists = [];
  for (const u of urls) {
    const l = await readList(u);
    const tally = l.rows.reduce((a, r) => ({ ...a, [code(r)]: (a[code(r)] || 0) + 1 }), {});
    console.log(`${l.from}  ${l.rows.length} companies · large ${tally[1] || 0} · mid ${tally[2] || 0}`
      + ` · small ${tally[3] || 0} · micro ${tally[4] || 0}`);
    /* SEBI's line is 100 and 250. A list that does not land near it has been
       misread, and every trade classified from it would be wrong quietly. */
    if (Math.abs((tally[1] || 0) - 100) > 3 || Math.abs((tally[2] || 0) - 150) > 3) {
      throw new Error(`the list in force from ${l.from} does not split 100 / 150 — misread?`);
    }
    lists.push(l);
  }
  lists.sort((a, b) => a.from.localeCompare(b.from));
  for (let i = 1; i < lists.length; i++) {
    if (lists[i].from === lists[i - 1].from) throw new Error(`two lists in force from ${lists[i].from}`);
  }

  /* Companies across time: a symbol and an ISIN seen on one row are one
     company, so a rename (same ISIN, new symbol) and a face-value split (same
     symbol, new ISIN) both join up. */
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    parent.set(x, r);
    return r;
  };
  const join = (a, b) => parent.set(find(a), find(b));
  for (const l of lists) {
    for (const r of l.rows) {
      const keys = [r.isin && `I:${r.isin}`, real(r.nse) && `S:${r.nse}`, real(r.bse) && `S:${r.bse}`].filter(Boolean);
      for (let k = 1; k < keys.length; k++) join(keys[0], keys[k]);
    }
  }

  /* Per list: what each symbol's own row says, and what its company's best
     row says. NSE's symbol is claimed before BSE's, so in the rare case the
     two exchanges use one ticker for different companies, NSE keeps it. */
  const bySymbol = lists.map(() => new Map());
  const byCompany = lists.map(() => new Map());
  let collisions = 0;
  lists.forEach((l, i) => {
    for (const r of [...l.rows].sort((a, b) => a.rank - b.rank)) {
      const c = code(r);
      const company = find(r.isin ? `I:${r.isin}` : `S:${real(r.nse) ? r.nse : r.bse}`);
      if (!byCompany[i].has(company)) byCompany[i].set(company, c);
      if (real(r.nse) && !bySymbol[i].has(r.nse)) bySymbol[i].set(r.nse, c);
    }
    for (const r of l.rows) {
      if (!real(r.bse)) continue;
      if (bySymbol[i].has(r.bse)) { if (r.bse !== r.nse) collisions++; continue; }
      bySymbol[i].set(r.bse, code(r));
    }
  });

  const symbols = new Set(bySymbol.flatMap((m) => [...m.keys()]));
  const map = {};
  for (const s of [...symbols].sort()) {
    const company = find(`S:${s}`);
    map[s] = lists.map((_, i) => bySymbol[i].get(s) || byCompany[i].get(company) || "-").join("");
  }

  const count = Object.keys(map).length;
  console.log(`${lists.length} lists, ${count} symbols`
    + (collisions ? ` · ${collisions} BSE tickers left to NSE's company of the same name` : ""));

  if (existsSync(OUT) && !FORCE) {
    const had = JSON.parse(await readFile(OUT, "utf8"));
    if (count < Object.keys(had.map || {}).length * 0.9 || lists.length < (had.lists || []).length) {
      throw new Error(`refusing to write: ${count} symbols / ${lists.length} lists vs `
        + `${Object.keys(had.map || {}).length} / ${(had.lists || []).length} already there. `
        + `Pass --force if the drop is real.`);
    }
  }

  await writeFile(OUT, JSON.stringify({
    built: new Date().toISOString().slice(0, 10),
    source: "AMFI, average market capitalisation of listed companies (SEBI circular 6 Oct 2017)",
    /* Oldest first — the position of each character in a symbol's string. */
    lists: lists.map((l) => ({
      ended: `${l.end.year}-${String(l.end.month).padStart(2, "0")}-${l.end.month === 6 ? "30" : "31"}`,
      from: l.from,
      floors: floorsOf(l.rows),
    })),
    map,
  }));
  console.log("wrote public/mcap.json");
}

main().catch((err) => { console.error(err.message); process.exit(1); });
