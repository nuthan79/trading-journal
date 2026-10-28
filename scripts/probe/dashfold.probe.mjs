import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq, near } from "./harness.mjs";
import { headline } from "@/lib/calc";
import { summaryParts } from "@/lib/dashboard";
import { derivePosition } from "@/lib/positions";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * THE PARAGRAPH AND THE TILE MUST PRINT ONE NET P&L.
 *
 * With the 21 tiles folded away, the summary paragraph became the Dashboard's
 * headline and took on the net P&L in rupees. It used to compute that from
 * finished positions only, while the tile counted every sell — including the
 * part of a position already banked. On a book with a part-sold holding those
 * are two different rupee totals, one above the other.
 */
const mk = (t) => ({ ...t, ...derivePosition(t, 5e6), status: t.status, exits: t.exits });

/* Sold 40 of 100 at 150: 2000 banked on a position still held. */
const PART = mk({ id: "part", symbol: "PART", side: "long", status: "partial",
  entry_date: "2026-06-01", entry_price: 100, quantity: 100,
  stop_loss: 90, stop_source: "recorded", charges: 0, last_price: 200,
  exits: [{ exit_date: "2026-09-10", quantity: 40, price: 150, charges: 0 }] });
const DONE = mk({ id: "done", symbol: "DONE", side: "long", status: "closed",
  entry_date: "2026-06-01", entry_price: 100, quantity: 100,
  stop_loss: 90, stop_source: "recorded", charges: 0,
  exit_date: "2026-09-12", exit_price: 130,
  exits: [{ exit_date: "2026-09-12", quantity: 100, price: 130, charges: 0 }] });

test("with a part-sold position, the paragraph and the tile agree on net P&L", () => {
  const opts = { openingCapital: 5e6, banking: [DONE, PART] };
  const tile = headline([DONE], opts).netPnl;
  const para = summaryParts([DONE], opts).netPnl;
  near(tile, 5000, 0.01, "the tile: both sells");
  near(para, tile, 0.01, "the paragraph must say the same rupees");
});

test("the verdict figures in the paragraph stay on finished positions", () => {
  /* Only the money widens. A part-sold position has not earned a vote on
     the win rate, exactly as on the tile. */
  const s = summaryParts([DONE], { openingCapital: 5e6, banking: [DONE, PART] });
  eq(s.trades, 1);
  eq(s.withR, 1);
});

test("with no banking list, nothing about the paragraph changes", () => {
  near(summaryParts([DONE], { openingCapital: 5e6 }).netPnl, 3000, 0.01);
});

test("the Dashboard hands the paragraph the same banking list as the tiles", () => {
  const dash = read("components/journal/Dashboard.jsx");
  ok(/<Summary closed=\{closed\} banking=\{banking\}/.test(dash));
  ok(/<HeadlineNumbers closed=\{closed\} banking=\{banking\}/.test(dash));
});

/* ---- the fold ------------------------------------------------------ */

test("the tiles are folded by default and the choice is remembered", () => {
  const src = read("components/journal/HeadlineNumbers.jsx");
  ok(/localStorage\.getItem\(OPEN_KEY\(\)\) === "1"; \} catch \{ return false; \}/.test(src),
    "closed unless the user opened it, and closed if storage is blocked");
  ok(/\{open && bands\.map/.test(src), "the bands render only when open");
});

test("the stop warnings stay visible with the tiles folded", () => {
  /* They qualify every R figure on the page, the paragraph's included, and
     each links to where it is fixed. */
  const src = read("components/journal/HeadlineNumbers.jsx");
  ok(/\{assumed > 0 && \(/.test(src), "the assumed-stop warning is not gated on open");
  ok(/\{h\.nNeedStop > 0 && \(/.test(src), "nor the missing-stop one");
  ok(!/\{open && assumed > 0/.test(src) && !/\{open && h\.nNeedStop/.test(src));
});

/* ---- Holdings: a key, not a manual --------------------------------- */

const holdings = () => read("components/journal/Holdings.jsx");
const keyBlock = () => {
  const s = holdings();
  const i = s.indexOf('<div className="ps-key">');
  return s.slice(i, s.indexOf("\n      </div>\n", i));
};

test("the Holdings key is short", () => {
  /* It was 323 words. Everything it said about columns now lives on the
     columns; only the marks are left to explain. */
  const words = keyBlock().replace(/<[^>]+>/g, " ").replace(/\{[^}]+\}/g, "N")
    .split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;
  ok(words < 80, `key is ${words} words`);
});

test("the key shows each of the four marks beside its meaning", () => {
  const k = keyBlock();
  ok(/className="ps-flag ps-key-mark"><Flag/.test(k), "the solid flag");
  ok(/className="ps-flag done ps-key-mark"><Flag/.test(k), "the hollow flag");
  ok(/<Rocket/.test(k), "the rocket");
  ok(/<CornerDownRight/.test(k), "the arrow");
});

test("the key takes its thresholds from the code, not from memory", () => {
  /* If FREE_AT_R moves from 1.5, a key that says "1.5R" in plain text is
     wrong the same day and nothing notices. */
  const k = keyBlock();
  ok(/\{FREE_AT_R\}R/.test(k) && /\{POWER_R\}R/.test(k) && /\{POWER_DAYS\}/.test(k));
  ok(!/\b1\.5R\b|\b3R\b/.test(k.replace(/\{[^}]+\}/g, "")), "no hard-coded threshold");
});

/**
 * THE HOLLOW FLAG'S HOVER SAID THE OPPOSITE OF WHAT HAPPENS.
 *
 * "Nothing changed here: the dial still counts the stop recorded in this
 * journal" — written before 336eced (2026-08-03), which made acknowledging
 * breakeven take the position off the dial. Found while condensing the key,
 * which was the text that had it right.
 */
test("an acknowledged flag's hover says it has left open risk", () => {
  const s = holdings();
  ok(!/the dial still counts the stop recorded/.test(s), "the stale claim is gone");
  ok(/no longer counts towards "\s*\+ "open risk or the dial/.test(s));
});

/**
 * EXPECTANCY MUST NOT READ AS A FINDING ON A SAMPLE THAT CANNOT CARRY ONE.
 *
 * A journal with one closed trade printed "Expectancy +16.72R per trade at a
 * 100.0% win rate" in the same accent typeface a book of 139 gets. It is the
 * first figure a new user sees and the one that decides whether they believe
 * the rest of the screen — arithmetically right, meaningless, and with nothing
 * on the line saying so.
 *
 * `rConfidence` is what the paragraph reads to mute the figure and add the
 * sentence. The bands match `provisional` in analysis.js on purpose: two
 * screens disagreeing about when a number has settled is how a user learns to
 * trust neither.
 */
const one = (id, r) => mk({
  id, symbol: id, side: "long", status: "closed",
  entry_date: "2026-06-01", exit_date: "2026-06-20",
  entry_price: 100, quantity: 100, stop_loss: 90,
  stop_source: "recorded", charges: 0,
  exits: [{ exit_date: "2026-06-20", quantity: 100, price: 100 + r * 10, charges: 0 }],
});
const book = (n) => Array.from({ length: n }, (_, i) => one(`t${i}`, 1));

test("one closed trade is thin, and the paragraph is told so", () => {
  eq(summaryParts(book(1), { openingCapital: 5e6 }).rConfidence, "thin");
});

test("nine is still thin, ten is early, thirty has settled", () => {
  const band = (n) => summaryParts(book(n), { openingCapital: 5e6 }).rConfidence;
  eq(band(9), "thin", "a single trade still moves expectancy here");
  eq(band(10), "early");
  eq(band(29), "early");
  eq(band(30), "settled", "matches provisional in analysis.js");
});

test("confidence counts trades R can speak for, not every closed trade", () => {
  /* Twenty-nine with no stop and one with: expectancy rests on the one, and
     the band must say thin rather than reading the thirty rows as a sample. */
  const noStop = Array.from({ length: 29 }, (_, i) => mk({
    id: `n${i}`, symbol: `N${i}`, side: "long", status: "closed",
    entry_date: "2026-06-01", exit_date: "2026-06-20",
    entry_price: 100, quantity: 100, stop_loss: null, charges: 0,
    exits: [{ exit_date: "2026-06-20", quantity: 100, price: 110, charges: 0 }],
  }));
  const s = summaryParts([...noStop, one("real", 1)], { openingCapital: 5e6 });
  eq(s.withR, 1, "only one trade has an R");
  eq(s.rConfidence, "thin", "must band on withR, not on closed.length");
});

test("the paragraph mutes a thin figure and says why", () => {
  const src = read("components/journal/Summary.jsx");
  ok(/rConfidence === "thin"[\s\S]{0,120}muted/.test(src),
     "a thin sample must drop the accent tone");
  ok(src.includes("not yet\n            a reading on your trading")
     || /not yet[\s\S]{0,40}a reading on your trading/.test(src),
     "and must say so in words, not only in colour");
  ok(/\.sum-fig\.muted\s*\{/.test(src), "the muted tone needs a style");
});

/**
 * THE RAIL: WHAT SHAPE THE RECORD WAS, NEVER WHAT IT CAME TO TWICE.
 *
 * The paragraph caps at 92ch and the card is full width, so a 1440px layout
 * left ~470px of bordered nothing beside it. Six figures fill it — the ones
 * the paragraph does not name. The rule that keeps this from becoming the
 * duplication the fold removed is that no rail label repeats a paragraph
 * figure, and it is the rule a seventh tile will break.
 */
const summarySrc = () => read("components/journal/Summary.jsx");
const railBlock = () => {
  const s = summarySrc();
  const i = s.indexOf('<aside className="sum-rail"');
  ok(i > 0, "the rail is rendered");
  return s.slice(i, s.indexOf("</aside>", i));
};
const railLabels = () => [...railBlock().matchAll(/<RailTile\s+label="([^"]+)"/g)].map((m) => m[1]);
const SIX = ["Risk per trade", "Profit factor", "Payoff ratio", "Avg hold", "Avg gain", "Avg loss"];

test("Summary takes the rail's figures from headline(), the sheet's own source", () => {
  ok(/import \{ headline \} from "@\/lib\/calc";/.test(summarySrc()));
  ok(/headline\(closed, \{ openingCapital, flows, banking \}\)/.test(summarySrc()),
     "the same call over the same inputs as HeadlineNumbers");
});

test("the rail carries the six, in order, Risk per trade first", () => {
  eq(railLabels().join(" | "), SIX.join(" | "));
});

test("no rail label repeats a figure the paragraph or the chart already prints", () => {
  const banned = ["Total R", "Net P&L", "Max DD", "Green months", "Green quarters",
                  "Best trade", "Worst trade", "Expectancy", "Win rate", "Worst run"];
  const labels = railLabels();
  ok(labels.length > 0, "found the labels at all");
  for (const b of banned) {
    ok(!labels.some((l) => l.toLowerCase().startsWith(b.toLowerCase())), `"${b}" is in the rail`);
  }
});

test("Risk per trade carries the sheet's hover, both branches, word for word", () => {
  const hn = read("components/journal/HeadlineNumbers.jsx");
  const r = railBlock();
  for (const line of [
    "1R has grown with the account, so a +2R early on and a +2R lately ",
    "are different amounts of money — total R adds them as though they ",
    "The average money put at risk on a trade. Your sizing is consistent, ",
    "so 1R means much the same throughout your record.",
  ]) {
    ok(hn.includes(line), `sheet still says: ${line}`);
    ok(r.includes(line), `rail says: ${line}`);
  }
  ok(/hint=\{h\.riskVaries/.test(r), "the hover changes with h.riskVaries");
});

test("the rail is gated on rules the file already has, not a new bar", () => {
  const s = summarySrc();
  ok(/const showRail = s\.hasR && s\.rConfidence !== "thin";/.test(s));
  ok(/\{showRail && \(\s*<aside className="sum-rail"/.test(s), "the aside sits under that gate");
  const code = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok(!/\b10\b/.test(code), "no bare 10 in the component — thin is dashboard.js's to decide");
});

test("a wide screen gets a min-width query; the measure stays 92ch", () => {
  const s = summarySrc();
  ok(/@media \(min-width: 1280px\)\s*\{\s*\.sum-card\.has-rail\s*\{[^}]*display: grid/.test(s),
     "the card goes two-column above 1280px");
  ok(/\.sum-body\s*\{[^}]*max-width: 92ch;/.test(s.replace(/\/\*[\s\S]*?\*\//g, "")),
     "the paragraph keeps its own cap");
  ok(/\.sum-rail\s*\{[^}]*border-top: 1px solid var\(--rule\)/.test(s),
     "below it, the rail stacks under a top rule rather than vanishing");
});

const gate = (s) => s.hasR && s.rConfidence !== "thin";

test("five trades with stops: thin, so no rail", () => {
  const s = summaryParts(book(5), { openingCapital: 5e6 });
  eq(s.hasR, true);
  eq(s.rConfidence, "thin");
  eq(gate(s), false);
});

test("no stops at all: hasR is false, so no rail", () => {
  const bare = Array.from({ length: 12 }, (_, i) => mk({
    id: `b${i}`, symbol: `B${i}`, side: "long", status: "closed",
    entry_date: "2026-06-01", exit_date: "2026-06-20",
    entry_price: 100, quantity: 100, stop_loss: null, charges: 0,
    exits: [{ exit_date: "2026-06-20", quantity: 100, price: i % 2 ? 110 : 95, charges: 0 }],
  }));
  const s = summaryParts(bare, { openingCapital: 5e6 });
  eq(s.hasR, false);
  eq(gate(s), false);
});

test("on a real-shaped book the rail's six are all finite, and it shows", () => {
  /* Winners and losers both, or payoff is ∞ and avg loss has nothing to
     average — a book that only ever wins is not the one this guards. */
  const mixed = Array.from({ length: 12 }, (_, i) => one(`m${i}`, i % 3 ? -1 : 2.5));
  const opts = { openingCapital: 5e6 };
  ok(gate(summaryParts(mixed, opts)), "twelve with stops is early, and early shows the rail");
  const h = headline(mixed, opts);
  for (const k of ["avgRisk", "profitFactor", "payoff", "avgHold", "avgGainPct", "avgLossPct"]) {
    ok(Number.isFinite(h[k]), `${k} is ${h[k]}`);
  }
});
