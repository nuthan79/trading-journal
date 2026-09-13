import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { rupee, exact, moneyTitle } from "@/lib/format";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * THE ABBREVIATION IS THE POINT, AND SO IS GETTING IT BACK.
 *
 * "₹5.88 L" is anywhere in a ₹500 band, and the user reconciling that row
 * against a broker statement needs the digits it dropped. They now live in the
 * hover. What these pin is the two ways that goes wrong: a tooltip that
 * repeats what is already on screen, and a tooltip that silently replaces one
 * a cell already had.
 */

test("the hover gives back every digit the tier dropped", () => {
  eq(exact(588000), "₹5,88,000", "grouped the Indian way, not 588,000");
  eq(rupee(588000), "₹5.88 L", "and the page still shows the short form");
  eq(exact(1763000), "₹17,63,000");
  eq(exact(-23800), "₹−23,800", "sign inside the ₹, exactly as the cell writes it");
  ok(exact(-23800).startsWith("₹") && rupee(-23800).startsWith("₹"),
    "a tooltip must not reorder the two characters of the figure it expands");
});

test("paise survive where they exist and are not invented where they do not", () => {
  eq(exact(3013.45), "₹3,013.45", "a price carries its paise");
  eq(exact(588000), "₹5,88,000", "a whole-rupee total is not padded with .00");
});

/**
 * The failure this guards is a hover that teaches the user hovers are useless.
 * Below the first tier `rupee()` abbreviates nothing, so a tooltip there would
 * read back the string already on the page — on the majority of small figures
 * in the app.
 */
test("no tooltip when the page already shows every digit", () => {
  eq(moneyTitle(450), undefined, "₹450 is not hiding anything");
  eq(moneyTitle(99.5), undefined);
  ok(moneyTitle(1002) != null, "but ₹1.0k is hiding two rupees and a change");
  eq(moneyTitle(588000), "₹5,88,000");
});

test("a note still shows on a figure that hides nothing", () => {
  eq(moneyTitle(450, "0.25% of capital"), "0.25% of capital",
    "the cell's own tooltip must not vanish just because the number is small");
  eq(moneyTitle(588000, "0.25% of capital"), "₹5,88,000 · 0.25% of capital");
});

test("a non-number keeps whatever the cell had to say", () => {
  eq(moneyTitle(null), undefined);
  eq(moneyTitle(NaN, "not recorded"), "not recorded");
});

/**
 * NESTED TITLES ARE THE REGRESSION THIS SHIPS WITH.
 *
 * A `title` inside a `title` means the browser shows whichever one the pointer
 * happens to be over. Every cell that already had a hover over its money had
 * to fold that text into the figure instead — the charges hover on Net P&L is
 * the one the user asked for by name, and losing it to a stray pixel would be
 * a worse bug than the rounding this fixes.
 */
test("no Money sits inside an element whose own title would shadow it", () => {
  /* Strip comments FIRST. Several of them talk about `<Money>` in prose, and a
     tag scanner cannot tell that from markup — the version that did not strip
     them found nothing at all, including a violation injected on purpose. */
  const decomment = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "")
                                .replace(/^\s*\/\/.*$/gm, "");
  const TAG = /<(\/?)([A-Za-z][\w.]*)((?:"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\}|[^>"'])*?)(\/?)>/g;

  const bad = [];
  const walk = (dir) => {
    for (const e of readdirSync(path.join(SRC, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) { walk(rel); continue; }
      if (!e.name.endsWith(".jsx")) continue;
      const src = decomment(read(rel));
      const stack = [];
      for (const m of src.matchAll(TAG)) {
        const [, close, tag, attrs, selfClose] = m;
        if (tag === "Money") {
          /* A note means the outer tooltip's text was folded onto the figure,
             so nothing is lost when the pointer lands on the digits. */
          if (!/\bnote=/.test(attrs)) {
            const shadowed = stack.find((f) => /\btitle=/.test(f.attrs));
            if (shadowed) bad.push(`${rel}: <${shadowed.tag} title> wraps a bare <Money>`);
          }
        }
        if (close) { while (stack.length && stack.pop().tag !== tag); }
        else if (!selfClose) stack.push({ tag, attrs });
      }
    }
  };
  walk("components");
  eq(bad.length, 0, bad.join(" | "));
});

test("the period table's money cells go through Money, not raw rupee()", () => {
  const src = read("components/journal/PeriodPerformance.jsx");
  ok(/<Money v=\{totals\.pnl \/ rows\.length\}/.test(src),
    "the per-financial-year average is the cell the user pointed at");
  ok(/<Money v=\{r\.pnl\}/.test(src) && /<Money v=\{totals\.pnl\}/.test(src),
    "and every Net P&L in the table");
  ok(!/title=\{isFinite\(r\.charges\)/.test(src),
    "the charges tooltip moved onto the figure — it must not also sit on the td");
});

/**
 * `<span>` is not valid inside `<text>`, and React will not warn. The two SVG
 * chart labels that print rupees are deliberately still plain strings.
 */
test("Money never lands inside an SVG text element", () => {
  for (const f of ["components/journal/Review.jsx", "components/ExpectancyCalculator.jsx"]) {
    const src = read(f);
    for (const m of src.matchAll(/<text[\s\S]{0,400}?<\/text>/g)) {
      ok(!m[0].includes("<Money"), `${f} puts a Money inside <text>`);
    }
  }
});
