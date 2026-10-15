import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { exitVerdict } from "@/lib/giveback";
import { COLUMN_HINTS } from "@/lib/columns";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const s = readFileSync(path.join(SRC, "components/journal/Edge.jsx"), "utf8");

/*
 * THE EXIT TAGS LEAVE THE MISTAKES TABLE. They select winners by construction
 * — you only write "Sold a little late" on a trade that ran — so under a
 * heading that says "cost" they read +1.47R and +4.10R.
 */
test("the mistakes table no longer carries the exit-timing tags", () => {
  ok(/const EXIT_TAGS = \[LATE, EARLY\];/.test(s));
  ok(/const LATE = "Sold a little late";/.test(s) && /const EARLY = "Sold too early";/.test(s));
  ok(/mistakeCost\(closed, isExecutionError\)\.filter\(\(m\) => !EXIT_TAGS\.includes\(m\.tag\)\)/.test(s),
     "filtered out of the rows the table draws");
});

test("What the exits cost sits under the mistakes and reads the giveback measures", () => {
  const mist = s.indexOf("What the mistakes cost"), exits = s.indexOf("What the exits cost</div>");
  const outcome = s.indexOf("What didn&rsquo;t work");
  ok(mist > 0 && exits > mist && exits < outcome, "between the mistakes and what didn't work");
  ok(/const book = givebackBook\(closed\);/.test(s) && /givebackByTag\(closed, LATE\)/.test(s), "driven by the book and the tag comparison");
  ok(/postExitNeeded\(closed, EARLY\)/.test(s), "and lists what selling early would need");
});

test("money through <Money>, headers through COLUMN_HINTS, rows link to their trades", () => {
  const sec = s.slice(s.indexOf("What the exits cost</div>"), s.indexOf("What didn&rsquo;t work"));
  ok(/<Money v=\{row\.money\} \/>/.test(sec), "money cell is <Money>");
  ok(!/rupee\(/.test(sec), "no bare rupee()");
  for (const k of ["exitTrades", "exitGivebackR", "exitGivebackMoney", "exitKept", "exitVerdict"]) {
    ok(new RegExp(`title=\\{COLUMN_HINTS\\.${k}\\}`).test(sec), `${k} header hover`);
    ok(COLUMN_HINTS[k] && COLUMN_HINTS[k].length > 20, `${k} has a hint`);
  }
  ok(/href=\{`\/trades\?mistake=\$\{encodeURIComponent\(row\.label\)\}`\}/.test(sec), "the tag row links like a mistake row");
});

/* Selling early needs bars after the exit, which the measure never fetches.
   It is named and counted, and not estimated. */
test("Sold too early is stated, counted and not estimated", () => {
  const sec = s.slice(s.indexOf("What the exits cost</div>"), s.indexOf("What didn&rsquo;t work"));
  ok(/\{exits\.early\.count\} trade/.test(sec), "the count");
  ok(/prices from after the exit/.test(sec) && /It is not estimated\./.test(sec), "and says why it is not costed");
  ok(!/early\.[a-z]*[Gg]iveback/.test(sec), "nothing computes a giveback for it");
});

test("the verdict has four answers", () => {
  const c = (o) => ({ tagged: { count: 10 }, untagged: { count: 12 }, comparable: true, gap: 0, ...o });
  ok(/^Too few to say — 3 tagged, 20 not/.test(exitVerdict(c({ comparable: false, tagged: { count: 3 }, untagged: { count: 20 } })).word));
  eq(exitVerdict(c({ gap: 1.2, tagIsReal: true })).word, "Real — these gave back 1.20R more than the rest");
  eq(exitVerdict(c({ gap: 0.1, tagIsNoise: true })).word, "Noise — no more given back than untagged trades");
  eq(exitVerdict(c({ gap: -0.8 })).word, "Backwards — these gave back 0.80R less than the rest");
  eq(exitVerdict(null).word, "—");
});
