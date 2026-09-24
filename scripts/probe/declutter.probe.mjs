import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { SHOW_EXIT_METHOD_CARD } from "@/lib/flags";

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



test("Process: each card shows one line; detail and 'What it means' are one click down", () => {
  const s = read("components/journal/Review.jsx");
  const card = s.slice(s.indexOf("function FindingCard"), s.indexOf("\n}\n", s.indexOf("function FindingCard")));
  const open = card.slice(0, card.indexOf('<details className="rv-evidence">'));
  const folded = card.slice(card.indexOf('<details className="rv-evidence">'));
  ok(!/<p className="rv-verdict"/.test(open) && /<p className="rv-verdict"/.test(folded), "the verdict box is inside");
  ok(/moreDetail && <p className="rv-detail">/.test(folded), "the detail paragraph is inside");
  /* The line under the title is the CONCLUSION. It used to be the lede, which
     explains how the chart was built — read before the chart, by somebody who
     has not seen what it says yet. The method moved down with the workings. */
  ok(/const oneLine = rich \? \(f\.verdict \|\| f\.lede\) : f\.detail;/.test(card),
     "the card leads with the method again instead of the finding");
  ok(/How this is measured/.test(folded), "and the method must still be reachable");
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

test("What works: no Columns picker — all ten columns, cells in header order", () => {
  /* A picker was added here and taken out at the user's request: this table
     is read whole. The header is built from EDGE_COLUMNS, so the cells must
     follow that list or a figure lands under the wrong heading. */
  const s = read("components/journal/Edge.jsx");
  ok(!/ColumnPicker|useColumnPrefs/.test(s), "no picker");
  const list = [...s.match(/const EDGE_COLUMNS = \[([\s\S]*?)\];/)[1].matchAll(/k: "([^"]+)"/g)].map((m) => m[1]);
  ok(list.length === 10, `ten columns, found ${list.length}`);
  const body = s.slice(s.indexOf("<tbody>"), s.indexOf("</tbody>"));
  /* Each data cell reads its own field; their order must be the list's. */
  const FIELD = { trades: "g.n}", winRate: "g.winRate", avgWin: "g.avgWin", avgLoss: "g.avgLoss",
    expectancy: "g.expectancy)}", totalR: "g.totalR, 1", netPnl: "v={g.netPnl}",
    avgValue: "g.avgValue", avgRisk: "v={g.avgRisk}", returnOnRisk: "g.returnOnRisk.toFixed" };
  const at = list.map((k) => body.indexOf(FIELD[k]));
  ok(at.every((x) => x > 0), "every column has its cell");
  ok(at.every((x, i) => i === 0 || x > at[i - 1]), "and in the header's order");
});

/**
 * A CARD MUST NOT SHOW A SIBLING'S NUMBERS.
 *
 * One builder usually produces several findings from one pass, and they were
 * handed the same evidence object — so the sizing card listed "Risk after a
 * loss" and "Trades after a loss", which belong to the revenge-sizing finding,
 * and a reader could not reconcile the card against its own table.
 */
test("findings from one builder own their own numbers", () => {
  const src = read("lib/analysis.js");
  ok(/const \{ only, \.\.\.rest \} = extra;/.test(src), "F() no longer filters the evidence");
  ok(/only\.includes\(k\)/.test(src), "and the filter must be by the keys a finding names");
  /* The three cards that shared one table, each naming its own half. */
  ok(/only: EV_REVENGE/.test(src) && (src.match(/only: EV_SIZING/g) || []).length === 2,
     "the sizing family is sharing one evidence table again");
  /* Declared before the first card that names them — a TDZ here throws at
     render and takes the whole Process tab with it. */
  ok(src.indexOf("const EV_REVENGE") < src.indexOf("only: EV_REVENGE"),
     "the key lists are declared after the findings that use them");
});

test("no card body runs past a readable length", () => {
  /* Comments stripped first: a card with a note between its title and its
     text did not match at all, so this passed while skipping the very card it
     was written for. */
  const src = read("lib/analysis.js").replace(/\/\*[\s\S]*?\*\//g, "");
  const pat = /F\(\s*"(\w+)"\s*,\s*"([\w-]+)"\s*,\s*\n?\s*(?:`[^`]*`|"[^"]*")\s*,\s*\n?\s*((?:`[^`]*`|"[^"]*")(?:\s*\+\s*(?:`[^`]*`|"[^"]*"))*)/gs;
  const over = [];
  for (const m of src.matchAll(pat)) {
    const body = m[3].replace(/\s*\+\s*/g, "").replace(/[`"]/g, "")
      .replace(/\$\{[^}]*\}/g, "N").replace(/\s+/g, " ").trim();
    if (body.length > 420) over.push(`${m[2]} (${body.length})`);
  }
  ok(over.length === 0, `these card bodies are paragraphs again: ${over.join(", ")}`);
});


/**
 * The exits card is held back, not deleted. Grouping outcomes by the reason
 * recorded for the exit groups outcomes by the outcome: "sold into strength"
 * is recorded BECAUSE it worked and "stop hit" BECAUSE it did not, so the
 * 5.53R spread it reported could not have come out any other way.
 */
test("the exits card stays off until its reasons are alternatives", () => {
  eq(SHOW_EXIT_METHOD_CARD, false, "it reports a definition, not a finding");
  ok(/if \(!SHOW_EXIT_METHOD_CARD\) return null;/.test(read("lib/analysis.js")),
     "the builder must not run while the flag is off");
});
