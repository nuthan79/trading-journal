import { test, ok, eq, near } from "./harness.mjs";
import { derivePosition, realisationEvents, bankedEvents } from "@/lib/positions";
import { headline, byPeriod, equityCurve } from "@/lib/calc";

/**
 * MARGIN COSTS COME OUT OF P&L AND R — AND NOWHERE ELSE.
 *
 * Interest on the funded part, ₹18 to pledge when bought and ₹18 to unpledge
 * on each sell. Worked by hand: 235 shares at ₹1,000 on 2.35× is ₹1,35,000
 * funded; at ₹40 per lakh per day that is ₹54 a day, ₹0.2297872 per share
 * per day.
 */
const mk = (t) => ({ ...t, ...derivePosition(t, 5e6), status: t.status, exits: t.exits });
const PSD = (1000 * (1 - 1 / 2.35) * 40) / 1e5;

const base = {
  symbol: "MTF", side: "long", entry_date: "2026-09-01", entry_price: 1000,
  quantity: 235, stop_loss: 980, stop_source: "recorded", charges: 0,
  mtf_leverage: 2.35, mtf_rate: 40,
};

/* Sold all 235 at ₹1,100 ten days later: ₹23,500 gross. */
const CLOSED = mk({ ...base, id: "c", status: "closed",
  exit_date: "2026-09-11", exit_price: 1100,
  exits: [{ exit_date: "2026-09-11", quantity: 235, price: 1100, charges: 0 }] });

test("a closed MTF trade's P&L is net of interest and both fees", () => {
  const interest = 235 * PSD * 10;                  // ₹540
  near(CLOSED.realisedInterest, interest, 0.01);
  near(CLOSED.pledgeFees, 36, 0.001, "₹18 pledge + ₹18 for the one sell");
  near(CLOSED.pnl, 23500 - interest - 36, 0.01);
  near(CLOSED.r, CLOSED.pnl / (20 * 235), 0.000001, "and R is that P&L over the same 1R");
});

test("the Charges figure does not grow with margin", () => {
  eq(CLOSED.charges, 0, "brokerage and tax are one thing, margin another");
});

test("a trade not on margin is exactly what it was", () => {
  const plain = mk({ ...base, id: "p", mtf_leverage: null, mtf_rate: null, status: "closed",
    exit_date: "2026-09-11", exit_price: 1100,
    exits: [{ exit_date: "2026-09-11", quantity: 235, price: 1100, charges: 0 }] });
  near(plain.pnl, 23500, 0.001);
  eq(plain.margin, 0);
  eq(plain.pledgeFees, 0);
});

/* Sold 100 on day 4 at ₹1,050 and 135 on day 10 at ₹1,100. */
const TWO = mk({ ...base, id: "t", status: "closed", exit_date: "2026-09-11", exit_price: 1078.72,
  exits: [
    { exit_date: "2026-09-05", quantity: 100, price: 1050, charges: 12 },
    { exit_date: "2026-09-11", quantity: 135, price: 1100, charges: 15 },
  ] });

test("each sell carries its own interest and unpledge; the pledge is spread", () => {
  const evs = realisationEvents(TWO);
  eq(evs.length, 2);
  const i1 = 100 * PSD * 4, i2 = 135 * PSD * 10;
  near(evs[0].margin, i1 + 18 + 18 * (100 / 235), 0.01);
  near(evs[1].margin, i2 + 18 + 18 * (135 / 235), 0.01);
  near(evs[0].charge, 12, 0.001, "each sell's charge is untouched by margin");
  near(evs[1].charge, 15, 0.001);
});

test("the parts still add back to the position, to the paisa", () => {
  const evs = realisationEvents(TWO);
  near(evs.reduce((a, e) => a + e.pnl, 0), TWO.realisedPnl, 0.0001);
  near(evs.reduce((a, e) => a + e.margin, 0), TWO.realisedMargin, 0.0001);
  near(evs.reduce((a, e) => a + e.charge, 0), 27, 0.0001, "charges sum as before");
});

test("a part-sold MTF position: realised pays for its sells, unrealised for the rest", () => {
  const PART = mk({ ...base, id: "q", status: "partial", last_price: 1200,
    exits: [{ exit_date: "2026-09-05", quantity: 100, price: 1050, charges: 0 }] });
  near(PART.realisedMargin, 100 * PSD * 4 + 36, 0.01, "its sell's interest, the pledge, one unpledge");
  ok(PART.openInterest > 0, "the 135 still held have run up interest to today");
  near(PART.unrealisedPnl, 135 * 200 - PART.openInterest, 0.01);
  near(PART.pnl, PART.realisedPnl + PART.unrealisedPnl, 0.01);
});

test("an open position with no price yet takes nothing off anything", () => {
  const OPEN = mk({ ...base, id: "o", status: "open", exits: [] });
  ok(!Number.isFinite(OPEN.pnl), "no mark, no P&L — so no interest subtracted from nothing");
  eq(OPEN.margin, 0);
});

test("an estimated entry date: fees still count, interest is not guessed", () => {
  const EST = mk({ ...base, id: "e", entry_date_source: "assumed", status: "closed",
    exit_date: "2026-09-11", exit_price: 1100,
    exits: [{ exit_date: "2026-09-11", quantity: 235, price: 1100, charges: 0 }] });
  eq(EST.realisedInterest, 0);
  eq(EST.interestUnknown, true);
  near(EST.pnl, 23500 - 36, 0.001);
});

/* ---- the totals every screen reads --------------------------------- */

test("net P&L on the Dashboard and in the period table agree, margin and all", () => {
  const book = [CLOSED, TWO];
  const dash = headline(book, { openingCapital: 5e6, banking: book }).netPnl;
  const periods = byPeriod(book, "fy", { openingCapital: 5e6, basis: "exit" })
    .reduce((a, r) => a + (isFinite(r.pnl) ? r.pnl : 0), 0);
  near(dash, CLOSED.pnl + TWO.pnl, 0.01);
  near(periods, dash, 0.01);
});

test("the headline and the period table report margin cost on its own line", () => {
  const book = [CLOSED, TWO];
  const h = headline(book, { openingCapital: 5e6, banking: book });
  near(h.margin, CLOSED.realisedMargin + TWO.realisedMargin, 0.01);
  near(h.charges, 27, 0.01, "and charges exclude it");
  const rows = byPeriod(book, "fy", { openingCapital: 5e6, basis: "exit" });
  near(rows.reduce((a, r) => a + (r.margin || 0), 0), h.margin, 0.01);
});

test("the fallback event carries the whole realised margin", () => {
  const evs = bankedEvents({ ...CLOSED, exits: [] });
  near(evs[0].margin, CLOSED.realisedMargin, 0.001);
});

/* ---- where it shows ------------------------------------------------ */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

test("unticking MTF on the form takes the cost off at once", () => {
  const s = read("components/journal/TradeForm.jsx");
  ok(/mtf_leverage: t\.mtf_on \? t\.mtf_leverage : null,/.test(s));
  ok(/mtf_rate: t\.mtf_on \? t\.mtf_rate : null,/.test(s));
});

test("every 'after charges' on a Net P&L also names MTF", () => {
  /* Otherwise the "before them" figure is quietly net of MTF while calling
     itself the result before costs. */
  const pp = read("components/journal/PeriodPerformance.jsx");
  ok(/full\(pnl \+ c \+ m\)/.test(pp), "the period table adds MTF back into 'before'");
  ok(/`\$\{full\(m\)\} MTF`/.test(pp));
  ok(/h\.margin > 0 \? ` and \$\{rupee\(h\.margin\)\} MTF`/.test(read("components/journal/HeadlineNumbers.jsx")));
});

test("the CSV carries margin, so pnl still reconciles", () => {
  ok(/"notes",[\s\S]*?"margin"\];/.test(read("components/journal/Trades.jsx")));
});

test("the detail panel says margin in one line under the table, not in it", () => {
  /* A row of its own, plus a third line on the still-held row, made the table
     wider than the panel and pushed its first column off the edge. */
  const s = read("components/journal/PositionDetail.jsx");
  const table = s.slice(s.indexOf('<div className="card scroll pd-table">'), s.indexOf("</table>"));
  ok(!/mtf|interest/i.test(table.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")), "nothing about margin inside the table");
  ok(/<p className="pd-mtf">/.test(s), "one line under it");
  ok(/const net = gross - \(Number\(e\.charges\) \|\| 0\);/.test(s), "each sell still reads as its own price and charge");
});

/* ---- interest paid, on its own ------------------------------------- */

test("interest and fees are the two halves of margin, at every level", () => {
  for (const e of realisationEvents(TWO)) near(e.interest + e.fees, e.margin, 1e-9);
  const book = [CLOSED, TWO];
  const h = headline(book, { openingCapital: 5e6, banking: book });
  near(h.interest + h.fees, h.margin, 0.0001);
  near(h.interest, CLOSED.realisedInterest + TWO.realisedInterest, 0.01);
  near(h.fees, CLOSED.pledgeFees + TWO.pledgeFees, 0.0001);
  const rows = byPeriod(book, "fy", { openingCapital: 5e6, basis: "exit" });
  near(rows.reduce((a, r) => a + (r.interest || 0), 0), h.interest, 0.01, "the year sums to the Dashboard");
});

test("what an open MTF position costs to carry per day", () => {
  const PART = mk({ ...base, id: "q2", status: "partial", last_price: 1200,
    exits: [{ exit_date: "2026-09-05", quantity: 100, price: 1050, charges: 0 }] });
  near(PART.marginPerDay, 135 * PSD, 1e-9, "on the 135 still held, not the 235 bought");
  eq(CLOSED.marginPerDay, 0, "nothing held, nothing to carry");
});

test("all three places stay hidden for anyone who never used margin", () => {
  ok(/\.\.\.\(h\.margin > 0 \? \[\{\s*label: "MTF"/.test(read("components/journal/HeadlineNumbers.jsx")),
    "the Dashboard tile");
  ok(/foot=\{totals\.mtfN > 0 \?/.test(read("components/journal/Holdings.jsx")), "the Holdings line");
  ok(/m > 0 && `\$\{full\(m\)\} MTF`/.test(read("components/journal/PeriodPerformance.jsx")),
    "the period hover names MTF only when there was some");
});

/**
 * MTF IS ONE FIGURE. It means the interest with the pledge and unpledge
 * charges; the user asked for the parts never to be shown apart. The split
 * still exists in the data — the figures are built from it — but no screen
 * prints it.
 */
test("no screen shows interest and pledge charges as separate amounts", () => {
  for (const f of ["components/journal/PeriodPerformance.jsx", "components/journal/HeadlineNumbers.jsx",
                   "components/journal/Holdings.jsx", "components/journal/Trades.jsx",
                   "components/journal/PositionDetail.jsx", "components/journal/TradeForm.jsx"]) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok(!/rupee\((mtf|row|t|h)\.(interest|fees|pledgeFees)\)|full\(i\)|of it interest/.test(src),
      `${f} prints a part of MTF on its own`);
  }
});

test("the Dashboard tile and Holdings 'so far' are MTF as a whole", () => {
  ok(/label: "MTF",\s*value: <Money v=\{h\.margin\}/.test(read("components/journal/HeadlineNumbers.jsx")));
  ok(/Number\(r\.realisedMargin\) \|\| 0\) \+ \(Number\(r\.openInterest\)/.test(read("components/journal/Holdings.jsx")),
    "so far includes the pledge charges, not interest alone");
});
