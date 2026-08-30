import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, eq } from "./harness.mjs";

/**
 * A BACKTICK INSIDE A styled-jsx BLOCK ENDS THE TEMPLATE LITERAL.
 *
 * `<style jsx>{` ... `}</style>` is a template literal, so a backtick in the
 * CSS — almost always inside a comment, quoting a property name or a value —
 * terminates it and the file stops parsing. The error surfaces dozens of
 * lines later at whatever token followed, which is why it never looks like
 * what it is.
 *
 * I have done this five times in one session on this codebase, each time
 * while writing a comment explaining a layout decision, and each time the
 * build caught it only after the edit had been made and pushed through a
 * dev-server reload. It is a mechanical mistake with a mechanical check.
 */

const ROOT = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.jsx?$/.test(e.name)) files.push(full);
  }
})(ROOT);

test("no backtick inside a styled-jsx block", () => {
  const offenders = [];

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    /* Every <style jsx ...>{` ... `}</style>, taken as the text between the
       opening brace-backtick and the closing backtick-brace. */
    const re = /<style\s+jsx[^>]*>\{`/g;
    let m;
    while ((m = re.exec(src))) {
      const start = m.index + m[0].length;
      const end = src.indexOf("`}", start);
      if (end === -1) continue;
      const block = src.slice(start, end);
      if (!block.includes("`")) continue;
      const line = src.slice(0, start + block.indexOf("`")).split("\n").length;
      offenders.push(`${path.relative(ROOT, file)}:${line}`);
    }
  }

  eq(offenders.length, 0,
     `a backtick here ends the template literal and the file stops parsing: ${offenders.join(", ")}`);
});
