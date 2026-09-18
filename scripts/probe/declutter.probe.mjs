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
