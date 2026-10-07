import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq, near } from "./harness.mjs";
import { tradeCharges, entryCharges, sameDayQty, mergeConfig, BROKER_PRESETS } from "@/lib/charges";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");
const ZERODHA = mergeConfig(BROKER_PRESETS["Zero brokerage (Zerodha, Groww, Upstox delivery)"]);

const trade = (exits) => ({
  exchange: "NSE", entry_date: "2026-09-14", entry_price: 1000, quantity: 100, exits,
});

/*
 * A CNC BUY SQUARED OFF THE SAME DAY IS INTRADAY. Worked by hand at Zerodha's
 * rates on ₹1,000 × 100 sold at ₹1,010:
 *   buy  — exch 2.97 + SEBI 0.10 + stamp 3.00 (0.003%) + brokerage 20 (cap)
 *          + GST 4.15 = 30.22; no STT on an intraday buy
 *   sell — STT 25.25 (0.025%) + exch 3.00 + SEBI 0.10 + brokerage 20
 *          + GST 4.16 = 52.51; no DP, nothing left the demat account
 */
test("bought and sold the same day is charged as intraday", () => {
  const c = tradeCharges(trade([{ exit_date: "2026-09-14", quantity: 100, price: 1010 }]), ZERODHA);
  near(c.buyTotal, 30.22, 0.01, "buy leg");
  near(c.sellTotal, 52.51, 0.01, "sell leg");
  eq(c.breakdown.dp, 0, "no DP charge on a same-day sell");
  near(c.breakdown.stt, 25.25, 0.01, "STT only on the sell, at 0.025%");
  near(c.breakdown.stampDuty, 3, 0.01, "stamp duty at 0.003%");
  near(c.breakdown.brokerage, 40, 0.01, "₹20 an order, Zerodha's intraday cap");
  eq(c.sameDayQty, 100);
});

test("sold the next day is delivery, exactly as before", () => {
  const c = tradeCharges(trade([{ exit_date: "2026-09-15", quantity: 100, price: 1010 }]), ZERODHA);
  near(c.breakdown.stt, 201, 0.01, "0.1% on both sides");
  near(c.breakdown.stampDuty, 15, 0.01, "0.015% on the buy");
  eq(c.breakdown.brokerage, 0, "zero brokerage on delivery");
  eq(c.breakdown.dp, 13.5, "the depository bills the sell");
  near(c.total, 239.21, 0.01);
  eq(c.sameDayQty, 0);
});

/* Buy 100, sell 40 by the close and 60 a week later: only the 40 are intraday. */
test("only the shares sold that day are intraday", () => {
  const t = trade([
    { exit_date: "2026-09-14", quantity: 40, price: 1010 },
    { exit_date: "2026-09-21", quantity: 60, price: 1050 },
  ]);
  eq(sameDayQty(t), 40);
  const c = tradeCharges(t, ZERODHA);
  /* Buy: STT on the 60 delivered (₹60,000 × 0.1%), stamp 0.015% on them and
     0.003% on the 40. */
  near(c.buy.stt, 60, 0.01);
  near(c.buy.stampDuty, 9 + 1.2, 0.01);
  near(c.buy.brokerage, 12, 0.01, "0.03% of the ₹40,000 intraday part, under the cap");
  const [same, later] = c.sells;
  eq(same.dp, 0, "the same-day sell bills no DP");
  near(same.stt, 40400 * 0.00025, 0.01);
  eq(later.dp, 13.5, "the later sell is delivery and does");
  near(later.stt, 63000 * 0.001, 0.01);
  eq(later.brokerage, 0);
});

test("a legacy single exit on the entry date counts too", () => {
  const c = tradeCharges({ exchange: "NSE", entry_date: "2026-09-14", entry_price: 1000,
    quantity: 100, exit_date: "2026-09-14", exit_price: 1010 }, ZERODHA);
  eq(c.sameDayQty, 100);
  eq(c.breakdown.dp, 0);
});

test("an open position with nothing sold is still a delivery buy", () => {
  const b = entryCharges(trade([]), ZERODHA);
  near(b.stt, 100, 0.01);
  near(b.stampDuty, 15, 0.01);
});

test("the new rates are statutory, and nobody's stored config can change them", () => {
  const tampered = mergeConfig({ sttIntradayPct: 0, stampDutyIntradayPct: 0 });
  eq(tampered.sttIntradayPct, 0.025);
  eq(tampered.stampDutyIntradayPct, 0.003);
});

test("the form prices the entry side with the sells, and the breakdown says why", () => {
  const form = read("components/journal/TradeForm.jsx");
  ok(/entry_date: t\.entry_date, exits \}/.test(form),
     "splitCharges must hand the sells to entryCharges, or a same-day buy is priced as delivery");
  ok(/computed\.sameDayQty > 0/.test(read("components/journal/ChargesField.jsx")),
     "the charges breakdown explains a same-day trade");
});
