import { test, eq, ok } from "./harness.mjs";
import { reviewFindings } from "@/lib/analysis";
import { processStages } from "@/lib/bottleneck";

const find = (rows, id) => {
  const out = reviewFindings(rows, { all: rows, diary: [] });
  const list = Array.isArray(out) ? out : (out.findings || out.items || []);
  return list.find((f) => f.id === id) || null;
};
const T = (i, o = {}) => ({
  id: `t${i}`, symbol: `S${i}`, status: "closed", exchange: "NSE",
  entry_date: "2026-01-05", exit_date: "2026-02-20", quantity: 100,
  entry_price: 100, exit_price: 100, stop_loss: 90, stop_source: "recorded",
  exit_reason: "Target hit", mistakes: [], charges: 320, imported: true,
  riskPct: 1, riskAmt: 10000, exits: [], heldDays: 30,
  r: 1.6, mfe_r: 2.2, mae_r: -0.2, mfe_days: 9, became_free_on: "2026-01-12",
  is_power: false, gapped_breakeven: null, path_to: "2026-02-20", ...o,
});

/* ---- the card that could never clear ----------------------------------- */

const ACC = 10_00_000;
const L = (i, r, yr) => ({
  id: `x${i}`, symbol: `S${i}`, status: "closed", exchange: "NSE",
  entry_date: `${yr}-01-05`, exit_date: `${yr}-02-1${i % 9}`, quantity: 100,
  entry_price: 500, exit_price: r > 0 ? 570 : 470, stop_loss: 470,
  stop_source: "recorded", exit_reason: "Target hit", mistakes: [],
  r, riskPct: 1, riskAmt: 0.01 * ACC, pnl: r * 0.01 * ACC, exits: [], heldDays: 10,
});
const sins = [L(0, -2.4, 2019), L(1, -2.1, 2019), L(2, -1.9, 2019)];
const clean = (n, from) =>
  Array.from({ length: n }, (_, i) => L(100 + i, i % 3 === 0 ? -0.95 : 1.6, from + Math.floor(i / 50)));

test("three bad losses long ago cannot hold a permanent CRITICAL", () => {
  /* `bad.length >= 3` was an absolute count over the whole history, so it only
     ever went up. Measured before the fix: three such losses followed by nine
     hundred flawless trades still read critical at a 1% lifetime rate. */
  eq(find([...sins, ...clean(30, 2020)], "stop-discipline").severity, "critical",
     "three of thirteen losses IS current behaviour");
  for (const n of [120, 300, 900]) {
    eq(find([...sins, ...clean(n, 2020)], "stop-discipline").severity, "good",
       `${n} clean trades later it must be able to clear`);
  }
});

/* ---- the path findings ------------------------------------------------- */

test("nothing path-based speaks before the bars are read", () => {
  const unmeasured = Array.from({ length: 60 }, (_, i) => T(i, { path_to: null, mfe_r: null, mae_r: null }));
  for (const id of ["capture-rate", "round-trips", "power-trades", "adverse-excursion"]) {
    eq(find(unmeasured, id), null, `${id} must stay silent, not report on a fraction of the book`);
  }
});

test("the round-trip numbers reconcile in the order they are read", () => {
  const rows = [
    ...Array.from({ length: 40 }, (_, i) => T(i)),
    ...Array.from({ length: 12 }, (_, i) => T(40 + i, { r: -0.9, mfe_r: 2.6 })),
  ];
  const f = find(rows, "round-trips");
  /* Pulled by phrase rather than by position: the sentence also carries the
     1.5R threshold, and taking every number in order picked that up first. */
  const num = (re) => {
    const m = re.exec(f.detail);
    ok(m, `no match for ${re} in: ${f.detail}`);
    return parseFloat(m[1].replace("−", "-"));
  };
  const peak = num(/up ([\d.]+)R at their best closes/);
  const ended = num(/finished at (−?[\d.]+)R/);
  const trip = num(/round trip of ([\d.]+)R/);
  /* "up 21.6R, gave back 26.2R" is arithmetic but reads as an error. Naming
     where they finished is what makes the three numbers add up on the page. */
  ok(Math.abs(peak - trip - ended) < 0.15,
     `${peak} minus ${trip} should be ${ended}`);
});

test("the MAE card never argues for a wider stop in its detail", () => {
  const rows = [
    ...Array.from({ length: 26 }, (_, i) => T(i, { mae_r: -0.15 })),
    ...Array.from({ length: 14 }, (_, i) => T(30 + i, { mae_r: -0.85 })),
  ];
  const f = find(rows, "adverse-excursion");
  ok(!/wider stop/.test(f.detail), "that caveat belongs in the verdict, not the finding");
  ok(/wider stop/.test(f.verdict), "and it must still be said somewhere");
});

/* ---- the stage map ----------------------------------------------------- */

test("the path findings reach the process map", () => {
  const rows = [
    ...Array.from({ length: 34 }, (_, i) => T(i)),
    ...Array.from({ length: 14 }, (_, i) => T(40 + i, { r: -0.9, mfe_r: 2.8 })),
    ...Array.from({ length: 12 }, (_, i) => T(60 + i, { r: 0.4, mfe_r: 5.2, is_power: true, mfe_days: 3 })),
  ];
  const out = reviewFindings(rows, { all: rows, diary: [] });
  const list = Array.isArray(out) ? out : (out.findings || out.items || []);
  const exit = processStages(rows, list).stages.find((s) => s.key === "exit");
  ok(exit.findingIds.length > 0, "Exit rested on nothing at all before they were wired in");
  eq(exit.costR, null, "and they must not be costed — no baseline anybody set");
});

/* ---- size bands -------------------------------------------------------- */

test("a tie is never split across two size bands", () => {
  /* Equal-count quintiles put trades of identical size into different bands
     whenever one value is common, which it is. On a real book that produced
     "0.22–0.28%", then "0.28%", then "0.28–0.54%" — one number ending one
     band, being another, and starting a third, with no answer to which band
     a 0.28% trade was in. */
  const mk = (i, riskPct, r) => ({
    id: `z${i}`, symbol: `S${i}`, status: "closed", exchange: "NSE",
    entry_date: `2026-0${1 + (i % 9)}-05`, exit_date: `2026-0${1 + (i % 9)}-20`,
    quantity: 100, entry_price: 100, exit_price: 100, stop_loss: 90,
    stop_source: "recorded", exit_reason: "Target hit", mistakes: [], exits: [],
    riskPct, r, riskAmt: riskPct * 10000, pnl: r * riskPct * 10000, heldDays: 10,
  });
  /* A third of the book sitting on exactly 0.28, which is what broke it. */
  const rows = [];
  let i = 0;
  for (const p of [0.05, 0.10, 0.16, 0.20, 0.22, 0.25]) for (let j = 0; j < 6; j++) rows.push(mk(i++, p, 1.4));
  for (let j = 0; j < 30; j++) rows.push(mk(i++, 0.28, -0.2));
  for (const p of [0.34, 0.41, 0.54]) for (let j = 0; j < 6; j++) rows.push(mk(i++, p, 1.1));

  const f = find(rows, "conviction-inverted") || find(rows, "conviction-works");
  ok(f, "one of the conviction findings should fire on this book");

  const labels = f.chart.rows.map((r) => r.label);
  const numbers = labels.flatMap((l) => (l.match(/[\d.]+/g) || []).map(Number));
  const counts = new Map();
  for (const v of numbers) counts.set(v, (counts.get(v) || 0) + 1);
  for (const [v, c] of counts) {
    ok(c <= 2, `${v}% appears in ${c} labels — a value may end one band and start the next, no more`);
  }
  /* And no band may be a bare singleton sitting between two ranges that both
     touch it, which is the shape that had no reading at all. */
  const singles = labels.filter((l) => !l.includes("–") && l.endsWith("%"));
  for (const s of singles) {
    const v = parseFloat(s);
    const touching = labels.filter((l) => l !== s && l.includes(String(v))).length;
    eq(touching, 0, `${s} is its own band and also a boundary of ${touching} others`);
  }
});

test("the size bands carry rupees as well as R", () => {
  const mk = (i, riskPct, r) => ({
    id: `y${i}`, symbol: `S${i}`, status: "closed", exchange: "NSE",
    entry_date: `2026-0${1 + (i % 9)}-05`, exit_date: `2026-0${1 + (i % 9)}-20`,
    quantity: 100, entry_price: 100, exit_price: 100, stop_loss: 90,
    stop_source: "recorded", exit_reason: "Target hit", mistakes: [], exits: [],
    riskPct, r, riskAmt: riskPct * 10000, pnl: r * riskPct * 10000, heldDays: 10,
  });
  /* Bigger bets, worse outcomes — otherwise the correlation is zero and
     neither conviction finding has anything to say. */
  const rows = Array.from({ length: 60 }, (_, i) => mk(i, 0.1 + i * 0.01, 2.4 - i * 0.07));
  const f = find(rows, "conviction-inverted") || find(rows, "conviction-works");
  ok(f, "a finding should fire");
  ok(f.chart.rows.every((r) => r.sub && /₹/.test(r.sub)),
     "R alone does not say which band made more money");
});
