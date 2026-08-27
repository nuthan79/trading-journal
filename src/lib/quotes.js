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

const YAHOO_SUFFIX = { NSE: ".NS", BSE: ".BO" };


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
  const ticker = symbol + (YAHOO_SUFFIX[exchange] || ".NS");
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
  { id: "nifty500", ticker: "^CRSLDX", label: "Nifty 500" },
  { id: "nifty50", ticker: "^NSEI", label: "Nifty 50" },
  { id: "midcap150", ticker: "NIFTYMIDCAP150.NS", label: "Midcap 150" },
  { id: "smallcap250", ticker: "NIFTYSMLCAP250.NS", label: "Smallcap 250" },
];

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