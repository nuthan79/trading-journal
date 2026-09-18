import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok } from "./harness.mjs";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const panel = () => readFileSync(path.join(SRC, "components/journal/PositionDetail.jsx"), "utf8");

/**
 * THE TOP OF THE TRADE PANEL, REPORTED AS HARD TO READ.
 *
 * Three numbers competing in the headline, eight boxes alternating between
 * entry-time facts and live ones, jargon labels, and one box — "Open risk: nil,
 * nothing left to lose" — contradicting the rest of the card on a position down
 * 1.25R with its price below entry.
 */

test("the headline is one figure and its R, the percentage in the hover", () => {
  const s = panel();
  const big = s.slice(s.indexOf('<div className={`pd-big mono'), s.indexOf('<div className="pd-split">'));
  ok(/title=\{/.test(big), "the percentage moved to the hover");
  ok(!/\(\$\{signedPct/.test(big), "no bracketed percentage beside the figure");
});

test("the split under it is a sentence, not 'banked ₹−30.4k'", () => {
  const s = panel();
  ok(/"Made" : "Lost"\} \$\{rupee\(Math\.abs\(row\.realisedPnl\)\)\} on the \$\{row\.qtyExited\} sold/.test(s));
  ok(!/banked \{isFinite\(row\.realisedPnl\)/.test(s));
});

test("shares sold are counted, not given as a percentage", () => {
  const s = panel();
  ok(/`\s*·\s*\$\{row\.qtyExited\} of \$\{qty\} sold`/.test(s));
  ok(!/pctClosed\.toFixed\(1\)/.test(s));
});

test("the boxes come in two labelled rows: at entry, then now", () => {
  const s = panel();
  const grid = s.slice(s.indexOf('<div className="pd-grid">'), s.indexOf("{/* Every leg, in order */}"));
  const at = (x) => grid.indexOf(x);
  ok(at("When you bought") >= 0 && at('"How it ended" : "Where it stands"') > at("When you bought"));
  /* every entry-time box sits before the second heading */
  const second = at('"How it ended" : "Where it stands"');
  for (const l of ['stat("Bought at"', 'stat("Stop"', 'stat("Risked"', 'stat("Position"']) {
    ok(at(l) >= 0 && at(l) < second, `${l} belongs to the first row`);
  }
  for (const l of ['stat("Price now"', 'stat("Sold at"', "atRiskNow()", 'stat("Charges"']) {
    ok(at(l) > second, `${l} belongs to the second row`);
  }
});

test("a zero risk says where it comes from, and flags a price that contradicts it", () => {
  const s = panel();
  ok(!/"nothing left to lose"/.test(s), "the claim that caused the confusion is gone");
  ok(/marked at breakeven, but the price is below entry — check your stop/.test(s));
  ok(/if the stop is hit — covered by what is banked/.test(s),
    "risk covered by banked profit shows the rupees, not a nil");
});
