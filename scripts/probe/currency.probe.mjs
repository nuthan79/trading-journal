import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { money, rupee, amount, exact, moneyParts, moneyTitle,
         setActiveRegion, activeRegion } from "@/lib/format";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

/**
 * PHASE 2 — money in the currency of the book being read.
 *
 * The whole phase is judged on the first test: an Indian book must print
 * exactly what it printed before any of this existed. These strings were
 * copied from the old formatter's output, so if one of them ever changes, a
 * live journal's numbers changed with it.
 */
const IN_CASES = [
  [0, "₹0"], [45, "₹45"], [99.5, "₹99.5"], [450.5, "₹451"], [999, "₹999"],
  [1000, "₹1.0k"], [58800, "₹58.8k"], [99999, "₹100.0k"],
  [588000, "₹5.88 L"], [5880000, "₹58.80 L"],
  [10930000000, "₹1,093 Cr"], [12000000000000, "₹12.00 Lakh Cr"],
  [-23800, "₹−23.8k"], [null, "—"], [NaN, "—"],
];

test("India prints exactly what it always printed", () => {
  setActiveRegion("IN");
  for (const [v, want] of IN_CASES) eq(money(v), want, `${v}`);
  eq(exact(588000), "₹5,88,000", "the hover keeps the Indian grouping");
  eq(exact(-23800), "₹−23,800", "with the sign inside the symbol");
  eq(moneyParts(5035939.09).int, "50,35,939");
  eq(moneyTitle(450), undefined, "still no hover where nothing is abbreviated");
  eq(moneyTitle(588000), "₹5,88,000");
});

test("a US book gets the ladder Americans read, and the dollar", () => {
  setActiveRegion("US");
  eq(money(0), "$0");
  eq(money(999), "$999");
  eq(money(1000), "$1.0K");
  eq(money(58800), "$58.8K");
  eq(money(588000), "$588.0K", "no lakh: 5.88 L would be meaningless here");
  eq(money(5880000), "$5.88M");
  eq(money(10930000000), "$10.93B");
  eq(money(-23800), "$−23.8K");
  eq(exact(588000), "$588,000", "and the thousands grouping, not 5,88,000");
  eq(moneyTitle(588000), "$588,000");
  setActiveRegion("IN");
});

test("rupee() is always rupees, whatever book is open", () => {
  /* The statutory rates, the broker presets, the pledge fee, the learn pages:
     all about India whether or not this user is trading there today. */
  setActiveRegion("US");
  eq(rupee(588000), "₹5.88 L");
  eq(rupee(18), "₹18");
  setActiveRegion("IN");
  eq(rupee(588000), "₹5.88 L", "and the same in an Indian book");
});

test("the region can be named per call, for anything that must be explicit", () => {
  setActiveRegion("IN");
  eq(money(588000, { region: "US" }), "$588.0K");
  eq(amount(588000, { region: "US" }), "588.0K", "the bare figure, no sign");
  eq(activeRegion(), "IN", "asking about another book does not switch to it");
});

test("the huge-number guard still fires, in both books", () => {
  for (const r of ["IN", "US"]) {
    setActiveRegion(r);
    const out = money(2.1e21);
    ok(/× 10\^/.test(out), `${r}: exponential notation never reaches a page`);
    ok(!/e\+/.test(out));
  }
  setActiveRegion("IN");
});

test("the app layout tells the formatters which book is open", () => {
  const layout = read("src/app/(app)/layout.jsx");
  ok(/setActiveRegion\(bookRegion\)/.test(layout));
  /* Before the first figure is formatted, which on this page means before the
     derivation that feeds every screen. */
  ok(layout.indexOf("setActiveRegion(bookRegion)") < layout.indexOf("const all = useMemo"),
     "set before anything below it formats a figure");
});

test("the journal's own screens print the book's currency, not a fixed one", () => {
  /* A screen showing YOUR trades must follow YOUR book. The ones that print
     rupees on purpose are India's own subject matter, and are listed here so
     adding to that list is a decision rather than a habit. */
  const ALWAYS_INDIA = new Set([
    "ExpectancyCalculator.jsx",   // public SEO tool, written about Indian trading
    /* Setup states the rupee equivalent of a foreign account size, on purpose
       and with the rate beside it — the one place a rupee figure belongs in a
       US book. It asks for region "IN" explicitly, which is what rupee() is
       for. */
    "SettingsSheet.jsx",
  ]);
  const dirs = ["src/components/journal", "src/components"];
  for (const dir of dirs) {
    for (const f of readdirSync(path.join(ROOT, dir)).filter((x) => /\.jsx$/.test(x))) {
      if (ALWAYS_INDIA.has(f)) continue;
      const src = read(path.join(dir, f));
      ok(!/\brupee\(/.test(src), `${f} calls rupee() — a US book would print ₹ over dollars`);
    }
  }
});

test("Money renders and hovers in the same currency", () => {
  const src = read("src/components/Money.jsx");
  ok(/import \{ money, moneyTitle \}/.test(src));
  ok(/\{money\(v, opts\)\}/.test(src), "the figure follows the book");
  ok(!/rupee/.test(src), "and nothing here is hard-wired to rupees");
});
