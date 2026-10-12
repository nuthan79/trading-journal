import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok } from "./harness.mjs";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const s = readFileSync(path.join(SRC, "components/journal/Holdings.jsx"), "utf8");

/*
 * WHAT MARGIN IS CARRYING, IN A BOX OF ITS OWN. The amount borrowed, what it
 * costs a day and so far — moved out from under Today at the user's request,
 * because the borrowing is a figure about the open book, not about today.
 */
test("the amount borrowed is the shares still held, less the trader's own part", () => {
  ok(/mtfFunded: sum\(\(r\) => \(isMtf\(r\.mtf_leverage\) && r\.qtyOpen > 0\s*\? r\.qtyOpen \* Number\(r\.entry_price\) \* \(1 - 1 \/ Number\(r\.mtf_leverage\)\) : 0\)\)/.test(s),
     "qtyOpen × entry × (1 − 1/leverage), open margin positions only");
});

test("the box shows only for a market with margin and something held on it", () => {
  ok(/const mtfBox = mtfHere && totals\.mtfFunded > 0;/.test(s));
  ok(/\{mtfBox && \(\s*<Summary\s+label="MTF"\s+value=\{<Money v=\{totals\.mtfFunded\} \/>\}/.test(s), "drawn from the borrowed amount");
  ok(/sub=\{totals\.mtfN > 0 \? `−\$\{money\(totals\.mtfPerDay\)\} a day`/.test(s), "the daily cost under it");
  ok(/foot=\{totals\.mtfN > 0 \? money\(totals\.mtfSoFar\) : null\}\s+footLabel="so far"/.test(s), "and the cost so far");
});

test("it sits after Exposure, and Today no longer carries the MTF line", () => {
  ok(s.indexOf('label="MTF"') > s.indexOf('label="Exposure"'), "after Exposure");
  const today = s.slice(s.indexOf('label="Today"'), s.indexOf('label="Unrealised"'));
  ok(!/mtf/i.test(today), "Today is about today");
});

test("seven boxes keep every row full when the strip wraps", () => {
  ok(/data-n=\{mtfBox \? 7 : 6\}/.test(s));
  ok(/\.ps-strip\[data-n="7"\] \{ grid-template-columns: repeat\(7, 1fr\); \}/.test(s));
  ok(/\.ps-strip\[data-n="7"\] \{ grid-template-columns: repeat\(4, 1fr\); \}\s*\.ps-strip\[data-n="7"\] > :last-child \{ grid-column: span 2; \}/.test(s),
     "four a row, the last figure across two cells");
});
