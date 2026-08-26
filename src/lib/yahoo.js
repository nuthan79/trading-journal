/**
 * The bits of talking to Yahoo that every caller has to get identical.
 *
 * WHY THIS FILE EXISTS. `quotes.js`, `market.js` and `bars.js` each carried
 * their own copy of the hosts and headers. Two of them matched; the third —
 * written last, from memory — sent a different User-Agent and a different
 * Accept, and every one of its requests came back 429 while the other two
 * worked from the same server in the same minute. Ten sequential quote
 * requests succeeded; twelve bar requests spaced twice as far apart did not.
 *
 * That is not a rate limit, it is a fingerprint, and it cost a day to find
 * because the three copies looked close enough to be the same.
 *
 * So there is one copy now. Nothing here is clever and nothing should be
 * tuned: it is a shape known to be served, and the value of it is that every
 * caller sends it byte for byte.
 */

/** query1 occasionally throttles where query2 does not, so callers try both. */
export const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

export const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://finance.yahoo.com",
};

/**
 * The relative window that covers a date, as `range=`.
 *
 * `period1`/`period2` describes a window exactly and is what a history
 * request obviously wants — and it is the other half of what was being
 * refused. Both callers that work ask with `range=`, so this one does too,
 * picking the shortest that reaches back far enough and discarding the rest.
 *
 * Overshooting costs nothing worth counting: the extra sessions are cached
 * with the ones that were asked for, so the next trade in the same symbol is
 * already covered and never goes upstream at all.
 */
const RANGES = [
  [7, "5d"], [25, "1mo"], [80, "3mo"], [170, "6mo"],
  [350, "1y"], [700, "2y"], [1800, "5y"], [3600, "10y"],
];

export function rangeCovering(fromIso, now = Date.now()) {
  const days = Math.ceil((now - new Date(fromIso).getTime()) / 86_400_000);
  if (!Number.isFinite(days)) return "max";
  for (const [limit, range] of RANGES) if (days <= limit) return range;
  return "max";
}
