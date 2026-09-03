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
  ok(/rupee\(realisedHere\)\s*!==\s*rupee\(totals\.pnl\)/.test(src),
    "it must compare what the two cells actually print");
});
