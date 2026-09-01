import { test, eq, ok } from "./harness.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chartWindow, windowsFor, barsFor, overlays, hasBars, barsKey,
         LEAD_DAYS, TRAIL_DAYS } from "@/lib/candles";
import { barsKeyFor } from "@/lib/bars";

const TODAY = "2026-09-01";
const T = (o = {}) => ({ id: "t1", symbol: "RELIANCE", exchange: "NSE",
  status: "closed", entry_date: "2026-05-10", exit_date: "2026-06-02",
  entry_price: 100, quantity: 100, stop_loss: 93, stop_source: "recorded",
  exits: [{ exit_date: "2026-06-02", quantity: 100, price: 120 }], ...o });

test("an open position is charted up to today, a closed one past its exit", () => {
  /* The user's first requirement: "for holding you have to show the current
     trends for sure i mean today candle." */
  const open = chartWindow(T({ status: "open", exit_date: null }), TODAY);
  eq(open.to, TODAY, "an open position must run to today's candle");

  const closed = chartWindow(T(), TODAY);
  ok(closed.to > "2026-06-02", "a closed trade shows what happened after the exit");
  ok(closed.to < TODAY, "but it stops, rather than running to today");
  ok(closed.from < "2026-05-10", "and starts before entry, to show the base");

  /* Never past today: there are no bars from the future, and asking for them
     makes the read-through cache see a hole it can never fill — which would
     send every chart upstream on every open. */
  const recent = chartWindow(T({ exit_date: TODAY }), TODAY);
  eq(recent.to, TODAY);
  eq(chartWindow({ entry_date: null }), null);
  eq(chartWindow(null), null);
});

test("one fetch per listing, not per trade", () => {
  const a = T({ id: "a", entry_date: "2026-01-05", exit_date: "2026-02-01" });
  const b = T({ id: "b", entry_date: "2026-06-01", exit_date: "2026-07-01" });
  const w = windowsFor([a, b], TODAY);
  eq(w.length, 1, "two trades in one symbol are one request");
  eq(w[0].from, chartWindow(a, TODAY).from, "the union reaches the earlier start");
  eq(w[0].to, chartWindow(b, TODAY).to, "and the later end");

  eq(windowsFor([a, T({ id: "c", symbol: "TCS" })], TODAY).length, 2);
  /* A dual listing is two listings, and .NS and .BO are different series. */
  eq(windowsFor([a, T({ id: "d", exchange: "BSE" })], TODAY).length, 2);
});

test("each chart draws only its own window out of the listing's bars", () => {
  const bars = [];
  for (let d = 1; d <= 28; d++) bars.push({ d: `2026-05-${String(d).padStart(2, "0")}`, c: 100 });
  /* Keyed with the real builder, not a literal — a literal is how this probe
     kept passing while the wire format underneath it changed. */
  const trade = T({ entry_date: "2026-05-20", exit_date: "2026-05-25" });
  const mine = barsFor(trade, { [barsKey(trade)]: bars }, TODAY);
  ok(mine.length > 0 && mine.length <= bars.length);
  eq(barsFor(T(), {}, TODAY).length, 0, "no bars for the listing is not a crash");
});

test("every exit gets a marker, on a session that exists", () => {
  /* The reference draws one dot on a 55%-closed position. Lightweight Charts
     also DROPS a marker whose time is not one of the series' own points, so a
     weekend exit would silently not be drawn at all. */
  const bars = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-08"]
    .map((d) => ({ d, c: 100 }));
  const o = overlays(T({
    quantity: 100,
    exits: [{ exit_date: "2026-06-02", quantity: 40, price: 110 },
            { exit_date: "2026-06-06", quantity: 35, price: 120 }],   // a Saturday
  }), bars);

  eq(o.exits.length, 2, "both tranches are marked");
  eq(o.exits[0].time, "2026-06-02");
  eq(o.exits[1].time, "2026-06-08", "a weekend exit lands on the next real session");
  eq(Math.round(o.exitShare[0]), 40, "the marker can say how much came off");
  eq(Math.round(o.exitShare[1]), 35);
  eq(o.fullyOut, false, "75% sold is not out");

  const gone = overlays(T({ quantity: 100,
    exits: [{ exit_date: "2026-06-02", quantity: 100, price: 110 }] }), bars);
  eq(gone.fullyOut, true);
});

test("a stop nobody set is not drawn as a decision", () => {
  const bars = [{ d: "2026-05-10", c: 100 }, { d: "2026-06-02", c: 120 }];
  eq(overlays(T(), bars).stop, 93, "a recorded stop gets its line");
  eq(overlays(T({ stop_source: "assumed" }), bars).stop, null,
     "an assumed stop must not be drawn as one the trader chose");
  eq(overlays(T({ stop_source: "assumed" }), bars).assumedStop, 93,
     "but it is still shown, faintly and unlabelled");
  eq(overlays(T({ stop_source: "none" }), bars).stop, null);
  eq(overlays(T({ stop_loss: null, stop_source: null }), bars).stop, null);
});

test("an entry outside the window does not fabricate a marker", () => {
  /* landOn returns the first session at or after the date; with none, null —
     and a marker with a null time would be dropped by the library anyway. */
  const bars = [{ d: "2026-01-05", c: 100 }, { d: "2026-01-06", c: 101 }];
  eq(overlays(T({ entry_date: "2026-12-01" }), bars).entry.time, null);
  eq(overlays(T(), []).exits.length, 0);
  eq(hasBars([]), false);
  eq(hasBars([{ d: "x" }]), false, "one bar is not a chart");
  eq(hasBars([{ d: "x" }, { d: "y" }]), true);
});


test("client and server agree on how a listing is named", () => {
  /* THE BUG THIS IS FOR. /api/bars returns its bars keyed by a string, and
     the chart wall rebuilt that string to look them up. The route speaks
     "SYMBOL:EXCHANGE"; the wall invented "SYMBOL|EXCHANGE". Nothing failed —
     the request went out, the bars came back, every lookup missed, and all
     twenty-four charts said "Not measured yet", which is indistinguishable
     from the data genuinely being absent.

     A mismatch between two halves of a wire format is not a crash. It is
     silence that looks like an empty result, and no build or type can see it. */
  eq(barsKeyFor("RELIANCE", "NSE"), "RELIANCE:NSE");
  eq(barsKeyFor("reliance", "nse"), "RELIANCE:NSE", "normalised the way the route does");
  eq(barsKeyFor(" TCS ", undefined), "TCS:NSE", "exchange defaults, symbol is trimmed");
  eq(barsKey({ symbol: "RELIANCE", exchange: "NSE" }), barsKeyFor("RELIANCE", "NSE"));

  /* And nobody may build it by hand again — in either direction. */
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  for (const f of ["src/app/api/bars/route.js", "src/lib/measure.js",
                   "src/lib/candles.js", "src/components/journal/ChartWall.jsx"]) {
    const src = readFileSync(path.join(root, f), "utf8");
    const hand = src.match(/\$\{[^}]*symbol[^}]*\}[:|]\$\{[^}]*exchange[^}]*\}/g) || [];
    eq(hand.length, 0, `${f} builds the bars key by hand: ${hand.join(", ")}`);
    ok(/barsKeyFor/.test(src), `${f} does not use barsKeyFor at all`);
  }
});
