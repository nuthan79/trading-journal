import { test, eq, ok, near } from "./harness.mjs";
import { istDate, sessionFor, shouldRun, buildRun, describeRun,
         MARKET_CLOSE_MIN } from "@/lib/screens/run.js";

/**
 * A SCREEN THAT LIES QUIETLY IS WORSE THAN NO SCREEN.
 *
 * Every failure here renders as an empty list: a scan that has not run, one
 * that failed, one that ran on a holiday, and one that genuinely found
 * nothing. Only the last is a finding, and it is the one a trader acts on —
 * "the market is offering nothing today, sit out". The other three say
 * nothing at all and must never be able to impersonate it.
 *
 * These run under two timezones in CI, which is the point: a scheduled job
 * runs on a server whose clock is nobody's choice, and the one thing that
 * must not vary is which Indian session a run belongs to.
 */

/* An instant, given as IST wall-clock, expressed as the UTC it really is. */
const ist = (y, m, d, hh, mm) =>
  new Date(Date.UTC(y, m - 1, d, hh, mm) - 330 * 60000);

const EOD = { slug: "volume-dryup", cadence: "eod", active: true, clause: "x" };
const INTRA = { slug: "bullsnort", cadence: "intraday", active: true, clause: "x" };

test("the session is the Indian trading day, whatever the server thinks", () => {
  /*
    16:15 IST on 8 September is 10:45 UTC the same date — but 00:30 IST is
    19:00 UTC the day BEFORE, and a naive server date would file it under
    yesterday. Both are stated as IST here and must come back as IST.
  */
  eq(istDate(ist(2026, 9, 8, 16, 15)), "2026-09-08");
  eq(istDate(ist(2026, 9, 8, 0, 30)), "2026-09-08", "half past midnight IST is still the 8th");
  eq(istDate(ist(2026, 9, 8, 23, 59)), "2026-09-08");
  eq(istDate(ist(2026, 1, 1, 5, 0)), "2026-01-01", "and across a year boundary");
});

test("weekends and holidays are not trading days", () => {
  /* 2026-09-12 is a Saturday, 2026-09-13 a Sunday. */
  eq(sessionFor(ist(2026, 9, 12, 16, 15)).tradable, false);
  eq(sessionFor(ist(2026, 9, 12, 16, 15)).reason, "weekend");
  eq(sessionFor(ist(2026, 9, 13, 16, 15)).reason, "weekend");

  const s = sessionFor(ist(2026, 9, 8, 16, 15), { holidays: ["2026-09-08"] });
  eq(s.tradable, false);
  eq(s.reason, "holiday");
});

test("an end-of-day scan refuses to run mid-session", () => {
  /*
    Run at noon it would store half a day as the day's result, be overwritten
    at 16:15, and anybody who looked in between would have read a partial
    session as final.
  */
  const noon = shouldRun(EOD, ist(2026, 9, 8, 12, 0));
  eq(noon.run, false);
  ok(/not closed|has not closed/.test(noon.reason), noon.reason);

  eq(shouldRun(EOD, ist(2026, 9, 8, 15, 30)).run, true, "at the bell it may run");
  eq(shouldRun(EOD, ist(2026, 9, 8, 16, 15)).run, true);
});

test("an intraday scan runs only while the market is open", () => {
  eq(shouldRun(INTRA, ist(2026, 9, 8, 9, 0)).run, false, "before the open");
  eq(shouldRun(INTRA, ist(2026, 9, 8, 9, 15)).run, true, "at the open");
  eq(shouldRun(INTRA, ist(2026, 9, 8, 12, 0)).run, true);
  eq(shouldRun(INTRA, ist(2026, 9, 8, 15, 30)).run, true, "at the close");
  eq(shouldRun(INTRA, ist(2026, 9, 8, 16, 15)).run, false, "after it");
});

test("a screen with no clause never runs, forced or not", () => {
  /*
    The clauses live in the database and not in this repository, so a fresh
    install has three screens and no scans. Running one would post an empty
    query and store whatever came back as the day's result.
  */
  const bare = { ...EOD, clause: null };
  eq(shouldRun(bare, ist(2026, 9, 8, 16, 15)).run, false);
  eq(shouldRun(bare, ist(2026, 9, 8, 16, 15), { force: true }).run, false,
    "force is for odd hours, not for missing definitions");
});

test("an inactive screen is skipped, and force is the only way past", () => {
  const off = { ...EOD, active: false };
  eq(shouldRun(off, ist(2026, 9, 8, 16, 15)).run, false);
  const forced = shouldRun(off, ist(2026, 9, 8, 16, 15), { force: true });
  eq(forced.run, true);
  eq(forced.forced, true, "and the run records that it was forced");
});

test("nothing matched is a RESULT, and says so in its own word", () => {
  /*
    THE DISTINCTION THE FEATURE RESTS ON. All four of these render as an
    empty list. Only "empty" means the market offered nothing.
  */
  const empty = buildRun({ slug: "s", as_of: "2026-09-08", rows: [] });
  eq(empty.run.status, "empty");
  eq(empty.run.count, 0);
  eq(empty.run.error, null);

  const failed = buildRun({ slug: "s", as_of: "2026-09-08", rows: [], error: "502 from source" });
  eq(failed.run.status, "failed");
  ok(failed.run.error.includes("502"), "and carries why");
  eq(failed.results.length, 0);

  ok(empty.run.status !== failed.run.status,
    "a scan that found nothing and one that never looked are not the same row");
});

test("results keep the order the scan gave them", () => {
  const { run, results } = buildRun({ slug: "s", as_of: "2026-09-08", rows: [
    { symbol: "eris", close: "1,283.20", volume: "1,20,000", chgPct: "-2.5%" },
    { symbol: "SRF", close: 2779.05 },
  ] });
  eq(run.status, "ok");
  eq(run.count, 2);
  eq(results[0].symbol, "ERIS", "upper-cased");
  eq(results[0].rank, 1);
  eq(results[1].rank, 2);
  near(results[0].close, 1283.2, 1e-9, "commas stripped");
  near(results[0].volume, 120000, 1e-9);
  near(results[0].chgPct ?? results[0].chg_pct, -2.5, 1e-9, "and the percent sign");
});

test("a symbol reported twice does not take the whole insert down", () => {
  /*
    (run_id, symbol, exchange) is the primary key, so a duplicate would be
    rejected by Postgres and fail the entire batch — turning a source's
    hiccup into a failed run with no results at all.
  */
  const { run, results } = buildRun({ slug: "s", as_of: "2026-09-08", rows: [
    { symbol: "ERIS" }, { symbol: "ERIS" }, { symbol: "eris" }, { symbol: "SRF" },
  ] });
  eq(run.count, 2);
  eq(results.map((r) => r.symbol).join(","), "ERIS,SRF");
});

test("columns the scan invents are kept, not dropped", () => {
  /* A screen that starts reporting something new should not silently lose it
     until somebody writes a migration. */
  const { results } = buildRun({ slug: "s", as_of: "2026-09-08", rows: [
    { symbol: "ERIS", close: 100, rsRank: 91, sector: "Pharma" },
  ] });
  eq(results[0].extra.rsRank, 91);
  eq(results[0].extra.sector, "Pharma");
  eq(results[0].extra.symbol, undefined, "but not the ones with their own columns");
});

test("BSE is honoured, anything else is NSE", () => {
  const { results } = buildRun({ slug: "s", as_of: "2026-09-08", rows: [
    { symbol: "A", exchange: "BSE" }, { symbol: "B", exchange: "nse" }, { symbol: "C" },
    { symbol: "D", exchange: "MCX" },
  ] });
  eq(results.map((r) => r.exchange).join(","), "BSE,NSE,NSE,NSE");
});

test("the screen describes its own freshness differently by cadence", () => {
  const now = ist(2026, 9, 8, 11, 30);
  const run = { status: "ok", count: 14, as_of: "2026-09-08",
                ran_at: ist(2026, 9, 8, 11, 15).toISOString() };

  const intra = describeRun(run, { cadence: "intraday", now });
  ok(/15 min ago/.test(intra.detail), `a stale intraday list must say so: ${intra.detail}`);

  const eod = describeRun(run, { cadence: "eod", now });
  ok(/close of 2026-09-08/.test(eod.detail), "an end-of-day list carries its session, not a clock");

  eq(describeRun(null).tone, "none");
  eq(describeRun({ status: "empty", as_of: "2026-09-08" }).tone, "empty");
  eq(describeRun({ status: "failed", as_of: "2026-09-08", error: "timeout" }).tone, "failed");
});
