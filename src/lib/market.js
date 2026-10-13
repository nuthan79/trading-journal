import { YAHOO_HOSTS, BROWSER_HEADERS } from "./yahoo";
/**
 * Market context.
 *
 * A long-only breakout system is a leveraged bet on the index being in gear.
 * The single most useful thing this file produces is a per-day regime label,
 * which lets the review ask the question that matters: were you pressing when
 * the market was working, and standing aside when it wasn't?
 *
 * Regimes follow the trend-template logic your methodology already uses rather
 * than anything exotic:
 *
 *   uptrend    close > 50DMA and 50DMA > 200DMA   — press
 *   pressure   close < 50DMA but 50DMA > 200DMA   — tighten up, take fewer
 *   correction close < 50DMA and 50DMA < 200DMA   — mostly stand aside
 */

export const INDEX_TICKERS = {
  "NIFTY500": "^CRSLDX",
  "NIFTY50": "^NSEI",
  "NIFTYMIDCAP": "^NSEMDCP50",
  /* The two halves of the Nifty Midsmallcap 400 — 150 + 250. Yahoo serves
     the 400 itself with no history (one day), so no average can be taken
     of it; its halves come with a year and say more apart than together. */
  "NIFTYMID150": "NIFTYMIDCAP150.NS",
  "NIFTYSML250": "NIFTYSMLCAP250.NS",
  /* A US book's regime is the US market's, not India's. Same three states,
     read off the index the trades actually belong to. */
  "SP500": "^GSPC",
  "NASDAQ100": "^NDX",
  "RUSSELL2000": "^RUT",
};

/**
 * The indices on the market strip under the header, per book, in the order
 * they read: the headline index, the broad market, then the two sizes a
 * swing book actually trades. A US book reads its own market.
 */
export const STRIP_INDICES = {
  IN: [["NIFTY50", "Nifty 50"], ["NIFTY500", "Nifty 500"],
       ["NIFTYMID150", "Midcap 150"], ["NIFTYSML250", "Smallcap 250"]],
  US: [["SP500", "S&P 500"], ["NASDAQ100", "Nasdaq 100"], ["RUSSELL2000", "Russell 2000"]],
};

/** The index a book's regime is read from. */
export const REGIME_INDEX = { IN: "NIFTY500", US: "SP500" };
export const REGIME_LABEL_FOR = { NIFTY500: "NIFTY 500", SP500: "S&P 500" };

const HOSTS = YAHOO_HOSTS;


/** Daily closes for an index. Same unauthenticated endpoint as the quotes. */
export async function fetchIndexHistory(ticker = INDEX_TICKERS.NIFTY500, range = "3y") {
  let lastErr;
  for (const host of HOSTS) {
    try {
      const url =
        `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}` +
        `?interval=1d&range=${range}`;
      const res = await fetch(url, { headers: BROWSER_HEADERS, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const r = (await res.json())?.chart?.result?.[0];
      const stamps = r?.timestamp || [];
      const closes = r?.indicators?.quote?.[0]?.close || [];
      if (!stamps.length) throw new Error("no candles returned");

      const rows = [];
      for (let i = 0; i < stamps.length; i++) {
        const c = closes[i];
        if (c == null) continue;                    // holidays come back null
        rows.push({ date: new Date(stamps[i] * 1000).toISOString().slice(0, 10), close: c });
      }
      return rows;
    } catch (err) { lastErr = err; }
  }
  throw new Error(`${ticker}: ${lastErr?.message || "unavailable"}`);
}

function sma(values, period, i) {
  if (i < period - 1) return null;
  let s = 0;
  for (let k = i - period + 1; k <= i; k++) s += values[k];
  return s / period;
}

/** Attach moving averages and a regime label to each day. */
export function classifyRegime(history) {
  const closes = history.map((d) => d.close);
  return history.map((d, i) => {
    const ma50 = sma(closes, 50, i);
    const ma200 = sma(closes, 200, i);

    let regime = "unknown";
    if (ma50 != null && ma200 != null) {
      if (d.close > ma50 && ma50 > ma200) regime = "uptrend";
      else if (d.close < ma50 && ma50 < ma200) regime = "correction";
      else regime = "pressure";
    } else if (ma50 != null) {
      regime = d.close > ma50 ? "uptrend" : "pressure";
    }
    return { ...d, ma50, ma200, regime };
  });
}

/** Fast lookup: date string → regime. Falls back to the last known trading day. */
export function regimeIndex(classified) {
  const map = new Map(classified.map((d) => [d.date, d]));
  const dates = classified.map((d) => d.date);

  return {
    map,
    dates,
    /** Regime on a given date, or the most recent prior trading day. */
    at(dateStr) {
      if (map.has(dateStr)) return map.get(dateStr);
      let lo = 0, hi = dates.length - 1, best = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (dates[mid] <= dateStr) { best = dates[mid]; lo = mid + 1; }
        else hi = mid - 1;
      }
      return best ? map.get(best) : null;
    },
    /** How many trading days each regime covered in a window. */
    dayCounts(fromDate, toDate) {
      const out = { uptrend: 0, pressure: 0, correction: 0, unknown: 0 };
      for (const d of classified) {
        if (fromDate && d.date < fromDate) continue;
        if (toDate && d.date > toDate) continue;
        out[d.regime]++;
      }
      return out;
    },
  };
}

export const REGIME_LABEL = {
  uptrend: "Uptrend",
  pressure: "Under pressure",
  correction: "Correction",
  unknown: "Unclassified",
};

/**
 * One index as the strip shows it: the latest level, the day's change, how far
 * it stands from its 20-, 50- and 200-day averages, and its regime.
 *
 * The latest candle IS today while the market is open — Yahoo's daily series
 * carries the session in progress — so the averages include it, as every
 * charting site's do, and the day's change is against the candle before.
 * Distances are percentages of the average: −3.9% means 3.9% below it.
 */
export function indexSnapshot(history) {
  const rows = classifyRegime(history || []);
  const last = rows.at(-1);
  if (!last) return null;
  const closes = rows.map((d) => d.close);
  const ma20 = sma(closes, 20, closes.length - 1);
  const vs = (ma) => (ma ? ((last.close - ma) / ma) * 100 : null);
  const prev = rows.at(-2)?.close;
  return {
    date: last.date,
    last: last.close,
    dayPct: prev ? ((last.close - prev) / prev) * 100 : null,
    vs20: vs(ma20), vs50: vs(last.ma50), vs200: vs(last.ma200),
    regime: last.regime,
  };
}
