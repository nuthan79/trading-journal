import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { BROKER_STEPS, stepsForRegion } from "@/lib/brokerSteps";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * WHERE TO FIND THE FILE. A new user's real barrier on Import was never the
 * import — it was finding, on a broker's site, the one report this app reads.
 */

test("every broker the importer reads has steps to find its file", () => {
  /* The registered adapters, read off the list the importer itself uses.
     Champions and SwingBot are journal-kind files — one journal's export, one
     trader's own bot — and neither has a broker site to find them on; the
     Zerodha holdings and tradebook adapters are files under Zerodha's own
     entry. Anything that IS a broker report belongs in the steps. */
  const list = read("lib/brokers/index.js").match(/export const BROKERS = \[([^\]]+)\]/)[1]
    .split(",").map((x) => x.trim());
  const brokers = list.filter((x) => !/^champions$|^swingbot$|^zerodha(Holdings|Tradebook)$/.test(x))
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
  /* Now filtered to the open book first — see the tests at the end. */
  ok(/bookSteps\.find\(\(b\) => b\.id === stepsFor\)/.test(s));
  ok(/role="tablist"/.test(s));
});

/**
 * THE TABS FOLLOW THE BOOK. A US book listed Zerodha, ICICI Direct, Groww and
 * Dhan — steps for finding files it refuses to import — and an Indian one
 * listed Stockal and INDmoney. A tab that sends somebody to a report they
 * cannot use is worse than no tab.
 */
test("every steps entry names its market, and matches its adapter", () => {
  const brokers = read("lib/brokers/index.js");
  for (const b of BROKER_STEPS) {
    ok(b.region === "IN" || b.region === "US", `${b.id} says which market it is`);
    if (b.region === "US") {
      /* The adapter must agree, or the screen offers steps for a file the
         importer then refuses. */
      const adapter = read(`lib/brokers/${b.id}.js`);
      ok(/export const region = "US";/.test(adapter), `${b.id}'s adapter says US too`);
    }
  }
  ok(/stockal, indmoney/.test(brokers));
});

test("a book is shown its own brokers and no others", () => {
  eq(stepsForRegion("US").map((b) => b.id).join(","), "stockal,indmoney");
  const india = stepsForRegion("IN").map((b) => b.id);
  ok(india.includes("zerodha") && india.includes("dhan"));
  ok(!india.includes("stockal") && !india.includes("indmoney"));
  eq(stepsForRegion().map((b) => b.id).join(","), india.join(","), "no market named means India");
});

test("the screen opens on a broker that is actually listed", () => {
  const src = read("components/ImportTrades.jsx");
  ok(/const bookSteps = stepsForRegion\(bookRegion\);/.test(src));
  ok(/bookSteps\.find\(\(b\) => b\.id === stepsFor\) \|\| bookSteps\[0\]/.test(src),
     "a fixed \"zerodha\" default showed Indian steps in a US book");
  ok(!/BROKER_STEPS\.map/.test(src), "and the full list is never rendered");
});
