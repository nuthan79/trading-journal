import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { isMarketOpen, CLOSE_GRACE_MIN } from "@/lib/regions";
import { LIVE_EVERY_MS } from "@/lib/liveMarks";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * LIVE PRICES ON HOLDINGS, ONLY WHILE THE MARKET IS OPEN.
 *
 * Asked of the market's own clock, so a browser in New York reading an Indian
 * book still knows NSE opens at 09:15 IST — which is why this file is worth
 * running under probe:tz. Instants are UTC on purpose.
 */
const at = (iso) => new Date(iso);

test("NSE: open 09:15 to 15:30 IST on a weekday, plus the grace for the close", () => {
  /* 23 Nov 2026 is a Monday. IST is UTC+5:30, no clock change. */
  eq(isMarketOpen("IN", at("2026-11-23T03:44:00Z")), false, "09:14 IST");
  eq(isMarketOpen("IN", at("2026-11-23T03:45:00Z")), true, "09:15 IST");
  eq(isMarketOpen("IN", at("2026-11-23T09:59:00Z")), true, "15:29 IST");
  eq(CLOSE_GRACE_MIN, 15);
  eq(isMarketOpen("IN", at("2026-11-23T10:14:00Z")), true, "15:44 IST, catching the close");
  eq(isMarketOpen("IN", at("2026-11-23T10:15:00Z")), false, "15:45 IST");
});

test("no session at the weekend, in the market's own day", () => {
  /* Friday 23:00 UTC is already Saturday 04:30 in India. */
  eq(isMarketOpen("IN", at("2026-11-28T05:00:00Z")), false, "Saturday 10:30 IST");
  eq(isMarketOpen("IN", at("2026-11-29T05:00:00Z")), false, "Sunday 10:30 IST");
  eq(isMarketOpen("US", at("2026-11-28T15:00:00Z")), false, "Saturday 10:00 ET");
});

test("US: 09:30 to 16:00 New York time, through the clock change", () => {
  /* November is EST (UTC−5); July is EDT (UTC−4). The same UTC instant
     is in the session in one and not the other. */
  eq(isMarketOpen("US", at("2026-11-23T14:30:00Z")), true, "09:30 EST");
  eq(isMarketOpen("US", at("2026-11-23T14:29:00Z")), false, "09:29 EST");
  eq(isMarketOpen("US", at("2026-07-15T13:30:00Z")), true, "09:30 EDT");
  eq(isMarketOpen("US", at("2026-07-15T13:29:00Z")), false, "09:29 EDT");
  eq(isMarketOpen("US", at("2026-11-23T21:14:00Z")), true, "16:14 EST");
  eq(isMarketOpen("US", at("2026-11-23T21:15:00Z")), false, "16:15 EST");
});

test("Holdings refreshes prices on a one-minute tick, every five minutes, only when it should", () => {
  eq(LIVE_EVERY_MS, 5 * 60 * 1000);
  const page = read("app/(app)/holdings/page.jsx");
  const live = page.slice(page.indexOf("LIVE PRICES WHILE THE MARKET IS OPEN"), page.indexOf("const refresh = async"));
  ok(live.length > 100, "found the live block");
  const calls = [...live.matchAll(/isMarketOpen\(([^)]*)\)/g)].map((m) => m[1]);
  ok(calls.length >= 2 && calls.every((c) => c === "bookRegion"),
     `every check asks the open book's market, not India's: ${calls.join(", ")}`);
  ok(/document\.visibilityState !== "visible"/.test(live), "nothing from a hidden tab");
  ok(/markedAgo\(\) < LIVE_EVERY_MS/.test(live), "five minutes since anything last asked");
  ok(/addEventListener\("visibilitychange", tick\)/.test(live), "coming back to the tab checks at once");
  ok(/clearInterval\(id\)/.test(live), "and stops when the page is left");
  ok(!/measurePaths|say\(/.test(live), "quotes only, and silent — the path stays on the button");
});

test("one clock for everything that asks for prices", () => {
  /* The layout marks positions as the app loads; without noting it, landing
     on Holdings straight after would ask again inside a minute. */
  ok(/noteMarked\(\);[^\n]*\n\s*markOpenPositions\(openNow\)/.test(read("app/(app)/layout.jsx")));
  const page = read("app/(app)/holdings/page.jsx");
  const btn = page.slice(page.indexOf("const refresh = async"));
  ok(/noteMarked\(\);\s*const \{ marked, error \} = await markOpenPositions\(open\)/.test(btn),
     "the button resets it too");
});

test("Holdings says it is updating, only while it is", () => {
  const h = read("components/journal/Holdings.jsx");
  ok(/\{live && rows\.length > 0 && <> · updating every 5 minutes while the market is open<\/>\}/.test(h));
  ok(/live=\{live\}/.test(read("app/(app)/holdings/page.jsx")));
});
