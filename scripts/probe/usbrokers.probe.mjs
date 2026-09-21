import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq, near } from "./harness.mjs";
import * as stockal from "@/lib/brokers/stockal";
import * as indmoney from "@/lib/brokers/indmoney";
import { regionOfBroker, BROKERS } from "@/lib/brokers/index.js";
import { toJournalRows } from "@/lib/journalImport";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const read = (f) => readFileSync(path.join(ROOT, f), "utf8");

/**
 * STOCKAL AND INDMONEY — US stocks, sold to Indian investors.
 *
 * The rows below are from the user's own two files, unchanged except that
 * nothing identifying them is here. Both are the shapes that matter:
 * fractional shares to eight decimals, dd/mm/yyyy in one file and
 * "14 Oct 2025, 11:58" in the other, and pages of disclaimer text under each
 * table where a symbol should be.
 */
const SK_CLOSED = [
  [null], ["Profit and Loss Summary"], ["For period 01/04/2025 to 31/03/2026"],
  ["Symbol", "Name", "Quantity Sold", "Date Acquired", "Buying Price ($)", "Date Sold",
   "Selling Price ($)", "Holding Period (Days)", "Proceeds ($)", "Brokerage ($)", "Gains/Losses ($)"],
  ["META", "Meta Platforms Inc", "0.26955967", "09/06/2022", "376.54", "14/10/2025", "711", "1223", "191.6569", "0.05", "90.1569"],
  ["NVDA", "NVIDIA Corporation", "0.03220999", "07/04/2025", "93.1388", "14/10/2025", "182.2", "190", "5.8686", "0.1", "2.8687"],
  ["NOTE:"],
  ["THE BUY_PRICE AND SELL_PRICE ARE CORPORATE ACTION ADJUSTED PRICES WHERE APPLICABLE."],
  ["DISCLAIMER & DISCLOSURES:"],
];

const SK_HELD = [
  [null], ["Holding Statement"], ["As of 31/03/2026"],
  ["Symbol", "Name", "Country", "Address", "ZIP Code", "Nature", "Date of Acquiring",
   "Inital Value ($)", "Peak value as of period ($)", "Total Closing Value ($)", "Quantity", "Average Buy Price ($)"],
  ["MSFT", "Microsoft Corporation", "USA", "ONE MICROSOFT WAY", "98052", "STOCK", "17/10/2025", "118", "660.985", "440.502", "1.18999907", "528.8551"],
  ["NOTE:"],
  ["INITIAL VALUE IS THE BUY AMOUNT ASSOCIATED WITH THE FIRST STOCK PURCHASE ON ACQUIRING DATE."],
];

const IM = [
  ["Account Details"], ["Broker Name", "Alpaca"], ["Period From", "2019-01-01"], [null],
  ["Stock Name", "Stock Symbol", "Order Placed Time", "Order Execution Time", "Broker Reference Id",
   "Transaction Type", "Order Type", "Quantity", "Price ($)", "Order Amount ($)", "Brokerage ($)"],
  ["Amazon.com, Inc.", "AMZN", "21 Apr 2025, 10:39", "21 Apr 2025, 10:39", "ref1", "BUY", "market",
   "0.813434004", "166.086", "135.1", "0.39"],
  ["Amazon.com, Inc.", "AMZN", "18 Oct 2025, 01:23 AM", "18 Oct 2025, 01:23 AM", "ref2", "SELL", "market",
   "0.813434004", "212.914", "173.1914875", "0.51"],
  ["NVIDIA Corporation", "NVDA", "10 Apr 2025, 07:33", "10 Apr 2025, 09:21", "ref3", "BUY", "limit",
   "1", "106", "106", "0.31"],
];

test("Stockal: the closed sheet is a position with its sell", () => {
  const { positions } = stockal.parseSheets({ "Profit and Loss Summary": SK_CLOSED });
  eq(positions.length, 2);
  const m = positions[0];
  eq(m.symbol, "META");
  eq(m.entryDate, "2022-06-09", "dd/mm/yyyy — 09/06/2022 is June, not September");
  eq(m.exits[0].exit_date, "2025-10-14", "and 14/10/2025 is October, which m/d/y cannot even parse");
  eq(m.quantity, 0.26955967, "a fractional share, to the last decimal");
  near(m.entryPrice, 376.54, 1e-9);
  near(m.exits[0].price, 711, 1e-9);
  near(m.exits[0].charges, 0.05, 1e-9, "the brokerage rides on the sell, where the split expects it");
  near(m.netProfit, 90.1569, 1e-9, "the file's own gain, not one we recomputed");
});

test("Stockal: the holdings sheet is what is still held", () => {
  const { positions } = stockal.parseSheets({ "Holding Statement": SK_HELD });
  eq(positions.length, 1);
  eq(positions[0].symbol, "MSFT");
  eq(positions[0].entryDate, "2025-10-17");
  eq(positions[0].quantity, 1.18999907);
  near(positions[0].entryPrice, 528.8551, 1e-9, "the average buy price, not the initial value");
  eq(positions[0].exits.length, 0);
});

test("Stockal: the disclaimer under each table is not a lost trade", () => {
  /* It was reported as a dozen skipped rows — the Groww mistake, which claims
     a loss that did not happen and sends somebody hunting for a trade. */
  const { positions, warnings } = stockal.parseSheets({
    "Profit and Loss Summary": SK_CLOSED, "Holding Statement": SK_HELD,
  });
  eq(positions.length, 3);
  eq(warnings.length, 0, "prose below the table is prose, not a warning");
});

test("INDmoney: an order book becomes positions, matched oldest first", () => {
  const { positions } = indmoney.parseRows(IM);
  const amzn = positions.find((p) => p.symbol === "AMZN");
  eq(amzn.entryDate, '2025-04-21', 'from "21 Apr 2025, 10:39"');
  eq(amzn.quantity, 0.813434004);
  near(amzn.entryPrice, 166.09, 0.01);
  eq(amzn.exits.length, 1);
  eq(amzn.exits[0].exit_date, "2025-10-18", "a meridiem in the same column as a 24-hour clock");
  near(amzn.exits[0].charges, 0.9, 0.001, "both legs' brokerage — 0.39 buying, 0.51 selling");
  near(amzn.netProfit, 38.09, 0.01);

  const nvda = positions.find((p) => p.symbol === "NVDA");
  eq(nvda.exits.length, 0, "never sold, so still held");
  eq(nvda.quantity, 1);
});

test("both are US files, and the importer refuses the other book", () => {
  eq(regionOfBroker(stockal), "US");
  eq(regionOfBroker(indmoney), "US");
  eq(regionOfBroker({ id: "zerodha" }), "IN", "an adapter with no region is an Indian report");
  const imp = read("src/components/ImportTrades.jsx");
  ok(/if \(fileRegion !== bookRegion\) \{/.test(imp));
  ok(/dollar prices in a rupee ledger/.test(imp), "the reason is stated where the check is");
});

test("the rows written carry the book, and only when it is not India", () => {
  const { positions } = stockal.parseSheets({ "Profit and Loss Summary": SK_CLOSED });
  const us = toJournalRows(positions, { broker: "stockal", region: "US", exchange: "NASDAQ" });
  eq(us.rows[0].region, "US");
  eq(us.rows[0].exchange, "NASDAQ");
  eq(us.rows[0].entry_date_source, "recorded", "the file states real dates");
  eq(us.rows[0].stop_loss, null, "and no stop, so they land in the stops queue");
  const inRows = toJournalRows(positions, { broker: "champions", region: "IN" });
  eq(inRows.rows[0].region, undefined, "an Indian import still works before migration 052");
});

test("both are registered, and ahead of the Indian readers", () => {
  const list = read("src/lib/brokers/index.js").match(/export const BROKERS = \[([^\]]+)\]/)[1];
  ok(/stockal, indmoney/.test(list));
  ok(list.indexOf("stockal") < list.indexOf("zerodha"),
     "a US file must not fall to an Indian parser by default");
  ok(BROKERS.some((b) => b.id === "stockal") && BROKERS.some((b) => b.id === "indmoney"));
});

test("each says where to find its file", () => {
  const steps = read("src/lib/brokerSteps.js");
  ok(/id: "stockal"/.test(steps) && /Tax Reports/.test(steps));
  ok(/id: "indmoney"/.test(steps) && /Order Report/.test(steps));
  ok(/matched oldest-lot-first/.test(steps), "and that INDmoney is an order book, not a statement");
});
