/**
 * Quote sources.
 *
 * This file is the ONLY place that knows where prices come from. Every source
 * returns the same shape, so swapping Yahoo for your broker's API later means
 * editing this file and nothing else.
 *
 *   { symbol, exchange, price, prevClose, change, changePct, currency, at }
 *
 * A swing journal needs a handful of quotes on page load, not a tick stream.
 * That is why a cached serverless fetch is enough and a WebSocket is not.
 */

const YAHOO_SUFFIX = { NSE: ".NS", BSE: ".BO" };

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://finance.yahoo.com",
};

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

const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

async function yahooOne({ symbol, exchange, code }) {
  // Yahoo resolves BSE listings by symbol for the well-known names, but many
  // smaller BSE-only scrips only answer to their numeric scrip code. Try the
  // symbol first, then the code, so dual-listed names keep working exactly as
  // before while BSE-only ones stop silently returning nothing.
  const candidates =
    exchange === "BSE" && code
      ? [`${symbol}.BO`, `${code}.BO`]
      : [symbol + (YAHOO_SUFFIX[exchange] || ".NS")];

  let lastErr;

  for (const ticker of candidates) {
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
        symbol,          // always the symbol we were asked about, never the ticker
        exchange,
        price,
        prevClose,
        change,
        changePct: change != null && prevClose ? (change / prevClose) * 100 : null,
        currency: meta.currency || "INR",
        at: new Date().toISOString(),
      };
    } catch (err) {
      lastErr = err;
    }
  }
  }
  throw new Error(`${symbol} (${exchange}): ${lastErr?.message || "unavailable"}`);
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
