import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq, near } from "./harness.mjs";
import { indexSnapshot, STRIP_INDICES, INDEX_TICKERS } from "@/lib/market";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/* 250 days: flat at 100 for 230, then ten at 110, then ten at 90 — so the
   averages can be worked out by hand. */
const hist = [
  ...Array.from({ length: 230 }, (_, i) => 100),
  ...Array.from({ length: 10 }, () => 110),
  ...Array.from({ length: 10 }, () => 90),
].map((close, i) => ({ date: `D${String(i).padStart(3, "0")}`, close }));

test("distance from each average, as a percentage of the average", () => {
  const s = indexSnapshot(hist);
  eq(s.last, 90);
  near(s.vs20, (90 - 100) / 100 * 100, 1e-9, "20-day: ten at 110 and ten at 90 average 100");
  near(s.vs50, (90 - 100) / 100 * 100, 1e-9, "50-day: 30 at 100, 10 at 110, 10 at 90 average 100");
  near(s.vs200, (90 - 100) / 100 * 100, 1e-9, "200-day: likewise 100");
  near(s.dayPct, 0, 1e-9, "flat on the day");
  eq(s.regime, "pressure", "below a 50-day that equals the 200-day is not a confirmed correction");
});

test("the day's change is against the candle before", () => {
  const s = indexSnapshot([...hist.slice(0, -1), { date: "D999", close: 99 }]);
  near(s.dayPct, (99 - 90) / 90 * 100, 1e-9);
});

test("a short history gives what it can, not a wrong long average", () => {
  const s = indexSnapshot(hist.slice(-30));
  ok(s.vs20 != null, "twenty days make a 20-day average");
  eq(s.vs200, null, "thirty days do not make a 200-day one");
  eq(indexSnapshot([]), null);
});

test("each book reads its own market, and every index has a ticker", () => {
  eq(STRIP_INDICES.IN.map(([k]) => k).join(), "NIFTY50,NIFTY500,NIFTYMID150,NIFTYSML250");
  eq(STRIP_INDICES.US.map(([k]) => k).join(), "SP500,NASDAQ100,RUSSELL2000");
  for (const [k] of [...STRIP_INDICES.IN, ...STRIP_INDICES.US]) ok(INDEX_TICKERS[k], `${k} has a ticker`);
});

test("the strip sits between the header and the nav, for the open book", () => {
  const layout = read("app/(app)/layout.jsx");
  const strip = layout.indexOf("<MarketStrip book={bookRegion} />");
  ok(strip > layout.indexOf("part-sold") && strip < layout.indexOf('<div className="tabs">'),
     "after the journal's name and counts, before the tabs");
  /* End to end: its own row in the bar, outside the header's two columns —
     the first version ran only in the gap beside the buttons. */
  const strip2 = layout.indexOf("<MarketStrip book={bookRegion} />");
  const header = layout.slice(layout.indexOf('<div className="topbar">'), strip2);
  ok(/AccountMenu[\s\S]*<\/div>\s*<\/div>\s*\{\/\*[\s\S]*\*\/\}\s*$/.test(header),
     "after the header row has closed, so it runs the full width");
  ok(/<MarketStrip book=\{bookRegion\} \/>\s*<div className="topin topin-tabs">/.test(layout), "and the tabs follow on their own row");
  const c = read("components/MarketStrip.jsx");
  ok(/<style jsx global>/.test(c) && /\.ms-i \{[^}]*padding: 0 (\d+)px/.test(c),
     "item styles are global — scoped ones never reached the items, which ran together");
  /* 56px was too much, 36px still a bit much; the user chose 25px. (The
     first ticker's run-together look was missing styles, not a small gap.) */
  const gap = Number(c.match(/\.ms-i \{[^}]*padding: 0 (\d+)px/)[1]);
  ok(gap === 25, `25px each side of the divider, as the user set it — got ${gap}px`);
});

test("one request for every index, cached as long as the strip waits", () => {
  const route = read("app/api/indices/route.js");
  ok(/s-maxage=300/.test(route), "five minutes at the edge");
  ok(/return \{ key, name, error: err\.message \}/.test(route), "one index failing does not fail the strip");
  const c = read("components/MarketStrip.jsx");
  ok(/const REFRESH_MS = 5 \* 60 \* 1000;/.test(c), "and the strip asks no more often than that");
  ok(/document\.hidden\) return;/.test(c), "nor while the tab is in the background");
});

/*
 * A TICKER, AT THE USER'S CALL — asked for twice. It must stop for a reader,
 * stay still for anyone who asks for less motion, and loop without a seam.
 */
test("the ticker pauses on hover, respects reduced motion, and loops cleanly", () => {
  const c = read("components/MarketStrip.jsx");
  ok(/\.ms:hover \.ms-track \{ animation-play-state: paused; \}/.test(c), "stops under the pointer");
  ok(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\.ms \{ overflow-x: auto;[^}]*\}\s*\.ms-track \{ animation: none; \}/.test(c),
     "and holds still, scrollable by hand, for reduced motion");
  ok(/to \{ transform: translateX\(-50%\); \}/.test(c) && /\{row\(0\)\}\s*<div className="ms-copy" aria-hidden="true">\{row\(1\)\}<\/div>/.test(c),
     "two copies, moved by exactly one, the second hidden from screen readers");
  ok(/setSecs\(Math\.max\(20, w \/ SPEED_PX\)\)/.test(c), "speed set by distance, so it reads at one pace");
});
