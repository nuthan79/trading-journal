import { test, ok, eq } from "./harness.mjs";
import { reviewFindings } from "@/lib/analysis";
import { setActiveRegion } from "@/lib/format";

const book = (make) => Array.from({ length: 60 }, (_, i) => ({
  id: `t${i}`, status: "closed", symbol: `S${i}`,
  entry_date: `2026-0${1 + (i % 9)}-10`, exit_date: `2026-0${1 + (i % 9)}-20`,
  entry_price: 100, stop_loss: 90, quantity: 100, stop_source: null,
  ...make(i),
}));
const sizing = (rows) => {
  const f = reviewFindings(rows);
  const list = Array.isArray(f) ? f : (f?.findings || []);
  return list.filter((x) => /conviction/.test(x.id || ""));
};

/**
 * THE STATISTIC IS SOUND; THE WORDS WERE NOT.
 *
 * R is P&L over risk, so risk is on both sides of pearson(riskPct, r) and the
 * coefficient looks like it must be biased. It is not, under the null that
 * matters: "sizing tells you nothing" means R independent of risk, and
 * shuffling R against risk 3,000 times gives a median of −0.001 and trips
 * −0.20 on 1% of shuffles. An attempt to replace it with a pure money
 * comparison fired on 17% of those shuffles — strictly worse — because the
 * shuffle used to justify it moved P&L instead of R, which destroys the
 * proportionality between size and money and is a real effect, not noise.
 *
 * So the trigger stayed and the headline changed: a coefficient nobody can
 * read became a rupee figure anybody can check.
 */
test("a book where bigger bets were not worse says nothing", () => {
  setActiveRegion("IN");
  /* R is the same whatever was risked — sizing carried no information. */
  const rows = book((i) => {
    const riskAmt = 7000 * (1 + (i % 10));
    return { riskAmt, riskPct: (riskAmt / 7000000) * 100, r: i % 3 === 0 ? -1 : 0.9 };
  });
  eq(sizing(rows).length, 0, "nothing to report when size tracks nothing");
});

test("it speaks when flat sizing would really have paid more", () => {
  setActiveRegion("IN");
  /* The big bets lose, the small ones win — flat sizing beats this book. */
  const rows = book((i) => {
    const big = i % 2 === 0;
    const riskAmt = big ? 70000 : 7000;
    return { riskAmt, riskPct: (riskAmt / 7000000) * 100, r: big ? -1 : 2 };
  });
  const found = sizing(rows);
  eq(found.length, 1);
  ok(/would have made/.test(found[0].title), `title reads "${found[0].title}"`);
  ok(/₹/.test(found[0].title), "the headline must be in money, not a coefficient");
  ok(found[0].evidence.sizingWorthRupees < 0, "and the evidence must say it cost");
});

test("and credits sizing that worked", () => {
  setActiveRegion("IN");
  const rows = book((i) => {
    const big = i % 2 === 0;
    const riskAmt = big ? 70000 : 7000;
    return { riskAmt, riskPct: (riskAmt / 7000000) * 100, r: big ? 2 : -1 };
  });
  const found = sizing(rows);
  eq(found.length, 1);
  ok(/made you ₹/.test(found[0].title), `title reads "${found[0].title}"`);
  ok(found[0].evidence.sizingWorthRupees > 0);
});

test("too few trades says nothing at all", () => {
  setActiveRegion("IN");
  const rows = book((i) => {
    const big = i % 2 === 0;
    const riskAmt = big ? 70000 : 7000;
    return { riskAmt, riskPct: (riskAmt / 7000000) * 100, r: big ? -1 : 2 };
  }).slice(0, 20);
  eq(sizing(rows).length, 0, "one outlier must not be the whole finding");
});
