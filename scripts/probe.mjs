/**
 * npm run probe — the checks a build cannot make.
 *
 * WHY THIS EXISTS. `npm run build` compiles. It said "Compiled successfully"
 * over a card that took the whole Review screen to an error boundary, over a
 * measurement that read every symbol as unreadable, over a chart printing two
 * captions on top of each other, and over a stop-discipline card that could
 * never clear however well anybody traded. Every one of those is valid
 * JavaScript. The compiler was never going to be the thing that caught them.
 *
 * These are not unit tests in the thorough sense and are not trying to be.
 * Each case is a bug that actually shipped, or one caught the day it was
 * written, kept so it cannot come back quietly.
 */

import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cases } from "./probe/harness.mjs";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "probe");
const only = process.argv[2];

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".probe.mjs"))
  .filter((f) => !only || f.includes(only))
  .sort();

if (!files.length) {
  console.error(only ? `No probe matching "${only}".` : "No probes found.");
  process.exit(1);
}

for (const f of files) await import(path.join(DIR, f));

let pass = 0;
const failed = [];

for (const c of cases) {
  try {
    await c.fn();
    pass++;
  } catch (err) {
    failed.push({ name: c.name, message: err?.message || String(err) });
  }
}

for (const f of failed) console.log(`  FAIL  ${f.name}\n        ${f.message}`);
console.log(
  `\n${pass} passed${failed.length ? `, ${failed.length} FAILED` : ""} ` +
  `— ${files.length} file${files.length === 1 ? "" : "s"}`
);
process.exit(failed.length ? 1 : 0);
