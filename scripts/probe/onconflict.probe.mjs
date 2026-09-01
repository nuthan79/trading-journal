import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok } from "./harness.mjs";

/**
 * Every ON CONFLICT target must name a real constraint.
 *
 * WHY THIS EXISTS. 043 declared its uniqueness as
 *
 *     create unique index ... on saved_filters (user_id, lower(name))
 *
 * and db.js asked for `onConflict: "user_id,name"`. Postgres will not match a
 * conflict target of plain columns against an EXPRESSION index, so every save
 * of a new view failed with "there is no unique or exclusion constraint
 * matching the ON CONFLICT specification". Both halves were valid on their
 * own; only together were they wrong, and nothing between writing them said
 * so — the build passed, and the probes stub the database.
 *
 * That is the third bug to reach the user through a stubbed seam. This is the
 * cheap static half of the fix: the SQL and the JS are read side by side and
 * made to agree, without a database.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

const read = (p) => readFileSync(p, "utf8");
const sqlFiles = readdirSync(path.join(root, "supabase"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => path.join(root, "supabase", f));

const jsFiles = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(full); }
    else if (/\.(js|jsx|mjs)$/.test(e.name)) jsFiles.push(full);
  }
})(path.join(root, "src"));

const cols = (s) => s.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
const key = (list) => [...list].sort().join(",");
/* lower(name), coalesce(x, y), (a || b) — anything that is not a bare
   identifier makes the index unmatchable by a plain conflict target. */
const isExpression = (list) => list.some((c) => !/^[a-z_][a-z0-9_]*$/.test(c));

function constraintsIn(sql) {
  const plain = new Set(), expression = new Set();
  const add = (raw) => {
    const list = cols(raw);
    if (!list.length) return;
    (isExpression(list) ? expression : plain).add(key(list));
  };
  /* primary key (a, b, c) — the table-level form; the inline
     "id uuid primary key" form is a single column and is caught below. */
  for (const m of sql.matchAll(/primary\s+key\s*\(([^)]*)\)/gi)) add(m[1]);
  for (const m of sql.matchAll(/^\s*([a-z_][a-z0-9_]*)\s+[a-z]+[^,\n]*\bprimary\s+key\b/gim))
    add(m[1]);
  for (const m of sql.matchAll(/create\s+unique\s+index[^(]*\(([^;]*?)\)\s*;/gis)) add(m[1]);
  for (const m of sql.matchAll(/\bunique\s*\(([^)]*)\)/gi)) add(m[1]);
  return { plain, expression };
}

const ALL = { plain: new Set(), expression: new Set() };
for (const f of sqlFiles) {
  const { plain, expression } = constraintsIn(read(f));
  for (const k of plain) ALL.plain.add(k);
  for (const k of expression) ALL.expression.add(k);
}

/* ------------------------------------------------------------------ */

test("the schema declares constraints this probe can actually see", () => {
  /* A parser that silently matched nothing would let every assertion below
     pass while the bug it exists for sat in the code. Counting is the wrong
     self-check — the schema really does have only two distinct plain SHAPES,
     since almost every table is keyed on a bare id. So each of the three
     forms that have to be recognised is named instead. */
  const seen = `plain [${[...ALL.plain].join("] [")}] expression [${[...ALL.expression].join("] [")}]`;
  ok(ALL.plain.has("id"), `inline "id uuid primary key" not parsed — ${seen}`);
  ok(ALL.plain.has("d,exchange,symbol"),
     `table-level "primary key (symbol, exchange, d)" not parsed — ${seen}`);
  ok(ALL.expression.has("lower(name),user_id"),
     `the expression index this probe was written for was not parsed — ${seen}`);
});

test("every onConflict target matches a plain unique constraint", () => {
  let checked = 0;
  for (const f of jsFiles) {
    const src = read(f);
    for (const m of src.matchAll(/onConflict:\s*["'`]([^"'`]+)["'`]/g)) {
      const target = cols(m[1]);
      const k = key(target);
      const where = `${path.relative(root, f)} → onConflict: "${m[1]}"`;
      checked++;

      ok(!ALL.expression.has(k) || ALL.plain.has(k),
         `${where} names the columns of an EXPRESSION index. Postgres cannot ` +
         `match a plain conflict target to one — this is the 043 bug.`);

      ok(ALL.plain.has(k),
         `${where} has no matching primary key or plain unique constraint in ` +
         `supabase/*.sql. Declared: [${[...ALL.plain].join("] [")}]`);
    }
  }
  ok(checked > 0, "no onConflict targets were found to check — has the syntax changed?");
});

test("uniqueness that is enforced case-insensitively is not upserted onto", () => {
  /* The narrower statement of the same rule, kept separate because it is the
     one that will recur: somebody adds lower(name) to an index to stop two
     views differing only in capitals, and reaches for upsert out of habit. */
  for (const k of ALL.expression) {
    const bare = key(cols(k).map((c) => {
      const m = /^[a-z_]+\(\s*([a-z_][a-z0-9_]*)\s*\)$/.exec(c);
      return m ? m[1] : c;
    }));
    for (const f of jsFiles) {
      for (const m of read(f).matchAll(/onConflict:\s*["'`]([^"'`]+)["'`]/g)) {
        ok(key(cols(m[1])) !== bare || ALL.plain.has(bare),
           `${path.relative(root, f)} upserts on "${m[1]}", but the only ` +
           `constraint covering those columns is the expression index (${k}). ` +
           `Look the row up first, or drop the expression from the index.`);
      }
    }
  }
});
