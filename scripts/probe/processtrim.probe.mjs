import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { reviewFindings } from "@/lib/analysis";

/**
 * THE PROCESS PAGE, CUT DOWN.
 *
 * It ran to 4.7 screens, and the length was what stopped the top third
 * landing. These pin what came off it: a card reporting an absence, three
 * tiles that were the Dashboard verbatim, a week strip too thin to say
 * anything, and the watch group opening by itself. Nothing here changes a
 * figure — only what is shown, and when.
 */

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");
const REVIEW = read("components/journal/Review.jsx");

/* Twelve scored trades and one diary entry with a mood — enough for the mood
   check to run, nowhere near enough for it to compare two moods. */
const closed = Array.from({ length: 12 }, (_, i) => ({
  id: `t${i}`, symbol: `S${i}`, status: "closed",
  entry_date: `2026-03-${String(i + 1).padStart(2, "0")}`,
  exit_date: `2026-04-${String(i + 1).padStart(2, "0")}`,
  r: i % 2 ? 1.2 : -0.8, pnl: i % 2 ? 1200 : -800,
}));
const diary = [{ id: "d1", entry_date: "2026-03-01", emotions: ["Calm"], body: "." }];

test("'not enough diary entries' is marked as an absence, not a finding", () => {
  const f = reviewFindings(closed, { diary }).findings.find((x) => x.id === "emotion-outcome");
  ok(f, "the check still runs — it is moved, not deleted");
  eq(f.absence, true, "and says it only reports something not yet recorded");
});

test("an absence joins the gaps, and takes no card", () => {
  ok(/if \(by\[f\.severity\] && !f\.absence\) by\[f\.severity\]\.push\(f\)/.test(REVIEW),
     "an absence must stay out of the severity groups");
  ok(/\{\(gaps\.length > 0 \|\| moodGap\) && \(/.test(REVIEW), "the gaps block opens for it alone");
  ok(/\{moodGap && \(\s*<div className="rv-gap"/.test(REVIEW), "as a row like the others");
  ok(/href="\/diary"/.test(REVIEW), "pointing at where it is filled in");
});

test("no stat tiles beside the verdict", () => {
  ok(!/className="rv-thesis-figs?"/.test(REVIEW), "closed / average R / won were the Dashboard verbatim");
  ok(/<h2 className="rv-thesis-h"/.test(REVIEW), "the verdict itself stays");
});

test("the week gives way to the last ten under three closed trades", () => {
  eq((REVIEW.match(/const WEEK_MIN_CLOSED = (\d+);/) || [])[1], "3");
  ok(/\{\(!showTen \|\| week\?\.trades >= WEEK_MIN_CLOSED\) && <ProcessWindow w=\{week\}/.test(REVIEW),
     "suppressed below three — but only while the last ten are there to carry the period");
  ok(/const showTen = SHOW_LAST_TEN && lastTen\?\.trades > 0;/.test(REVIEW));
});

test("every chart caption starts at the card's edge", () => {
  const notes = REVIEW.match(/<text x=\{[^}]*\}[^>]*>\{data\.axisNote\}<\/text>/g) || [];
  eq(notes.length, 2, "the bar and series charts both draw one");
  for (const n of notes) {
    ok(n.startsWith("<text x={0}"),
       `a caption hung on the label gutter moves with the longest label: ${n}`);
  }
});
