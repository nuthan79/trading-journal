import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok } from "./harness.mjs";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");
/* What a user can read: comments explain the removals and must not count. */
const visible = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * FIVE THINGS THAT PULLED ATTENTION FROM THE MAIN FIGURE, taken off on
 * 2026-09-18 at the user's request. Each would be easy to put back without
 * noticing it had been taken off deliberately.
 */

test("Trades: no ▲ for a tagged mistake", () => {
  const s = visible("components/journal/Trades.jsx");
  ok(!/▲/.test(s), "it read as a warning on nearly every closed row");
});

test("Performance: the caption above the table is one line", () => {
  const s = visible("components/journal/PeriodPerformance.jsx");
  const cap = s.slice(s.indexOf('<div className="pp-sub">'), s.indexOf("</div>", s.indexOf('<div className="pp-sub">')));
  ok(!/Hover any rupee figure/.test(cap) && !/April to March/.test(cap));
  ok(/appears in both/.test(cap), "keeps the one thing the buttons cannot say");
});

test("Performance: average risk is one figure, its percentage in the hover", () => {
  const s = visible("components/journal/PeriodPerformance.jsx");
  ok(!/pp-dim"> · \{pct\(r\.avgRiskPct/.test(s));
  ok(/of capital/.test(s), "the percentage is still there, on hover");
});

test("Performance: the summary rows carry no extra sentence", () => {
  const s = visible("components/journal/PeriodPerformance.jsx");
  ok(!/periods green/.test(s) && !/with trades/.test(s));
});

test("Holdings: the dial explains itself on hover, and only warns in words", () => {
  const s = visible("components/journal/Holdings.jsx");
  ok(!/<div className="ps-riskfig-note">\s*\{RISK_WARN_R\}R is a warning line/.test(s), "the note under the figure");
  ok(/title=\{blind \? undefined/.test(s), "the level sentence is the dial's hover");
  ok(/\{blind && <div className="ps-dial-note">Nothing to measure yet/.test(s),
    "no stops recorded is a real warning and stays visible");
});

/* ---- Analysis, 2026-09-18 ------------------------------------------ */

test("What works: its cells follow the header's column list, in order", () => {
  const s = read("components/journal/Edge.jsx");
  const list = [...s.match(/const EDGE_COLUMNS = \[([\s\S]*?)\];/)[1].matchAll(/k: "([^"]+)"/g)].map((m) => m[1]);
  const body = s.slice(s.indexOf("<tbody>"), s.indexOf("</tbody>"));
  const cells = [...body.matchAll(/show\("([^"]+)"\)/g)].map((m) => m[1]);
  ok(cells.join(",") === list.join(","), `cells ${cells.join(",")} vs header ${list.join(",")}`);
  ok(/EDGE_COLUMNS\.filter\(\(c\) => show\(c\.k\)\)\.map/.test(s), "the header is built from the same list");
});

test("What works: five columns by default, expectancy among them", () => {
  const s = read("components/journal/Edge.jsx");
  const hidden = s.match(/const EDGE_HIDDEN = \[([^\]]*)\]/)[1];
  for (const k of ["trades", "winRate", "expectancy", "totalR", "netPnl"]) {
    ok(!hidden.includes(`"${k}"`), `${k} must show by default`);
  }
  ok((hidden.match(/"/g) || []).length / 2 === 5, "five start hidden");
});

test("Process: each card shows one line; detail and 'What it means' are one click down", () => {
  const s = read("components/journal/Review.jsx");
  const card = s.slice(s.indexOf("function FindingCard"), s.indexOf("\n}\n", s.indexOf("function FindingCard")));
  const open = card.slice(0, card.indexOf('<details className="rv-evidence">'));
  const folded = card.slice(card.indexOf('<details className="rv-evidence">'));
  ok(!/<p className="rv-verdict"/.test(open) && /<p className="rv-verdict"/.test(folded), "the verdict box is inside");
  ok(/moreDetail && <p className="rv-detail">/.test(folded), "the detail paragraph is inside");
  ok(/const oneLine = rich \? \(f\.lede \|\| f\.verdict\) : f\.detail;/.test(card));
});

test("Process: Watch and Good fold unless nothing is critical or a warning", () => {
  const s = read("components/journal/Review.jsx");
  ok(/opened\[k\] \?\? \(k === "critical" \|\| k === "warning" \|\| \(!urgent && k === "watch"\)\)/.test(s));
  ok(/\{groupOpen\(sevKey\) && groups\[sevKey\]\.map/.test(s), "cards render only in an open group");
});

test("Process: one-line intro, and the method column is a hover", () => {
  const s = visible("components/journal/Review.jsx");
  ok(!/the only baseline available would be a better trader/.test(s), "the five-sentence intro is gone");
  ok(!/<th>What it rests on<\/th>/.test(s), "no fourth column of method");
  ok(/<th scope="row" title=\{s\.findingTitle/.test(s), "it lives on the stage's hover");
  ok(/rv-proc-thin" title=\{`Only \$\{s\.sample\} trades`\}> provisional/.test(s),
    "a thin sample is still flagged in sight");
});

test("Mindset: the method sits in hovers, not under the gauges", () => {
  const s = visible("components/journal/Mindset.jsx");
  ok(!/className="ms-gbasis"/.test(s), "no basis line under each gauge");
  ok(/<div className="ms-gauge" title=\{a\.basis/.test(s));
  ok(!/<p className="ms-note"[^>]*>\s*Each is a percentage of trades meeting a stated test/.test(s),
    "no method paragraph under the gauges");
});

test("What works: the rupee-risk caveat is one line with the fix a click away", () => {
  const s = visible("components/journal/Edge.jsx");
  ok(!/₹15k against ₹20L/.test(s));
  ok(/onClick=\{\(\) => setDim\("risk"\)\}>Risk % of capital</.test(s));
});
