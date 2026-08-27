import { readFileSync } from "node:fs";
import { test, eq, ok } from "./harness.mjs";
import { tickerFor, fetchBars } from "@/lib/bars";
import { rangeCovering, BROWSER_HEADERS, YAHOO_HOSTS } from "@/lib/yahoo";

/**
 * THE CHECK THAT WOULD HAVE SAVED THE DAY THIS COST.
 *
 * Three files talked to Yahoo, each with its own copy of the hosts and
 * headers. Two matched. The third sent a different User-Agent and a different
 * Accept, and every one of its requests came back 429 while the other two
 * worked from the same server in the same minute — a fingerprint, not a rate
 * limit, and invisible because the copies looked close enough to be the same.
 *
 * Read off the source rather than the exports, because the failure mode is
 * somebody reintroducing a local copy, which no import-level assertion sees.
 */
const SRC = (f) => readFileSync(new URL(`../../src/lib/${f}`, import.meta.url), "utf8");

test("only yahoo.js defines the request fingerprint", () => {
  for (const f of ["quotes.js", "market.js", "bars.js"]) {
    const body = SRC(f).replace(/\/\*[\s\S]*?\*\//g, "");   // comments may discuss it
    ok(!/User-Agent"?\s*:/.test(body), `${f} must import the headers, not declare them`);
    ok(!/query1\.finance\.yahoo\.com/.test(body), `${f} must import the hosts, not list them`);
  }
});

test("every caller asks with range=, never period1/period2", () => {
  /* The other half of what was being refused. Both callers that worked used
     a relative range; the one that did not was the one getting 429s. */
  for (const f of ["quotes.js", "market.js", "bars.js"]) {
    ok(!/period1=/.test(SRC(f)), `${f} must not build a period1/period2 chart URL`);
  }
});

test("the headers are the shape known to be served", () => {
  eq(BROWSER_HEADERS["Accept"], "*/*");
  ok(/Windows NT/.test(BROWSER_HEADERS["User-Agent"]), "the UA that works");
  ok(BROWSER_HEADERS["Accept-Language"], "present on the callers that are served");
  eq(YAHOO_HOSTS.length, 2);
});

/* ---- tickers ----------------------------------------------------------- */

test("BSE resolves through its ticker; a scrip code never does", () => {
  eq(tickerFor("RELIANCE", "NSE"), "RELIANCE.NS");
  eq(tickerFor("20MICRONS", "BSE"), "20MICRONS.BO");
  eq(tickerFor("533022", "BSE"), null, "533022.BO is a different security");
  eq(tickerFor("500325", "NSE"), null, "digits only, whatever the exchange");
  eq(tickerFor("", "BSE"), null);
  eq(tickerFor("ABC", "MCX"), null);
});

test("the range reaches back past the entry", () => {
  const now = new Date("2026-08-26").getTime();
  eq(rangeCovering("2026-08-22", now), "5d");
  eq(rangeCovering("2026-04-01", now), "6mo");
  eq(rangeCovering("2025-03-01", now), "2y");
  eq(rangeCovering("2019-01-01", now), "10y");
  eq(rangeCovering("2010-01-01", now), "max");
});

/* ---- corporate actions ------------------------------------------------- */

test("a split mid-hold does not fake a run", async () => {
  /* Bonuses are routine on NSE. Raw prices before a 1:2 sit at twice the
     scale of the entry they get compared against, so a stock that did
     nothing would land in the journal as a power trade. */
  const day = (s) => Math.floor(new Date(s).getTime() / 1000);
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ chart: { result: [{
      timestamp: ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"].map(day),
      indicators: {
        quote: [{ open: [198, 202, 100, 101], high: [205, 208, 104, 103],
                  low: [196, 199, 99, 98], close: [200, 204, 101, 102] }],
        adjclose: [{ adjclose: [100, 102, 101, 102] }],
      },
    }] } }),
  });
  const { bars } = await fetchBars({ symbol: "X", exchange: "NSE", from: "2026-06-01", to: "2026-06-04" });
  const closes = bars.map((b) => b.c);
  const ratio = Math.max(...closes) / Math.min(...closes);
  ok(ratio < 1.2, `the whole bar must restate to one scale, got a ${ratio.toFixed(2)}x jump`);
  ok(bars.every((b) => b.o < 110 && b.h < 110), "open and high adjust too, not just the close");
});
