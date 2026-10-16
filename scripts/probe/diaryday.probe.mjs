import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq, near } from "./harness.mjs";
import { dayIndex, dayFacts } from "@/lib/diaryDay";
import { derivePosition } from "@/lib/positions";
import { classifyRegime, regimeIndex } from "@/lib/market";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/* Through derivePosition, as the layout does, so bankedEvents sees real rows. */
const mk = (t) => ({ ...t, ...derivePosition(t, 5e6), status: t.status, exits: t.exits });
const base = { side: "long", stop_source: "recorded", charges: 0 };

/* A: bought 1 Sep, sold half 3 Sep, rest 5 Sep (closed).
   B: bought 3 Sep, sold all 3 Sep (closed the day it opened).
   C: bought 2 Sep, still open, no sells. */
const A = mk({ ...base, id: "A", symbol: "ALPHA", status: "closed", entry_date: "2026-09-01",
  entry_price: 100, quantity: 100, stop_loss: 90, exit_date: "2026-09-05", exit_price: 120,
  exits: [{ exit_date: "2026-09-03", quantity: 50, price: 110, charges: 0 },
          { exit_date: "2026-09-05", quantity: 50, price: 120, charges: 0 }] });
const B = mk({ ...base, id: "B", symbol: "BETA", status: "closed", entry_date: "2026-09-03",
  entry_price: 200, quantity: 10, stop_loss: 190, exit_date: "2026-09-03", exit_price: 195,
  exits: [{ exit_date: "2026-09-03", quantity: 10, price: 195, charges: 0 }] });
const C = mk({ ...base, id: "C", symbol: "GAMMA", status: "open", entry_date: "2026-09-02",
  entry_price: 50, quantity: 40, stop_loss: 45, exits: [] });
const idx = dayIndex([A, B, C]);

test("what was held at the close of each day", () => {
  eq(dayFacts("2026-09-01", idx).open, 1, "A");
  eq(dayFacts("2026-09-02", idx).open, 2, "A and C");
  eq(dayFacts("2026-09-03", idx).open, 2, "A half-sold still counts; B bought and gone the same day does not");
  eq(dayFacts("2026-09-05", idx).open, 1, "A finished; C still held");
});

test("bought, closed with its R, and part-sales are banked not closed", () => {
  const d3 = dayFacts("2026-09-03", idx);
  eq(d3.entered.join(), "BETA");
  eq(d3.closed.map((c) => c.symbol).join(), "BETA", "A's half-sale is not a close");
  near(d3.closed[0].r, -0.5, 1e-9, "BETA: −5 a share on a 10 risk");
  const d5 = dayFacts("2026-09-05", idx);
  eq(d5.closed[0].symbol, "ALPHA");
  near(d5.closed[0].r, 1.5, 1e-9, "ALPHA finished at +1.5R over both sells");
});

test("banked is each sell's own money on its own day, summed across trades", () => {
  /* 3 Sep: A's half at +10 a share × 50 = +500, B's whole at −5 × 10 = −50. */
  near(dayFacts("2026-09-03", idx).banked, 450, 1e-6);
  near(dayFacts("2026-09-05", idx).banked, 1000, 1e-6, "A's second half: +20 × 50");
});

test("nothing is said that the day does not support — absent, never zero", () => {
  const d2 = dayFacts("2026-09-02", idx);
  ok(!("banked" in d2), "no sale, no banked figure — not ₹0");
  ok(!("closed" in d2));
  const before = dayFacts("2026-08-20", idx);
  ok(!("open" in before), "nothing held is absent, not '0 open'");
  eq(Object.keys(before).length, 0);
});

test("the index that day: close, move against the session before, regime", () => {
  /* A rising year of weekday closes, ending Fri 4 Sep 2026 — long enough
     for the 50- and 200-day averages the regime is read from. */
  const hist = [];
  for (let t = Date.UTC(2025, 8, 1), c = 100; hist.length < 260; t += 86400000) {
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    hist.push({ date: new Date(t).toISOString().slice(0, 10), close: c++ });
  }
  const last = hist.at(-1), prev = hist.at(-2);
  const regimes = regimeIndex(classifyRegime(hist));
  const f = dayFacts(last.date, idx, regimes);
  eq(f.index.close, last.close);
  near(f.index.movePct, (last.close - prev.close) / prev.close * 100, 1e-9, "against the session before");
  eq(f.index.regime, "uptrend");
  /* The first days have no 50-day average yet: the regime is unknown, and
     unknown is left out rather than printed. */
  eq(dayFacts(hist[3].date, idx, regimes).index.regime, null);
  ok(!("index" in dayFacts("2026-09-06", idx, regimes)), "a Sunday has no candle, so no index line");
});

test("the diary renders the strip above the note, styled as a child must be", () => {
  const d = read("components/journal/Diary.jsx");
  ok(/<DayStrip facts=\{dayFacts\(e\.entry_date, days, regimes\)\}/.test(d));
  ok(d.indexOf("<DayStrip") < d.indexOf('className="body dy-body"'), "above the note");
  ok(/const days = useMemo\(\(\) => dayIndex\(trades \|\| \[\]\), \[trades\]\);/.test(d), "the book indexed once");
  ok(/useRegimeHistory\(/.test(d), "the Process tab's index history, through the shared hook");
  const strip = d.slice(d.indexOf("function DayStrip"));
  ok(/<style jsx global>/.test(strip) && /\.dy-day /.test(strip), "global under its own prefix — it is a child component");
  ok(/<Money v=\{facts\.banked\} \/>/.test(strip) && !/rupee\(/.test(strip), "money through <Money>");
});
