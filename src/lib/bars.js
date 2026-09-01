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

import { YAHOO_HOSTS as HOSTS, BROWSER_HEADERS, rangeCovering } from "./yahoo";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * WHAT THE 429 ACTUALLY WAS, AFTER TWO WRONG ANSWERS.
 *
 * Every symbol came back 429 on the first real run. The first guess was that
 * Yahoo blocks the deployment; the market-regime strip on the same screen
 * seemed to disprove it — until that route turned out to be edge-cached for
 * an hour, so it proved nothing. The second guess was volume, and pacing the
 * requests further apart changed nothing at all.
 *
 * What settled it was Refresh Prices: ten sequential quote requests from the
 * same server, in the same minute, all fine. So it was never the host and
 * never the rate. It was this file asking differently — a User-Agent and an
 * Accept that no other caller sent, and `period1`/`period2` where both
 * working callers use `range=`. A fingerprint, not a limit.
 *
 * The headers live in yahoo.js now so there is one copy to be right. The
 * pacing below stays because it is cheap and a burst is worth avoiding on an
 * unofficial endpoint either way — but it was not the problem.
 */
const RETRY_AFTER_MS = 2500;
const HOST_GAP_MS = 400;

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

/**
 * HOW A LISTING IS NAMED ON THE WIRE. One definition, because it is a
 * CONTRACT between two files that never see each other.
 *
 * /api/bars returns its bars in an object keyed by this string, and every
 * caller looks them up by rebuilding it. There were three hand-built copies:
 * the route, measure.js, and the chart wall — and the third invented
 * "SYMBOL|EXCHANGE" where the wire speaks "SYMBOL:EXCHANGE". Nothing failed.
 * The request went out, the bars came back, every lookup missed, and all
 * twenty-four charts said "Not measured yet" — which is exactly what they
 * would say if the data were genuinely absent.
 *
 * That is the shape of the failure worth guarding: a mismatch between two
 * halves of a wire format is not a crash, it is silence that looks like an
 * empty result. Nothing a build or a type can catch.
 *
 * Normalised the way the ROUTE normalises, since the route is what emits the
 * keys — a lowercase symbol in the database would otherwise come back
 * uppercased and miss on the way in.
 */
export const barsKeyFor = (symbol, exchange) =>
  `${String(symbol || "").toUpperCase().trim()}:` +
  `${String(exchange || "NSE").toUpperCase().trim()}`;

const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

/**
 * @returns { bars: [{d,o,h,l,c}], error } — never throws, so one dead symbol
 *          cannot take down a backfill of forty.
 */
export async function fetchBars({ symbol, exchange = "NSE", from, to }) {
  const ticker = tickerFor(symbol, exchange);
  if (!ticker) return { bars: [], error: `${exchange} is not supported` };

  if (!from || !to || from > to) return { bars: [], error: "bad date range" };
  /* Anchored on today and reaching back past `from`, because that is the
     shape Yahoo serves — see the note in yahoo.js. Everything returned is
     kept; the caller trims to the window it asked for. */
  const range = rangeCovering(from);

  let lastErr = null;
  /* Both hosts, then both again after a wait. The second pass is what turns a
     throttle into a delay instead of a failure. */
  const attempts = [...HOSTS, ...HOSTS];

  for (let i = 0; i < attempts.length; i++) {
    const host = attempts[i];
    if (i > 0) await sleep(i === HOSTS.length ? RETRY_AFTER_MS : HOST_GAP_MS);
    try {
      const url =
        `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}` +
        `?interval=1d&range=${range}`;
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
          /* NOT adjusted by f. The split factor divides prices because a
             hundred-rupee share became two fifty-rupee ones; the same event
             DOUBLES the share count, so applying a price factor to volume
             would move it the wrong way. Left as reported — the chart reads
             volume against its own recent average, where a consistent series
             matters more than an absolute one. */
          v: q.volume?.[i] == null ? null : Math.round(q.volume[i]),
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
