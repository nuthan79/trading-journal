import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { rupee } from "@/lib/format";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * NEVER ANNOUNCE A DIFFERENCE SMALLER THAN THE FIGURES YOU PRINT.
 *
 * The Trades footer prints "₹X of it was realised inside this window" beside
 * the whole-position total, and showed it whenever the two differed by more
 * than ONE RUPEE — while rendering both through the compact formatter, where
 * one lakh is the smallest visible step. On a book whose positions barely
 * straddle 1 April the two differed by a few hundred rupees and printed the
 * identical string twice, which reads as a broken calculation.
 *
 * The money was right the whole time. The threshold was in rupees and the
 * display was in lakhs.
 */

test("amounts inside one display step render identically", () => {
  /* The real pair off the screenshot: the guard let this through. */
  eq(rupee(1526000), rupee(1525600), "a ₹400 gap is invisible at this precision");
  eq(rupee(1002), "₹1.0k", "and a k-tier figure hides hundreds too");
  /* While a gap worth mentioning survives — the other book on the same day. */
  ok(rupee(1567000) !== rupee(1087000), "₹4.8 L must still be announced");
});

test("the footer decides on the rendered strings, not the raw values", () => {
  const src = read("components/journal/Trades.jsx");
  /* The line that got this wrong, in the shape it had. Pinned by its operands
     rather than its exact spacing so a reformat does not quietly retire it. */
  ok(!/Math\.abs\(\s*realisedHere\s*-\s*totals\.pnl\s*\)/.test(src),
    "realisedHere must not be compared to the total with a numeric epsilon");
  ok(/money\(realisedHere\)\s*!==\s*money\(totals\.pnl\)/.test(src),
    "it must compare what the two cells actually print");
});

/**
 * A FIGURE WHOSE SCOPE DIFFERS FROM ITS TABLE MUST SAY SO WHERE IT IS.
 *
 * "realised between these dates" walks the whole book, not the rows: it is
 * what reconciles with Performance, and it is deliberately unaffected by the
 * tab or the filter. That scope lived only in a title attribute, so on the
 * Winners tab the line read as a claim about the winners — three positions
 * that banked ₹2.47 L inside the window sitting under "₹77.1k realised
 * between these dates", the gap being losers the tab was hiding. Winners and
 * Losers printed the same ₹77.1k, which is the proof it was never about the
 * rows.
 *
 * Comments are stripped: the reason lives in one, and a comment nobody sees
 * is exactly what failed here.
 */
test("the realised figure names the whole book on screen, not only in a hover", () => {
  const visible = read("components/journal/Trades.jsx")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok(/realised across the whole book/.test(visible),
     "the line does not say whose money it is where a reader will see it");
  ok(/including positions this view hides/.test(visible),
     "nothing on screen says the figure counts rows the filter is not showing");
});

/**
 * And the value itself stays book-wide. Walking `rows` is the bug this was
 * fixed out of once already — a position that sold inside the window and
 * finished after it is not in `rows` at all, and a real book came out ₹4.8 L
 * short of Performance for the same year.
 */
test("the realised figure is summed over the book, never the rows on screen", () => {
  const src = read("components/journal/Trades.jsx");
  const body = src.slice(src.indexOf("const realisedHere"),
                         src.indexOf("const totals", src.indexOf("const realisedHere")));
  ok(/for \(const t of all\)/.test(body), "it must walk every trade in the book");
  ok(!/\bof rows\b/.test(body), "it is walking the filtered rows again");
  ok(/bankedEvents\(t\)/.test(body), "it must split positions into their sells");
});
