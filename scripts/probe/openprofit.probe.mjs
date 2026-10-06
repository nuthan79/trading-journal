import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq, near } from "./harness.mjs";
import { openProfitAlert, OPEN_PROFIT_SHARE } from "@/lib/openProfit";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");
const pos = (...u) => u.map((unrealisedPnl, i) => ({ id: `p${i}`, unrealisedPnl }));

/* The user's own line: ₹5L of open profit on a ₹50L account. */
test("fires at a tenth of the account, not below it", () => {
  eq(OPEN_PROFIT_SHARE, 0.10);
  ok(openProfitAlert(pos(300000, 200000), 5000000), "₹5L on ₹50L must fire");
  ok(!openProfitAlert(pos(300000, 199999), 5000000), "a rupee short must not");
  near(openProfitAlert(pos(400000, 200000), 5000000).share, 12, 1e-9);
});

test("the line scales with the account", () => {
  ok(openProfitAlert(pos(20000), 200000), "₹20k on a ₹2L account is a tenth");
  ok(!openProfitAlert(pos(500000), 50000000), "₹5L on ₹5Cr is one percent");
});

/* An open loser does not make the winners' gains any safer. */
test("counts the winners only", () => {
  const a = openProfitAlert(pos(400000, 200000, -150000, -50000), 5000000);
  ok(a, "₹6L of winners must fire though the book nets to ₹4L");
  eq(a.profit, 600000);
  eq(a.winners, 2);
});

test("unpriced positions add nothing, and no account size means no alert", () => {
  eq(openProfitAlert(pos(600000, NaN), 5000000).winners, 1);
  eq(openProfitAlert(pos(600000), 0), null, "an unset account size must not fire");
});

test("Holdings shows it from the account size the user set, not the ₹10L stand-in", () => {
  const page = read("app/(app)/holdings/page.jsx");
  ok(/regionSettings\(profile, bookRegion\)\.account_size/.test(page), "page reads the funded figure");
  ok(/accountSize=\{funded\}/.test(page), "and hands that to Holdings");
  ok(!/accountSize[,\s]*\}\s*=\s*useJournal/.test(page), "never the layout's fallback");
  ok(/<OpenProfitAlert open=\{open\} accountSize=\{accountSize\} \/>/.test(read("components/journal/Holdings.jsx")),
     "Holdings renders the card");
});
