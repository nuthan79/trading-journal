import { test, ok, eq, near } from "./harness.mjs";
import { legCharges, tradeCharges, SEC_FEE_RATES, TAF_RATES,
         US_BROKER_PRESETS, CHARGE_LABELS } from "@/lib/charges";
import { fyStartYear, fyQuarter, fyLabel } from "@/lib/calc";
import { setActiveRegion } from "@/lib/regions";

/**
 * PHASE 4 — what a US trade costs, and when its year starts.
 *
 * The rates are DATED because both of them change on announced dates and a
 * trade is charged at the rate in force on the day it traded. Two of the
 * entries are zero and they are real: the SEC rate sat at $0.00 per million
 * for the first half of FY2026, and FINRA paused TAF collection for the last
 * quarter of calendar 2026. A flat constant would charge fees in both windows
 * that nobody ever paid.
 */
const sell = (o) => legCharges({ leg: "sell", exchange: "NASDAQ", ...o });
const buy = (o) => legCharges({ leg: "buy", exchange: "NASDAQ", ...o });

test("a US buy pays commission and nothing else", () => {
  const b = buy({ price: 200, quantity: 50, date: "2026-09-21" });
  eq(b.total, 0, "at a zero-commission broker a buy is free");
  eq(b.secFee, 0); eq(b.taf, 0, "both fees are sell-side only");
  eq(b.stt, 0); eq(b.stampDuty, 0); eq(b.gst, 0);
  eq(b.dp, 0, "there is no depository charge on a US trade");
});

test("a US sell pays the two regulatory fees, at that day's rates", () => {
  const s = sell({ price: 220, quantity: 50, date: "2026-09-21" });
  near(s.secFee, (11000 / 1e6) * 20.60, 1e-9, "$20.60 per million of the sale");
  near(s.taf, 50 * 0.000195, 1e-9, "$0.000195 a share");
  eq(s.total, 0.24, "twenty-four cents on an $11,000 sale");
});

test("the dated windows are honoured, in both directions", () => {
  /* Before 4 April 2026 the SEC rate was zero. */
  const early = sell({ price: 220, quantity: 50, date: "2026-02-01" });
  eq(early.secFee, 0, "no SEC fee where the rate was $0.00 per million");
  ok(early.taf > 0, "but TAF was being collected");

  /* From 1 October to 31 December 2026, FINRA paused TAF. */
  const paused = sell({ price: 220, quantity: 50, date: "2026-11-15" });
  eq(paused.taf, 0, "no TAF during the pause");
  ok(paused.secFee > 0, "while the SEC fee kept running");

  /* And an older trade keeps its own year's rate. */
  const old = sell({ price: 220, quantity: 50, date: "2024-06-01" });
  near(old.secFee, (11000 / 1e6) * 27.80, 1e-9);
  near(old.taf, 50 * 0.000145, 1e-9);
});

test("TAF is capped per trade, so a huge sell is not charged per share forever", () => {
  const huge = sell({ price: 5, quantity: 1000000, date: "2026-09-21" });
  eq(huge.taf, 9.79, "the cap in force from 1 January 2026");
});

test("every rate table is ordered and dated, so reading it by date is safe", () => {
  for (const table of [SEC_FEE_RATES, TAF_RATES]) {
    let last = "";
    for (const row of table) {
      ok(/^\d{4}-\d{2}-\d{2}$/.test(row.from), `${row.from} is a real date`);
      ok(row.from > last, "entries run oldest to newest");
      last = row.from;
    }
  }
});

test("a whole US trade adds up, and names its lines", () => {
  const t = tradeCharges({
    region: "US", exchange: "NASDAQ", entry_price: 200, quantity: 50,
    entry_date: "2026-09-01",
    exits: [{ price: 220, quantity: 50, exit_date: "2026-09-21" }],
  });
  eq(t.buyTotal, 0);
  eq(t.sellTotal, 0.24);
  eq(t.total, 0.24);
  eq(t.breakdown.stt, 0, "an Indian line with no US meaning stays at zero");
  near(t.breakdown.secFee + t.breakdown.taf, 0.24, 0.005);
  ok(CHARGE_LABELS.secFee && CHARGE_LABELS.taf, "both lines have a name to print");
});

test("India's bill is unchanged, and is not mistaken for a US one", () => {
  const s = legCharges({ leg: "sell", exchange: "NSE", price: 500, quantity: 100 },
                       { brokerageModel: "zero" });
  eq(s.total, 67.74, "the same figure as before any of this");
  eq(s.secFee, 0); eq(s.taf, 0);
  eq(s.dp, 13.5); near(s.stt, 50, 1e-9);
  /* A trade with no region and an Indian venue is Indian — every row written
     before regions existed. */
  const noRegion = legCharges({ leg: "sell", exchange: "BSE", price: 500, quantity: 100 },
                              { brokerageModel: "zero" });
  ok(noRegion.stt > 0);
});

test("the venue alone is enough to know which country's bill it is", () => {
  /* An import can write a US exchange without a region; the charge must still
     be the American one rather than STT on a NASDAQ trade. */
  const s = legCharges({ leg: "sell", exchange: "NYSE", price: 100, quantity: 10,
                         date: "2026-09-21" });
  eq(s.stt, 0);
  ok(s.secFee > 0);
});

test("the US presets are the plans US brokers actually charge", () => {
  const names = Object.keys(US_BROKER_PRESETS);
  ok(names.some((n) => /Zero commission/.test(n)), "which is what most of them charge");
  ok(names.some((n) => /Per share/.test(n)), "and the tiered one");
  for (const p of Object.values(US_BROKER_PRESETS)) {
    ok(["zero", "flat", "perShare"].includes(p.commissionModel));
    ok(p.commissionCap === undefined || Number.isFinite(p.commissionCap),
       "never Infinity — jsonb cannot hold it, and it reads back as a cap of zero");
  }
});

/* ---- the year a trade is filed under ------------------------------- */

test("India's financial year is exactly what it was", () => {
  setActiveRegion("IN");
  eq(fyStartYear("2026-04-01"), 2026, "1 April opens a new year");
  eq(fyStartYear("2026-03-31"), 2025, "31 March closes the old one");
  eq(fyLabel("2026-04-01"), "FY27");
  eq(fyLabel("2026-03-31"), "FY26");
  eq(fyQuarter("2026-04-15"), 1);
  eq(fyQuarter("2026-01-15"), 4, "January is Q4 of an Indian year");
});

test("a US book runs on the calendar, and says so", () => {
  setActiveRegion("US");
  eq(fyStartYear("2026-04-01"), 2026);
  eq(fyStartYear("2026-01-01"), 2026, "January opens the year");
  eq(fyStartYear("2025-12-31"), 2025);
  eq(fyLabel("2026-04-01"), "2026", "not FY27 — that would read as a year it is not");
  eq(fyQuarter("2026-01-15"), 1, "January is Q1");
  eq(fyQuarter("2026-04-15"), 2);
  eq(fyQuarter("2026-12-31"), 4);
  setActiveRegion("IN");
});
