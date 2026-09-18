import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { BROKER_STEPS } from "@/lib/brokerSteps";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * WHERE TO FIND THE FILE. A new user's real barrier on Import was never the
 * import — it was finding, on a broker's site, the one report this app reads.
 */

test("every broker the importer reads has steps to find its file", () => {
  /* The registered adapters, read off the list the importer itself uses.
     Champions is a journal export, not a broker report; the Zerodha holdings
     and tradebook adapters are files under Zerodha's own entry. */
  const list = read("lib/brokers/index.js").match(/export const BROKERS = \[([^\]]+)\]/)[1]
    .split(",").map((x) => x.trim());
  const brokers = list.filter((x) => !/^champions$|^zerodha(Holdings|Tradebook)$/.test(x))
    .map((x) => x.toLowerCase());
  const ids = BROKER_STEPS.map((b) => b.id);
  for (const b of brokers) ok(ids.includes(b), `${b} can be imported but has no steps`);
});

test("Zerodha lists all three files it can import", () => {
  const z = BROKER_STEPS.find((b) => b.id === "zerodha");
  eq(z.files.map((f) => f.name).join(" | "), "Tax P&L | Holdings | Tradebook — optional");
});

test("each file says what it is for, and has steps", () => {
  for (const b of BROKER_STEPS) for (const f of b.files) {
    ok(f.what && f.name, `${b.label}: a file with no purpose or name`);
    ok(f.steps.length >= 3, `${b.label} ${f.name}: too few steps to follow`);
  }
});

test("the steps say where they came from, and when", () => {
  const s = read("lib/brokerSteps.js");
  ok(/checked 2026-09-18/.test(s), "a date to know when they may be stale");
  for (const host of ["support.zerodha.com", "icicidirect.com", "groww.in", "dhan.co"]) {
    ok(s.includes(host), `no source recorded for ${host}`);
  }
});

test("the import screen shows one broker's steps at a time", () => {
  const s = read("components/ImportTrades.jsx");
  ok(/BROKER_STEPS\.find\(\(b\) => b\.id === stepsFor\)/.test(s));
  ok(/role="tablist"/.test(s));
});
