/**
 * Daily bars for one listing.
 *
 * A sibling of `getIndexHistory` in quotes.js — same undocumented Yahoo chart
 * endpoint, same two hosts, same shape of failure — but per stock and carrying
 * the whole bar rather than just the close. Kept here rather than there
 * because quotes.js is the LIVE price seam, the thing a broker API would one
 * day replace; history is a different question with a different answer, and
 * folding them together would mean swapping both to change either.
 *
 * ADJUSTED PRICES, NOT RAW, AND THIS IS THE ONE THAT MATTERS.
 *
 * Bonuses and splits are routine on NSE. A 1:2 split mid-hold leaves every
 * raw price before it at twice the scale of the entry it will be compared
 * against, so a stock that did nothing would show a 100% run and land in the
 * journal as a power trade. Yahoo returns an `adjclose` series alongside the
 * raw one; the ratio between them for a given day is the adjustment factor
 * for that day, and applying it to the open, high and low puts the whole bar
 * on the same footing as today's price — which is the footing the trade's
 * own entry price is recorded on.
 */

const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * WHAT 429 ACTUALLY MEANT HERE, BECAUSE IT WAS NOT A BLOCKED DEPLOYMENT.
 *
 * The first real run returned 429 for all ninety-seven symbols, which reads
 * like Yahoo refusing the host — except the market-regime strip at the top of
 * the same screen had just loaded, and that is the same v8 chart endpoint from
 * the same server seconds earlier. One request works. Twelve back to back do
 * not.
 *
 * So the fix is pace, not a different source: a gap between symbols, a gap
 * before trying the second host, and one retry after a longer wait. It makes a
 * cold pass slow, which costs nothing that matters — every bar fetched is
 * cached in `price_bars` for every user of the deployment, so this is a
 * one-off per symbol and never happens again.
 */
const RETRY_AFTER_MS = 2500;
const HOST_GAP_MS = 400;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  Referer: "https://finance.yahoo.com",
};

/**
 * BSE WORKS. THE SCRIP CODE DOES NOT — AND THOSE ARE DIFFERENT CLAIMS.
 *
 * This file first refused BSE outright, on the CLAUDE.md note that a scrip
 * code is never usable as a Yahoo ticker. The note is true and the conclusion
 * did not follow: `symbols.json` carries BOTH for every BSE listing — `s`, the
 * ticker, and `c`, the code — and `isin.js` writes `hit.s` into the trade. So
 * a BSE trade holds "20MICRONS", not "533022", and 20MICRONS.BO is a real
 * ticker. `quotes.js` has mapped BSE to .BO since long before this file
 * existed; it is how BSE holdings get a CMP at all.
 *
 * What the note guards against is real but narrow: a lot whose ISIN did not
 * resolve keeps whatever the broker file called it, and a BSE file may well
 * call it 533022. THAT is the string that must never get a suffix, because
 * 533022.BO resolves to some other company and would measure its price path
 * against this trade while looking entirely ordinary doing it.
 *
 * So the refusal is on the shape of the symbol, not on the exchange.
 */
const SUFFIX = { NSE: ".NS", BSE: ".BO" };

/** Digits only — a scrip code that never resolved to a ticker. */
const isScripCode = (s) => /^\d+$/.test(String(s || "").trim());

export function tickerFor(symbol, exchange) {
  const suffix = SUFFIX[exchange];
  if (!suffix || !symbol || isScripCode(symbol)) return null;
  return `${symbol}${suffix}`;
}

const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

/**
 * @returns { bars: [{d,o,h,l,c}], error } — never throws, so one dead symbol
 *          cannot take down a backfill of forty.
 */
export async function fetchBars({ symbol, exchange = "NSE", from, to }) {
  const ticker = tickerFor(symbol, exchange);
  if (!ticker) return { bars: [], error: `${exchange} is not supported` };

  const p1 = Math.floor(new Date(from).getTime() / 1000);
  /* One day past the end, because period2 is exclusive of the final session
     often enough that an exit-day bar goes missing without it. */
  const p2 = Math.floor(new Date(to).getTime() / 1000) + 86400;
  if (!Number.isFinite(p1) || !Number.isFinite(p2) || p2 <= p1) {
    return { bars: [], error: "bad date range" };
  }

  let lastErr = null;
  /* Both hosts, then both again after a wait. The second pass is what turns a
     throttle into a delay instead of a failure. */
  const attempts = [...HOSTS, ...HOSTS];

  for (let i = 0; i < attempts.length; i++) {
    const host = attempts[i];
    if (i > 0) await sleep(i === HOSTS.length ? RETRY_AFTER_MS : HOST_GAP_MS);
    try {
      /* No `events=div,split`. The adjusted close comes back without it, the
         split and dividend EVENTS are not read here, and it was the one thing
         in this URL the working market-regime request does not send. */
      const url =
        `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}` +
        `?period1=${p1}&period2=${p2}&interval=1d`;
      const res = await fetch(url, { headers: BROWSER_HEADERS, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const r = (await res.json())?.chart?.result?.[0];
      const ts = r?.timestamp || [];
      const q = r?.indicators?.quote?.[0] || {};
      const adj = r?.indicators?.adjclose?.[0]?.adjclose || [];

      const bars = [];
      for (let i = 0; i < ts.length; i++) {
        const c = q.close?.[i];
        // Trading halts leave null holes; a bar with no close is not a bar.
        if (c == null) continue;

        /* Same-day factor: adjclose / close. 1 where there has been no action
           since, which is most days, and it costs nothing to apply anyway. */
        const a = adj[i];
        const f = a != null && c ? a / c : 1;

        bars.push({
          d: new Date(ts[i] * 1000).toISOString().slice(0, 10),
          o: r2(q.open?.[i] == null ? null : q.open[i] * f),
          h: r2(q.high?.[i] == null ? null : q.high[i] * f),
          l: r2(q.low?.[i] == null ? null : q.low[i] * f),
          c: r2(c * f),
        });
      }
      if (!bars.length) throw new Error("no bars in response");
      return { bars, error: null };
    } catch (err) {
      lastErr = err?.message || String(err);
    }
  }
  return { bars: [], error: lastErr || "unavailable" };
}
