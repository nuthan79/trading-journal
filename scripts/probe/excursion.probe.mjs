import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { excursion } from "@/lib/path";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/* A trade with a real stop the way stops.js recognises one. */
const base = {
  symbol: "SOLARINDS", side: "long", entry_price: 18385, stop_loss: 18020,
  quantity: 70, entry_date: "2026-07-31", status: "closed", exit_date: "2026-09-15",
};

test("a measured trade shows its stored MFE and MAE", () => {
  const x = excursion({ ...base, mfe_r: 8.9, mae_r: -0.4, path_to: "2026-09-15" });
  eq(x.state, "measured");
  eq(x.mfe, 8.9);
  eq(x.mae, -0.4);
  eq(x.stale, false);
});

/* PostgREST can hand a numeric column back as a string. Sorting a column of
   "8.9" and "10.1" as text puts 10.1 first. */
test("a numeric column that arrives as a string is still a number", () => {
  const x = excursion({ ...base, mfe_r: "10.1", mae_r: "-0.25", path_to: "2026-09-15" });
  eq(typeof x.mfe, "number");
  eq(x.mfe, 10.1);
  eq(x.mae, -0.25);
});

test("the three dashes say three different things", () => {
  const noStop = excursion({ ...base, stop_loss: null, mfe_r: 3, path_to: "2026-09-15" });
  eq(noStop.state, "no-stop", "a stored figure without a real stop is not shown");
  ok(!Number.isFinite(noStop.mfe));

  const closedTodo = excursion({ ...base, path_to: null });
  eq(closedTodo.state, "unmeasured");
  ok(/Analysis/.test(closedTodo.why), "a closed trade is measured from Analysis");

  const openTodo = excursion({ ...base, status: "open", exit_date: null, path_to: null });
  ok(/Holdings/.test(openTodo.why), "an open one is measured by refreshing Holdings");

  const noBars = excursion({ ...base, path_to: "2026-09-15", mfe_r: null, mae_r: null });
  eq(noBars.state, "no-bars");
});

test("zero is a figure, not a missing one", () => {
  const x = excursion({ ...base, mfe_r: 0, mae_r: 0, path_to: "2026-09-15" });
  eq(x.state, "measured");
  eq(x.mfe, 0, "a trade that never closed above entry has an MFE of 0R, not a dash");
});

/**
 * A position measured while open and sold since. What was measured did
 * happen, so it shows — but marked, because the end of the trade, which is
 * where SOLARINDS gave back four R, is not in it.
 */
test("a reading that stops before the exit is marked stale", () => {
  const x = excursion({ ...base, mfe_r: 8.9, mae_r: -0.4, path_to: "2026-09-01" });
  eq(x.state, "measured");
  eq(x.stale, true);
  eq(excursion({ ...base, mfe_r: 1, mae_r: 0, path_to: "2026-09-13" }).stale, false,
    "within three days of the exit counts as reaching it, as needsMeasuring allows");
  eq(excursion({ ...base, status: "open", exit_date: null, mfe_r: 1, mae_r: 0,
                 path_to: "2026-08-01" }).stale, false,
    "an open position has no exit to fall short of");
});

/**
 * THE FOOTER SPANS HAVE TO ADD UP TO THE HEADER.
 *
 * Two columns in the header and not in the footer's trailing span slide the
 * whole totals row out from under its headings, with nothing erroring. The
 * comment above that footer has warned about exactly this since the table was
 * 21 columns wide.
 */
test("the Trades footer spans exactly as many columns as the header", () => {
  const src = read("components/journal/Trades.jsx");
  const thead = src.slice(src.indexOf("<thead"), src.indexOf("</tr></thead>"));
  const headers = (thead.match(/\{th\(/g) || []).length + (thead.match(/<th[\s>]/g) || []).length;

  const tfoot = src.slice(src.indexOf('<tr className="tr-tot">'), src.indexOf("</tfoot>"));
  const cells = [...tfoot.matchAll(/<td(?:\s[^>]*?)?(?:colSpan=\{(\d+)\})?[^>]*>/g)];
  const footer = cells.reduce((a, m) => a + (m[1] ? Number(m[1]) : 1), 0);

  eq(footer, headers, `header has ${headers} columns, footer spans ${footer}`);
});

test("MFE and MAE come after RS and before the actions column", () => {
  const src = read("components/journal/Trades.jsx");
  const rs = src.indexOf('th("rs_rank"');
  const mfe = src.indexOf('th("mfe"');
  const mae = src.indexOf('th("mae"');
  ok(rs > 0 && mfe > rs && mae > mfe, "RS, then MFE, then MAE");
});
