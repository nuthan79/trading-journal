import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq, near } from "./harness.mjs";
import { money, rupee, exact, moneyParts, setActiveRegion,
         setDisplayCurrency, displayCurrency, currencySign } from "@/lib/format";
import { legCharges, US_BROKER_PRESETS } from "@/lib/charges";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

/**
 * READING A US BOOK IN RUPEES — which is not blending two books.
 *
 * One book, one stated rate, and only the WRITING changes: nothing stored
 * moves, nothing is summed across markets, and R never converts because it is
 * a ratio. The rate is today's, applied to every figure including old ones,
 * so the screens say "worth to you now" rather than "made at the time".
 */
const RATE = 95.805;

test("a US book can be read in rupees, and switched straight back", () => {
  setActiveRegion("US");
  eq(money(1400), "$1.4K");
  setDisplayCurrency({ currency: "INR", rate: RATE });
  eq(money(1400), "₹1.34 L", "the Indian ladder, not $ with a rupee sign");
  eq(exact(1400), "₹1,34,127", "and the hover agrees with the figure");
  eq(currencySign(), "₹");
  setDisplayCurrency(null);
  eq(money(1400), "$1.4K", "one click back to the book's own figures");
  setActiveRegion("IN");
});

test("a rate that is missing or nonsense changes nothing", () => {
  setActiveRegion("US");
  for (const bad of [null, { currency: "INR", rate: 0 }, { currency: "INR", rate: NaN }]) {
    setDisplayCurrency(bad);
    eq(displayCurrency(), null, "no rate, no conversion");
    eq(money(1400), "$1.4K", "the dollars are the real figures and are always there");
  }
  setActiveRegion("IN");
});

test("an explicit region still wins, so rupee() and India are untouched", () => {
  setActiveRegion("US");
  setDisplayCurrency({ currency: "INR", rate: RATE });
  eq(rupee(18), "₹18", "the pledge fee is eighteen rupees, not eighteen dollars converted");
  eq(money(1400, { region: "US" }), "$1.4K", "a figure that names its book keeps it");
  setDisplayCurrency(null); setActiveRegion("IN");
  eq(money(588000), "₹5.88 L");
});

test("the parts form converts too, or Today disagrees with the table", () => {
  setActiveRegion("US");
  setDisplayCurrency({ currency: "INR", rate: RATE });
  near(Number(moneyParts(1400).int.replace(/,/g, "")), 1400 * RATE, 1);
  setDisplayCurrency(null); setActiveRegion("IN");
});

test("the toggle is offered only where it means something, and says the rate", () => {
  const cv = read("src/components/journal/CurrencyView.jsx");
  ok(/own\.currency === home\.currency\) return null/.test(cv),
     "no toggle on an Indian book — there is nothing to convert");
  ok(/what this book is worth to you now, not what it made at the time/.test(cv),
     "the hover says what today's rate can and cannot tell you");
  const layout = read("src/app/(app)/layout.jsx");
  ok(/Shown in rupees at today&apos;s rate/.test(layout), "and the page says it above every screen");
  ok(/R is unaffected: it is a ratio/.test(layout));
  ok(/localStorage\.setItem\("ledgerr:show-as"/.test(layout),
     "remembered per browser: it is how you read, not a fact about the account");
});

test("the rate comes from the same seam as the quotes", () => {
  const q = read("src/lib/quotes.js");
  ok(/export async function fxRate/.test(q));
  ok(/\$\{from\}\$\{to\}=X/.test(q), "Yahoo spells a pair USDINR=X");
  const route = read("src/app/api/quotes/route.js");
  ok(/searchParams\.get\("fx"\)/.test(route), "same route, same auth, same rate limit");
});

/* IBKR is how most non-US traders reach the US market, so its two plans are
   first on the list — and Pro's ceiling is a share of the trade, not a fixed
   figure, which is why commissionCapPct exists. */
test("IBKR is offered, and its tiered plan is charged correctly", () => {
  const names = Object.keys(US_BROKER_PRESETS);
  eq(names[0], "IBKR Lite — zero commission");
  ok(/IBKR Pro/.test(names[1]));
  const pro = US_BROKER_PRESETS[names[1]];
  const at = (price, qty) => legCharges(
    { leg: "buy", exchange: "NASDAQ", price, quantity: qty, date: "2026-09-21" }, pro).brokerage;
  near(at(200, 1000), 3.5, 1e-9, "a thousand shares at $0.0035");
  near(at(200, 10), 0.35, 1e-9, "the floor on a small order");
  near(at(0.2, 100), 0.2, 1e-9, "and the 1% ceiling on a cheap one, which the floor would breach");
});

/* THE TOGGLE ARRIVED DISABLED, saying the rate could not be fetched — which
   was true: the quotes route requires a signed-in caller, the session lives
   in localStorage, and a plain fetch() carries no token. */
test("the rate is fetched the way every other call to our own API is", () => {
  const db = read("src/lib/db.js");
  ok(/export async function fxRate/.test(db), "it belongs beside the other reads");
  ok(/apiFetch\(`\/api\/quotes\?fx=/.test(db), "through the helper that attaches the token");
  const layout = read("src/app/(app)/layout.jsx");
  ok(/dbFxRate\(`\$\{bookCurrency\}\$\{homeCurrency\}`\)/.test(layout));
  ok(!/fetch\(`\/api\/quotes\?fx=/.test(layout), "never a bare fetch to an authenticated route");
});
