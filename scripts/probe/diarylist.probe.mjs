import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { filterDiary, monthsOf, emotionsOf, monthLabel, monthOf } from "@/lib/diaryList";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/* Newest first, as the layout hands them over. */
const DIARY = [
  { id: "a", entry_date: "2026-10-14", emotions: ["Anxious"], body: "Sized up after two losses. Revenge, plainly." },
  { id: "b", entry_date: "2026-10-02", emotions: ["Calm", "Confident"], body: "VCP in HFCL, waited for volume." },
  { id: "c", entry_date: "2026-09-28", emotions: ["Anxious"], body: "Market weak. Sizing down." },
  { id: "d", entry_date: "2026-08-03", emotions: [], body: "" },
];

/* A YEAR OF ENTRIES HAS TO BE FINDABLE, not scrolled. */
test("search matches every word, in any order, ignoring case", () => {
  eq(filterDiary(DIARY, { q: "revenge sized" }).map((e) => e.id).join(), "a");
  eq(filterDiary(DIARY, { q: "SIZING" }).map((e) => e.id).join(), "c", "case does not matter");
  eq(filterDiary(DIARY, { q: "sizing revenge" }).length, 0, "every word must be there");
  eq(filterDiary(DIARY, { q: "   " }).length, 4, "blank search is no search");
});

test("feeling and month narrow, and the order is kept", () => {
  eq(filterDiary(DIARY, { emotion: "Anxious" }).map((e) => e.id).join(), "a,c", "newest first, as given");
  eq(filterDiary(DIARY, { month: "2026-10" }).map((e) => e.id).join(), "a,b");
  eq(filterDiary(DIARY, { emotion: "Anxious", month: "2026-09" }).map((e) => e.id).join(), "c");
});

test("the menus offer only what occurs, months newest first", () => {
  eq(monthsOf(DIARY).join(), "2026-10,2026-09,2026-08");
  eq(emotionsOf(DIARY, ["Calm", "Anxious", "Euphoric", "Confident"]).join(), "Calm,Anxious,Confident",
     "the app's order, and never a feeling that would filter to nothing");
  eq(monthLabel("2026-10"), "Oct 2026");
  eq(monthLabel(""), "");
  /* By hand, never new Date(str) — which reads a bare date as UTC midnight. */
  eq(monthOf("2026-11-01"), "2026-11");
});

test("the list collapses, thumbnails its charts, and reuses the one viewer", () => {
  const d = read("components/journal/Diary.jsx");
  ok(/const shown = filterDiary\(diary \|\| \[\], \{ q, emotion, month \}\);/.test(d), "filters drive what is listed");
  ok(/\{shown\.map\(\(e\) =>/.test(d), "the list renders what the filters return");
  ok(/const shots = shown\s*\.filter/.test(d), "the viewer pages through what is shown");
  ok(/className="dy-thumb"/.test(d) && !/className="dy-shot"/.test(d), "charts are thumbnails, not full width");
  eq(d.split("<ChartViewer").length - 1, 1, "one viewer, the existing one");
  ok(/aria-expanded=\{expanded\}/.test(d), "an entry opens and closes, and says which");
  ok(/\{diary\.length\} entr\{diary\.length === 1 \? "y" : "ies"\}/.test(d), "'1 of 44 entries', never '1 of 44 entry'");
  const css = read("app/globals.css");
  ok(/\.dy-entry\[data-open="0"\] \.dy-body \{[^}]*-webkit-line-clamp: 2/.test(css), "two lines while collapsed");
});

test("edit, delete and the edited stamp are exactly as they were", () => {
  const d = read("components/journal/Diary.jsx");
  ok(/onClick=\{\(\) => startEdit\(e\)\} aria-label="Edit entry"/.test(d));
  ok(/onClick=\{\(\) => onDelete\(e\)\} aria-label="Delete entry"/.test(d));
  ok(/>edited \{edited\}</.test(d));
});
