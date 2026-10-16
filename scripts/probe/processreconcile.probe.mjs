import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { reconcileFindings } from "@/lib/analysis";
import { LOSING_RUN_ALERT } from "@/lib/bottleneck";

/**
 * THE PROCESS PAGE MUST NOT ARGUE WITH ITSELF.
 *
 * Read top to bottom it once said a trader's sizing was leaking ₹4.99 L and,
 * three cards down, that the same sizing was disciplined and trustworthy; and
 * it said "cut risk per trade" in the losing-run card while a finding below
 * said "there is room to size up". Each check was right about its own
 * question. These pin which statement stands when two collide — and that
 * neither is deleted when it is the only thing said about its subject.
 */

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");
const F = (id, extra = {}) => ({ id, severity: "info", title: id, detail: `${id}.`, ...extra });
const ids = (fs) => fs.map((f) => f.id);

const CONSISTENT = F("risk-consistent", { severity: "good", evidence: { avgRiskPct: 0.98, coeffVariation: 0.21 } });
const INVERTED = F("conviction-inverted", { severity: "warning", detail: "Betting the same each time would have made more." });
const BELOW = F("risk-below-edge", { severity: "info" });

/* A book whose newest entries are all losers — a live run of `n`. */
const day = (i) => `2026-09-${String(10 + i).padStart(2, "0")}`;
const run = (n) => [
  { entry_date: "2026-09-01", r: 3, symbol: "WIN" },
  ...Array.from({ length: n }, (_, i) => ({ entry_date: day(i), r: -1, symbol: `L${i}` })),
];

test("risk-consistent is silent while conviction-inverted fires", () => {
  const out = reconcileFindings([CONSISTENT, INVERTED], []);
  eq(ids(out).join(","), "conviction-inverted", "only the warning stands");
});

test("and its dispersion figure is folded into the warning, not lost", () => {
  const w = reconcileFindings([CONSISTENT, INVERTED], []).find((f) => f.id === "conviction-inverted");
  ok(w.detail.startsWith(INVERTED.detail), "the warning's own detail comes first");
  ok(w.detail.includes("0.98% average risk"), "the average risk is carried over");
  ok(w.detail.includes("0.21"), "the variation coefficient is carried over");
  eq(w.severity, "warning", "and it stays a warning");
});

test("risk-consistent fires alone when nothing contradicts it", () => {
  const out = reconcileFindings([CONSISTENT], []);
  eq(ids(out).join(","), "risk-consistent");
  eq(out[0].detail, CONSISTENT.detail, "untouched");
});

test("risk-below-edge is silent during a live losing run", () => {
  const out = reconcileFindings([BELOW, CONSISTENT], run(LOSING_RUN_ALERT));
  ok(!ids(out).includes("risk-below-edge"), "no size-up advice beside 'cut risk'");
  ok(ids(out).includes("risk-consistent"), "and nothing else is touched");
});

test("and fires when the run is shorter than the alert's", () => {
  ok(ids(reconcileFindings([BELOW], run(LOSING_RUN_ALERT - 1))).includes("risk-below-edge"),
     "the gate is the losing-run card's own threshold, not a looser one");
  ok(ids(reconcileFindings([BELOW], [])).includes("risk-below-edge"), "and with no run at all");
});

test("reviewFindings reconciles before it ranks", () => {
  const src = read("lib/analysis.js");
  const body = src.slice(src.indexOf("export function reviewFindings("));
  const at = body.indexOf("reconcileFindings(flat, closed)");
  ok(at > 0, "reviewFindings calls reconcileFindings");
  ok(at < body.indexOf(".sort("), "before the severity sort");
});

test("the concentration finding says what its test shows", () => {
  const src = read("lib/analysis.js");
  ok(src.includes('"The edge survives without your best trades"'), "the new good-case title");
  ok(!src.includes('"Your returns are spread across many trades"'),
     "the old one sat over '55% from your best 14' — concentration, not spread");
});
