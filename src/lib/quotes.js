import { YAHOO_HOSTS, BROWSER_HEADERS, rangeCovering } from "./yahoo";
/**
 * Quote sources.
 *
 * This file is the ONLY place that knows where prices come from. Every source
 * returns the same shape, so swapping Yahoo for your broker's API later means
 * editing this file and nothing else.
 *
 *   { symbol, exchange, price, prevClose, dayHigh, dayLow,
 *     change, changePct, currency, at }
 *
 * Any of prevClose, dayHigh and dayLow may be null — a replacement provider is
 * allowed not to have them, and the app degrades to hiding the figures that
 * need them rather than inventing values. What a replacement must NOT do is
 * return them from a different moment than `price`: they are compared against
 * it, so a stale close or range would place a holding inside a day it never
 * traded in.
 *
 * A swing journal needs a handful of quotes on page load, not a tick stream.
 * That is why a cached serverless fetch is enough and a WebSocket is not.
 */

/**
 * How a region spells a ticker for Yahoo.
 *
 * India needs a venue suffix — RELIANCE.NS, RELIANCE.BO — and the US needs
 * none: AAPL is AAPL. The exchanges themselves are listed in lib/regions.js;
 * this is the one place that turns a (symbol, exchange) pair into the string
 * the quote source answers to.
 *
 * THE DOT IS THE TRAP. The US exchanges publish share classes with a dot —
 * BRK.A, BRK.B — and Yahoo spells them with a dash. Asked for BRK.B it
 * returns 404, which surfaces as a holding that simply never prices, with
 * nothing to say why. Measured: BRK-B answers, BRK.B does not.
 */
const YAHOO_SUFFIX = { NSE: ".NS", BSE: ".BO",
                       NASDAQ: "", NYSE: "", AMEX: "", ARCA: "", BATS: "", IEXG: "" };

export function yahooTicker(symbol, exchange) {
  const raw = String(symbol || "").trim().toUpperCase();
  const venue = String(exchange || "").trim().toUpperCase();
  const suffix = YAHOO_SUFFIX[venue];
  /* An unknown exchange keeps the old behaviour — India, which is every row
     written before regions existed. */
  if (suffix === undefined) return raw + ".NS";
  return (suffix ? raw : raw.replace(/\./g, "-")) + suffix;
}


/* ------------------------------------------------------------------ */
/*  Source: Yahoo Finance (unofficial)                                 */
/*                                                                     */
/*  Uses /v8/finance/chart rather than /v7/finance/quote. The v7 quote  */
/*  endpoint now demands a cookie + crumb handshake and returns 401     */
/*  without one. v8 needs no authentication, but takes one symbol per  */
/*  request -- hence the small batches below.                          */
/*                                                                     */
/*  Undocumented either way: it can change shape or rate-limit without */
/*  notice, and prices are delayed rather than live.                   */
/* ------------------------------------------------------------------ */

const HOSTS = YAHOO_HOSTS;

async function yahooOne({ symbol, exchange }) {
  const ticker = yahooTicker(symbol, exchange);
  let lastErr;

  // query1 occasionally throttles where query2 does not, so try both.
  for (const host of HOSTS) {
    try {
      const url =
        `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}` +
        `?interval=1d&range=1d`;
      const res = await fetch(url, { headers: BROWSER_HEADERS, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const meta = (await res.json())?.chart?.result?.[0]?.meta;
      if (!meta) throw new Error("no data in response");

      const price = meta.regularMarketPrice ?? meta.previousClose ?? null;
      const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
      const change = price != null && prevClose != null ? price - prevClose : null;

      return {
        symbol,
        exchange,
        price,
        prevClose,
        // The session's own extremes, for judging where a close landed
        // inside its day. Present in the same meta object as the price, so
        // reading them costs nothing extra.
        dayHigh: meta.regularMarketDayHigh ?? null,
        dayLow: meta.regularMarketDayLow ?? null,
        change,
        changePct: change != null && prevClose ? (change / prevClose) * 100 : null,
        currency: meta.currency || "INR",
        at: new Date().toISOString(),
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`${ticker}: ${lastErr?.message || "unavailable"}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fromYahoo(items) {
  const out = [];
  const BATCH = 4;

  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH);
    const settled = await Promise.allSettled(slice.map(yahooOne));

    for (const r of settled) {
      if (r.status === "fulfilled") out.push(r.value);
      else console.warn("[quotes]", r.reason?.message);
    }
    if (i + BATCH < items.length) await sleep(120); // be a polite guest
  }

  // Only a total failure is worth surfacing -- one dud symbol shouldn't stop
  // the rest of the portfolio from marking.
  if (!out.length && items.length) {
    throw new Error("Yahoo returned nothing for any symbol");
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Source: your broker                                                */
/*                                                                     */
/*  Fill this in when you want reliable, sanctioned data. Angel One    */
/*  SmartAPI, Upstox, Fyers, Dhan and Shoonya all document a free tier;*/
/*  Zerodha's Kite Connect splits order placement (free Personal plan) */
/*  from market data (paid). Whichever you pick, the contract below is */
/*  all the rest of the app needs.                                     */
/* ------------------------------------------------------------------ */
async function fromBroker(items) {
  throw new Error(
    "Broker source not configured. Set QUOTE_SOURCE=yahoo, or implement fromBroker()."
  );
}

const SOURCES = { yahoo: fromYahoo, broker: fromBroker };

/* ------------------------------------------------------------------ */
/*  In-memory cache. Serverless instances are short-lived, so this is a */
/*  courtesy to the upstream API rather than a real cache -- it stops a */
/*  page refresh loop from hammering Yahoo.                             */
/* ------------------------------------------------------------------ */
const cache = new Map();
const TTL_MS = 60_000;

/**
 * What one unit of `from` is worth in `to`, from the same source as the
 * quotes — Yahoo spells a pair "USDINR=X".
 *
 * ONE RATE, TODAY'S. Used only to show a US book's figures in rupees for
 * somebody who thinks in them, never to blend two books into one total. A
 * trade that made $500 made $500 whatever the rupee does; this answers the
 * different question "what is that worth to me today", and every screen that
 * uses it says so.
 *
 * Null when the source is down. A missing rate must cost the conversion and
 * nothing else — the dollars are the real figures and are always there.
 */
export async function fxRate(from = "USD", to = "INR") {
  if (from === to) return 1;
  for (const host of HOSTS) {
    try {
      const url = `https://${host}/v8/finance/chart/${from}${to}=X?interval=1d&range=1d`;
      const res = await fetch(url, { headers: BROWSER_HEADERS, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const meta = (await res.json())?.chart?.result?.[0]?.meta;
      const rate = meta?.regularMarketPrice ?? meta?.previousClose ?? null;
      if (rate > 0) return rate;
    } catch { /* try the other host, then give up quietly */ }
  }
  return null;
}

/**
 * The splits a stock has had since a date — and with them, bonus issues.
 *
 * A 1:1 bonus is arithmetically a 2:1 split, and the source reports it as
 * one: NESTLEIND comes back as 10:1 in January 2024 and 2:1 in August 2025,
 * TRENT as 3:2. So one feed answers both, and the journal needs no separate
 * idea of a bonus.
 *
 * WHY THIS MATTERS MORE THAN IT SOUNDS. An order book states the price and
 * quantity of the day the order filled. After a 10-for-1 split the same
 * holding is ten times the shares at a tenth the price, and a journal that
 * never heard about it shows Netflix bought at $1,219 against a mark of $73
 * — a 94% loss that did not happen, and an R figure built on a stop ten
 * times too far away.
 *
 * Returns [{ date: "YYYY-MM-DD", ratio }] oldest first, where ratio is what
 * the share count was MULTIPLIED by: 10 for 10:1, 1.5 for 3:2. Empty when
 * there were none or the source is down — a missing answer must cost the
 * check and nothing else.
 */
const splitCache = new Map();
const SPLIT_TTL_MS = 12 * 60 * 60 * 1000;

export async function splitsFor({ symbol, exchange }, range = "5y") {
  const ticker = yahooTicker(symbol, exchange);
  /* Held for half a day on the server as well as in the browser: one cold
     book is three hundred lookups, and two people holding the same stock
     should not each pay for it. A corporate action is announced weeks ahead
     of the day it takes effect, so half a day late is not late. */
  const hit = splitCache.get(ticker);
  if (hit && Date.now() - hit.at < SPLIT_TTL_MS) return hit.splits;
  for (const host of HOSTS) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}` +
                  `?interval=1d&range=${encodeURIComponent(range)}&events=split`;
      const res = await fetch(url, { headers: BROWSER_HEADERS, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const events = (await res.json())?.chart?.result?.[0]?.events?.splits || {};
      const splits = Object.values(events)
        .map((e) => {
          const num = Number(e?.numerator), den = Number(e?.denominator);
          const at = Number(e?.date);
          if (!(num > 0) || !(den > 0) || !Number.isFinite(at)) return null;
          const d = new Date(at * 1000);
          return {
            date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
            ratio: num / den,
          };
        })
        .filter(Boolean)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      splitCache.set(ticker, { at: Date.now(), splits });
      return splits;
    } catch { /* try the other host, then say nothing happened */ }
  }
  return [];
}

export async function getQuotes(items, sourceName) {
  const source = SOURCES[sourceName || process.env.QUOTE_SOURCE || "yahoo"];
  if (!source) throw new Error(`Unknown quote source: ${sourceName}`);

  const now = Date.now();
  const fresh = [];
  const need = [];

  for (const it of items) {
    const key = `${it.exchange}:${it.symbol}`;
    const hit = cache.get(key);
    if (hit && now - hit.t < TTL_MS) fresh.push(hit.v);
    else need.push(it);
  }

  if (need.length) {
    const fetched = await source(need);
    for (const q of fetched) {
      cache.set(`${q.exchange}:${q.symbol}`, { t: now, v: q });
      fresh.push(q);
    }
  }
  return fresh;
}

/* ------------------------------------------------------------------ */
/*  Index history                                                      */
/*                                                                     */
/*  A daily close series for a broad index, so the deployment chart can */
/*  be read against what the market was doing at the time.              */
/*                                                                     */
/*  UNLIKE QUOTES, THIS IS THE SAME FOR EVERY USER. One cache entry     */
/*  serves the whole deployment, which is the opposite of the per-symbol */
/*  quote problem — adding this screen does not add to that load. The   */
/*  series only changes once a day, after close, so the TTL is hours.   */
/* ------------------------------------------------------------------ */

/**
 * Indices offered, by the ticker Yahoo knows them as.
 *
 * Nifty 500 is the default because it is the widest NSE index with a long
 * history, and a breakout system trades far outside the top 50. It is still
 * only a proxy: an index can grind upward through a stretch where breakouts
 * are failing, which is precisely when the chart is most tempting to
 * misread. Breadth would be the honest measure and Yahoo does not carry it.
 */
/**
 * WHY NOT MIDSMALLCAP 400, which is the one a breakout trader actually wants.
 *
 * Yahoo answers for it — `NIFTYMIDSML400.NS` returns a live level — but asked
 * for a date range it returns a single close and a firstTradeDate of
 * 1970-01-01, which is its null. There is no history behind that quote, so a
 * button for it would draw an empty panel.
 *
 * Its two halves do have full history, and they are listed separately rather
 * than blended into a synthetic 400. Combining them correctly needs free-float
 * market-cap weights that are not in this data; averaging them would produce a
 * line that looks like an index, is not one, and could not be checked against
 * anything. Same rule as the broker adapters — no series without a real source
 * to test it against.
 */
export const INDICES = [
  { id: "nifty500", ticker: "^CRSLDX", label: "Nifty 500", region: "IN" },
  { id: "nifty50", ticker: "^NSEI", label: "Nifty 50", region: "IN" },
  { id: "midcap150", ticker: "NIFTYMIDCAP150.NS", label: "Midcap 150", region: "IN" },
  { id: "smallcap250", ticker: "NIFTYSMLCAP250.NS", label: "Smallcap 250", region: "IN" },
  /* The US set, checked against Yahoo the same way: each returns a live level
     AND real history, which is the test the Midcap Smallcap 400 failed. */
  { id: "sp500", ticker: "^GSPC", label: "S&P 500", region: "US" },
  { id: "nasdaq100", ticker: "^NDX", label: "Nasdaq 100", region: "US" },
  { id: "russell2000", ticker: "^RUT", label: "Russell 2000", region: "US" },
];

/** The indices of one book. Defaults to India, like everything else here. */
export const indicesFor = (regionId = "IN") =>
  INDICES.filter((i) => i.region === (regionId || "IN"));

const histCache = new Map();
const HIST_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Daily closes between two dates, oldest first: [{ d: 'YYYY-MM-DD', c }].
 *
 * Returns [] rather than throwing when the source is down — the deployment
 * chart is fully readable without the index behind it, and a dead upstream
 * should cost you a comparison, not the screen.
 */
export async function getIndexHistory({ index = "nifty500", from, to } = {}) {
  const spec = INDICES.find((i) => i.id === index) || INDICES[0];
  /**
   * `range=`, not `period1`/`period2`.
   *
   * The explicit window is the obvious way to ask for one and it is also what
   * Yahoo refuses: every request bars.js made in that shape came back 429
   * while the callers using `range=` were served from the same host in the
   * same minute. This function had the same shape and nobody had noticed,
   * because the deployment chart degrades to no index line rather than to an
   * error — a comparison quietly missing looks like a comparison nobody drew.
   *
   * Asking relative and trimming afterwards costs a little extra payload and
   * makes it the same request the working callers send.
   */
  const start = String(from || "2000-01-01").slice(0, 10);
  /*
   * THE ONE `toISOString` DAY THAT IS LEFT, AND IT IS RIGHT HERE.
   *
   * This module is imported only by the API routes, so it runs on the server,
   * where "local" is UTC and a local-calendar helper would return exactly this
   * string while implying it had asked somebody's browser.
   *
   * It is also harmless. `end` only trims the tail of a history response, and
   * the UTC day differs from the IST one solely between midnight and 05:30
   * IST — hours in which the exchange is shut and there is no newer bar to
   * lose. Eastward of here the UTC day runs ahead rather than behind, and
   * asking for a day that has no data yet costs nothing.
   */
  const end = String(to || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const range = rangeCovering(start);

  const key = `${spec.id}:${range}:${start}:${end}`;
  const hit = histCache.get(key);
  if (hit && Date.now() - hit.t < HIST_TTL_MS) return hit.v;

  for (const host of HOSTS) {
    try {
      const url =
        `https://${host}/v8/finance/chart/${encodeURIComponent(spec.ticker)}` +
        `?interval=1d&range=${range}`;
      const res = await fetch(url, { headers: BROWSER_HEADERS, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const r = (await res.json())?.chart?.result?.[0];
      const ts = r?.timestamp || [];
      const closes = r?.indicators?.quote?.[0]?.close || [];

      const out = [];
      for (let i = 0; i < ts.length; i++) {
        if (closes[i] == null) continue;   // trading halts leave null holes
        const d = new Date(ts[i] * 1000).toISOString().slice(0, 10);
        // The range reaches back further than asked; the caller wanted a window.
        if (d < start || d > end) continue;
        out.push({ d, c: Math.round(closes[i] * 100) / 100 });
      }
      if (!out.length) throw new Error("no closes in response");

      const v = { index: spec.id, label: spec.label, points: out };
      histCache.set(key, { t: Date.now(), v });
      return v;
    } catch (err) {
      console.warn("[index-history]", spec.ticker, err?.message);
    }
  }
  return { index: spec.id, label: spec.label, points: [] };
}