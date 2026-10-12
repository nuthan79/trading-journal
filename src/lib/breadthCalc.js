/**
 * Market breadth — how many stocks are taking part, counted ONE way.
 *
 * Pure, and shared on purpose. The nightly builder (scripts/build-breadth.mjs)
 * counts every close since 2018 through `countBreadth`; a live feed, when the
 * app has one, will hand the same function today's prices against the same
 * per-stock levels. One function means the live screen and the end-of-day one
 * can never count differently — and a probe pins that, given the closing
 * prices, the live path reproduces the stored figures exactly.
 *
 * WHAT IS COUNTED, per group:
 *   above the 20-, 50- and 200-day average of closes — the standard breadth
 *     measure, defined on closes because a stock can cross its average at
 *     11am and be back under it by 3:30;
 *   where the price sits in its 52-week range, in thirds — low, mid, high;
 *   advances, declines and unchanged against the previous close.
 * Each measure has its own denominator: a stock listed three months ago has
 * no 200-day average and is left out of that column rather than counted as
 * below it.
 *
 * THE GROUPS ARE THE APP'S OWN MARKET-CAP TIERS, from the AMFI list in force
 * on the day (lib/marketCap.js). "Top 750" is large + mid + small — the liquid
 * market, roughly what Nifty 500 measures, without its survivorship: today's
 * index members are today's winners, and reading 2019 through them would show
 * a breadth 2019 never had. Micro is kept apart because it is four thousand
 * names that would otherwise outvote everything else.
 */

export const BREADTH_GROUPS = ["top", "large", "mid", "small", "micro"];
export const GROUP_LABELS = {
  top: "Top 750", large: "Large cap", mid: "Mid cap", small: "Small cap", micro: "Micro cap",
};

/** Which groups a market-cap code ("1"–"4", see build-mcap) counts in. */
export const groupsOf = (code) =>
  code === "1" ? ["top", "large"] : code === "2" ? ["top", "mid"]
  : code === "3" ? ["top", "small"] : code === "4" ? ["micro"] : [];

const blank = () => ({
  n: 0, n20: 0, a20: 0, n50: 0, a50: 0, n200: 0, a200: 0,
  nz: 0, lo: 0, mid: 0, hi: 0, adv: 0, dec: 0, unch: 0,
});

const ok = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * Counts for every group.
 *
 * `stocks` are levels — `{ s, c, sma20, sma50, sma200, hi, lo, prev }`, any of
 * the averages and the range possibly missing — and `priceOf(stock)` is the
 * price to judge them at: the close, for the stored history; a live price,
 * later. A stock with no price is not counted anywhere.
 */
export function countBreadth(stocks, priceOf) {
  const out = Object.fromEntries(BREADTH_GROUPS.map((g) => [g, blank()]));
  for (const st of stocks || []) {
    const p = priceOf(st);
    if (!ok(p)) continue;
    for (const g of groupsOf(st.c)) {
      const t = out[g];
      t.n++;
      if (ok(st.prev)) {
        if (p > st.prev) t.adv++; else if (p < st.prev) t.dec++; else t.unch++;
      }
      if (ok(st.sma20)) { t.n20++; if (p > st.sma20) t.a20++; }
      if (ok(st.sma50)) { t.n50++; if (p > st.sma50) t.a50++; }
      if (ok(st.sma200)) { t.n200++; if (p > st.sma200) t.a200++; }
      if (ok(st.hi) && ok(st.lo) && st.hi > st.lo) {
        t.nz++;
        const pos = (p - st.lo) / (st.hi - st.lo);       // past either end counts as that end
        if (pos < 1 / 3) t.lo++; else if (pos > 2 / 3) t.hi++; else t.mid++;
      }
    }
  }
  return out;
}

/** A share as a percentage, one decimal; null when there is nothing to share. */
export const share = (a, n) => (n > 0 ? Math.round((a / n) * 1000) / 10 : null);

/* ------------------------------------------------------------------ */
/*  Breadth at entry                                                   */
/* ------------------------------------------------------------------ */

/**
 * Bands for "Breadth at entry" on What works — the share of the Top 750 above
 * their 50-day average. Fixed, not adaptive: 40% and 60% are where traders
 * already draw the line between a market that is falling apart, one that is
 * mixed, and one that is broadly rising, and a regime is only a regime if the
 * line does not move with the book being read.
 */
export const BREADTH_BANDS = ["Under 40%", "40–60%", "Over 60%"];
export const bandOf = (pct) =>
  typeof pct !== "number" || !Number.isFinite(pct) ? ""
  : pct < 40 ? BREADTH_BANDS[0] : pct <= 60 ? BREADTH_BANDS[1] : BREADTH_BANDS[2];

/**
 * The breadth a trader could have known when they bought: the last close
 * BEFORE the entry date. The entry day's own close happens after the trade,
 * and using it would let the result leak into the cause.
 *
 * `days` is `[[YYYY-MM-DD, pct], ...]` oldest first; dates compare as strings.
 */
export function breadthBefore(days, date) {
  if (!Array.isArray(days) || !days.length || !date) return null;
  const d = String(date).slice(0, 10);
  let lo = 0, hi = days.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid][0] < d) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (found < 0) return null;
  /* A week is the longest honest gap — a long weekend plus a holiday or two.
     Beyond it the file has not been refreshed, and last week's breadth would
     be filed under this week's trade without anything on screen saying so. */
  if (daysBetween(days[found][0], d) > 7) return null;
  return { date: days[found][0], pct: days[found][1] };
}

/* Calendar days between two stored dates, parsed by hand — `new Date(str)`
   reads a bare date as UTC midnight. */
const dayNumber = (s) => {
  const [y, m, dd] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, dd) / 86400000;
};
const daysBetween = (a, b) => dayNumber(b) - dayNumber(a);
