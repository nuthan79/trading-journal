/**
 * Builds public/breadth.json — market breadth after every close since 2018 —
 * and public/breadth-levels.json, the per-stock levels a live feed will need.
 *
 *   npm run breadth            # fetch the days not yet cached, rebuild both
 *   npm run breadth -- --force # write even if the result shrank
 *
 * THE SOURCE IS NSE'S BHAVCOPY: one file per trading day with the close of
 * every listed security, published each evening and free to use — unlike live
 * prices, which NSE licenses. Two formats: the UDiFF file from January 2024,
 * the older cm…bhav.csv before it. Each is cached in .cache/bhav as the few
 * columns used, so a nightly run fetches one day, not two thousand.
 *
 * SPLITS ARE TAKEN OUT OF THE HISTORY, or a split stock sits "below its
 * 200-day average" for 200 days. The bhavcopy does NOT restate the previous
 * close on an ex-date — RELIANCE's 1:1 bonus shows a previous close of
 * ₹2,655.70 beside a close of ₹1,334.35, BSE's 2:1 bonus ₹6,996.50 beside
 * ₹2,448 — so the adjustment is inferred by `splitFactor` below: most stocks
 * cannot move more than 20% in a day, so a fall past 35% (or a rise past 60%)
 * that lands on a split or bonus ratio is a corporate action, not a market.
 * Small bonuses (1:4, 1:3) move the price by 20–25%, which a circuit allows,
 * and are left alone: a handful of names a year sit wrongly below their
 * averages for a while, which is noise in a count of seven hundred.
 *
 * A STOCK IS FOLLOWED THROUGH A RENAME by its ISIN (ZOMATO and ETERNAL are one
 * series), and through a face-value split — which changes the ISIN but keeps
 * the symbol — by its symbol.
 *
 * GROUPS come from public/mcap.json, the AMFI list in force on each day, so
 * run `npm run mcap` first when a new list is out. See lib/breadthCalc.js for
 * what is counted and why the groups are these.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { countBreadth, share, BREADTH_GROUPS } from "../src/lib/breadthCalc.js";

const FORCE = process.argv.includes("--force");
const FROM = (process.argv.find((a) => a.startsWith("--from="))?.slice(7)) || "2018-01-01";
const ROOT = process.cwd();
const CACHE = path.join(ROOT, ".cache", "bhav");
const OUT = path.join(ROOT, "public", "breadth.json");
const LEVELS_OUT = path.join(ROOT, "public", "breadth-levels.json");
const BROWSER = { "User-Agent": "Mozilla/5.0" };
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const SERIES = new Set(["EQ", "BE", "BZ"]);              // the main board; SME and debt left out
const KEEP = 252;                                        // a trading year of history per stock
const CHART_DAYS = 260;

/* ------------------------------------------------------------------ */
/*  Fetching one day                                                   */
/* ------------------------------------------------------------------ */

/** Today in India, for a script that may run anywhere. */
const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

function* weekdays(from, to) {
  const [y, m, d] = from.split("-").map(Number);
  for (let t = Date.UTC(y, m - 1, d); ; t += 86400000) {
    const s = new Date(t).toISOString().slice(0, 10);
    if (s > to) return;
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) yield s;
  }
}

/** The one file in a zip, without a dependency — NSE's are a single entry. */
function unzipOne(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error("not a zip");
  const method = buf.readUInt16LE(8);
  const nameLen = buf.readUInt16LE(26), extraLen = buf.readUInt16LE(28);
  let size = buf.readUInt32LE(18);
  const start = 30 + nameLen + extraLen;
  if (size === 0) {
    /* Sizes in a trailing descriptor: read them from the central directory. */
    const cd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    size = buf.readUInt32LE(cd + 20);
  }
  const data = buf.subarray(start, start + size);
  return method === 0 ? data.toString("utf8") : inflateRawSync(data).toString("utf8");
}

const urlsFor = (day) => {
  const [y, m, d] = day.split("-");
  return day >= "2024-01-01"
    ? [`https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${y}${m}${d}_F_0000.csv.zip`]
    : [`https://nsearchives.nseindia.com/content/historical/EQUITIES/${y}/${MON[m - 1]}/cm${d}${MON[m - 1]}${y}bhav.csv.zip`];
};

/** Rows of one day as `sym,isin,high,low,close,prev` — whichever format arrived. */
function parse(csv) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(",").map((h) => h.trim());
  const at = (...names) => head.findIndex((h) => names.includes(h));
  const c = {
    sym: at("TckrSymb", "SYMBOL"), series: at("SctySrs", "SERIES"), isin: at("ISIN"),
    high: at("HghPric", "HIGH"), low: at("LwPric", "LOW"),
    close: at("ClsPric", "CLOSE"), prev: at("PrvsClsgPric", "PREVCLOSE"),
  };
  if (Object.values(c).some((i) => i < 0)) throw new Error(`unknown bhavcopy columns: ${head.join(",")}`);
  const out = [];
  for (const line of lines.slice(1)) {
    const f = line.split(",");
    if (!SERIES.has(f[c.series]?.trim())) continue;
    out.push([f[c.sym].trim(), f[c.isin].trim(), +f[c.high], +f[c.low], +f[c.close], +f[c.prev]].join(","));
  }
  return out.join("\n");
}

/**
 * One day from the cache, or from NSE. A missing file is a holiday and is
 * remembered as one — except in the last week, when it may simply not be
 * published yet and must be asked for again tomorrow.
 */
async function day(d, today) {
  const hit = path.join(CACHE, `${d}.csv`), none = path.join(CACHE, `${d}.none`);
  if (existsSync(hit)) return readFile(hit, "utf8");
  if (existsSync(none)) return null;
  for (const u of urlsFor(d)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(u, { headers: BROWSER, signal: AbortSignal.timeout(30000) });
        if (r.status === 404) break;
        if (!r.ok) throw new Error(`${r.status}`);
        const rows = parse(unzipOne(Buffer.from(await r.arrayBuffer())));
        await writeFile(hit, rows);
        return rows;
      } catch (e) {
        if (attempt === 2) throw new Error(`${d}: ${e.message}`);
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      }
    }
  }
  const recent = (Date.parse(today) - Date.parse(d)) / 86400000 <= 7;
  if (!recent) await writeFile(none, "");
  return null;
}

/* ------------------------------------------------------------------ */
/*  Market-cap tier on a day                                           */
/* ------------------------------------------------------------------ */

function tierLookup(mcap) {
  const lists = mcap.lists;
  return (symbol, d) => {
    const codes = mcap.map[symbol];
    if (!codes) return "";
    let i = 0;
    for (let k = 0; k < lists.length; k++) if (lists[k].from <= d) i = k;
    for (let k = i; k < codes.length; k++) if (codes[k] !== "-") return codes[k];
    return "";
  };
}

/* ------------------------------------------------------------------ */
/*  The walk                                                           */
/* ------------------------------------------------------------------ */

/**
 * What to multiply a stock's history by today, or 1.
 *
 * A move no price band allows, landing within 8% of a split or bonus ratio,
 * is taken as one; a big move that lands on no ratio is left as a move.
 *
 * NSE's own previous close is NOT used, though it looks like the obvious
 * signal: it disagrees with the last close we hold whenever a session is
 * missing from the set — Diwali's Muhurat trading falls on a weekend, which
 * this walk skips — and trusting it restated six thousand histories that had
 * nothing wrong with them. The price-limit rule finds about a hundred a year,
 * which is what India's split-and-bonus calendar actually runs to.
 *
 * The one it can misread is a stock with no price band (an F&O name) falling
 * a third in a day, which it may take for a 1:2 bonus. That has to be a rare
 * day for a rare stock, and costs one name's averages for a while.
 */
const RATIOS = [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 15, 20, 25, 50, 100];
export function splitFactor(last, close) {
  const move = close / last;
  if (!(move > 0) || (move > 0.65 && move < 1.6)) return 1;
  const r = move < 1 ? 1 / move : move;
  const best = RATIOS.reduce((a, b) => (Math.abs(r / b - 1) < Math.abs(r / a - 1) ? b : a));
  if (Math.abs(r / best - 1) > 0.08) return 1;
  return move < 1 ? 1 / best : best;
}

const mean = (a, n) => {
  if (a.length < n) return null;
  let s = 0;
  for (let i = a.length - n; i < a.length; i++) s += a[i];
  return s / n;
};

async function main() {
  await mkdir(CACHE, { recursive: true });
  const mcap = JSON.parse(await readFile(path.join(ROOT, "public", "mcap.json"), "utf8"));
  const tierOf = tierLookup(mcap);
  const today = istToday();

  /* Fetch first, four at a time — gently; NSE is serving everybody else too. */
  const all = [...weekdays(FROM, today)];
  const files = new Map();
  let fetched = 0;
  for (let i = 0; i < all.length; i += 4) {
    const batch = all.slice(i, i + 4);
    const got = await Promise.all(batch.map(async (d) => {
      const cached = existsSync(path.join(CACHE, `${d}.csv`)) || existsSync(path.join(CACHE, `${d}.none`));
      const rows = await day(d, today);
      if (!cached) fetched++;
      return [d, rows];
    }));
    for (const [d, rows] of got) if (rows) files.set(d, rows);
    if (!(i % 200)) process.stdout.write(`\r${batch[0]}  ${files.size} trading days, ${fetched} fetched`);
  }
  process.stdout.write(`\r${today}  ${files.size} trading days, ${fetched} fetched\n`);

  /* Per stock: its adjusted closes, highs and lows, newest last. */
  const byIsin = new Map(), bySym = new Map();
  const state = [];
  const series = [];                 // [date, % of Top 750 above 50-day], every day
  const chart = [];                  // [date, {group: % above 50-day}], the last CHART_DAYS
  let latest = null, levels = [], adjusted = 0;

  const days = [...files.keys()].sort();
  days.forEach((d, di) => {
    const stocks = [];
    for (const line of files.get(d).split("\n")) {
      if (!line) continue;
      const [sym, isin, high, low, close, prev] = line.split(",");
      const c = +close, p = +prev, h = +high, l = +low;
      if (!(c > 0)) continue;
      let id = byIsin.get(isin) ?? bySym.get(sym);
      if (id === undefined) { id = state.length; state.push({ closes: [], highs: [], lows: [] }); }
      byIsin.set(isin, id); bySym.set(sym, id);
      const s = state[id];

      const last = s.closes.at(-1);
      const f = last > 0 ? splitFactor(last, c) : 1;
      if (f !== 1) {
        for (const k of ["closes", "highs", "lows"]) s[k] = s[k].map((v) => v * f);
        adjusted++;
      }
      s.closes.push(c); s.highs.push(h > 0 ? h : c); s.lows.push(l > 0 ? l : c);
      for (const k of ["closes", "highs", "lows"]) if (s[k].length > KEEP) s[k].shift();
      s.lastDay = d;

      const code = tierOf(sym, d);
      if (!code) continue;
      const enough = s.closes.length >= 60;
      stocks.push({
        s: sym, c: code, close: c,
        sma20: mean(s.closes, 20), sma50: mean(s.closes, 50), sma200: mean(s.closes, 200),
        hi: enough ? Math.max(...s.highs) : null, lo: enough ? Math.min(...s.lows) : null,
        prev: s.closes.length > 1 ? s.closes.at(-2) : null,
      });
    }

    const counts = countBreadth(stocks, (st) => st.close);
    /* Kept once the 50-day averages cover most of the market — before that
       the share is of a sample, not of the market. */
    if (counts.top.n50 >= counts.top.n * 0.8) {
      series.push([d, share(counts.top.a50, counts.top.n50)]);
      chart.push([d, Object.fromEntries(BREADTH_GROUPS.map((g) => [g, share(counts[g].a50, counts[g].n50)]))]);
      if (chart.length > CHART_DAYS) chart.shift();
    }
    latest = { date: d, counts };
    levels = stocks;
  });

  if (!series.length) throw new Error("no breadth computed — is mcap.json there?");
  const through = latest.date;
  console.log(`${adjusted} splits and bonuses taken out of the history`);
  console.log(`breadth ${series[0][0]} → ${through}: Top 750 ${share(latest.counts.top.a50, latest.counts.top.n50)}% above 50-day`);

  if (existsSync(OUT) && !FORCE) {
    const had = JSON.parse(await readFile(OUT, "utf8"));
    if (series.length < (had.days || []).length) {
      throw new Error(`refusing to write: ${series.length} days vs ${had.days.length} already there. `
        + `Pass --force if the drop is real.`);
    }
  }

  const round = (v) => (v == null ? null : Math.round(v * 100) / 100);
  await writeFile(OUT, JSON.stringify({
    built: istToday(),
    through,
    source: "NSE bhavcopy (end of day); groups from AMFI's market-cap lists",
    days: series,
    chart: {
      dates: chart.map(([d]) => d),
      ...Object.fromEntries(BREADTH_GROUPS.map((g) => [g, chart.map(([, v]) => v[g])])),
    },
    latest: latest.counts,
  }));
  /* What a live feed will judge prices against: today's levels, with the
     last close as the previous close. Not fetched by the app until a live
     source exists — see lib/breadth.js. */
  await writeFile(LEVELS_OUT, JSON.stringify({
    date: through,
    stocks: levels.map((st) => ({
      s: st.s, c: st.c, sma20: round(st.sma20), sma50: round(st.sma50), sma200: round(st.sma200),
      hi: round(st.hi), lo: round(st.lo), prev: st.close,
    })),
  }));
  console.log("wrote public/breadth.json and public/breadth-levels.json");
}

/* Run only as a script, so a probe can import splitFactor without a build. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
