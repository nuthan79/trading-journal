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

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  Referer: "https://finance.yahoo.com",
};

/**
 * BSE IS NOT SUPPORTED HERE AND MUST NOT BE FAKED.
 *
 * `public/symbols.json` carries the BSE scrip code as the canonical id, and
 * CODE.BO returns a DIFFERENT SECURITY on Yahoo — measured, and the reason
 * that note is in CLAUDE.md. Guessing a ticker from the symbol would silently
 * measure some other company's price path against this trade's entry, which
 * is worse than measuring nothing: the numbers would look entirely normal.
 */
const SUFFIX = { NSE: ".NS" };

export function tickerFor(symbol, exchange) {
  const suffix = SUFFIX[exchange];
  return suffix ? `${symbol}${suffix}` : null;
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
  for (const host of HOSTS) {
    try {
      const url =
        `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}` +
        `?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplit`;
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
