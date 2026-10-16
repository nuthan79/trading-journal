import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq, near } from "./harness.mjs";
import { yearMap, cellTone } from "@/lib/diaryYear";
import { dayIndex } from "@/lib/diaryDay";
import { derivePosition } from "@/lib/positions";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");
const mk = (t) => ({ ...t, ...derivePosition(t, 5e6), status: t.status, exits: t.exits });
const base = { side: "long", stop_source: "recorded", charges: 0 };

/* Wed 30 Sep 2026: bought A, sold half (+1R of its own risk); bought B and sold
   it all the same day (−0.5R). Fri 2 Oct is Gandhi Jayanti — closed. */
const A = mk({ ...base, id: "A", symbol: "A", status: "open", entry_date: "2026-09-30", entry_price: 100,
  quantity: 100, stop_loss: 90, exits: [{ exit_date: "2026-09-30", quantity: 50, price: 120, charges: 0 }] });
const B = mk({ ...base, id: "B", symbol: "B", status: "closed", entry_date: "2026-09-30", entry_price: 200,
  quantity: 10, stop_loss: 190, exit_date: "2026-09-30", exit_price: 195,
  exits: [{ exit_date: "2026-09-30", quantity: 10, price: 195, charges: 0 }] });
const C = mk({ ...base, id: "C", symbol: "C", status: "open", entry_date: "2026-10-06", entry_price: 50,
  quantity: 40, stop_loss: 45, exits: [] });
const idx = dayIndex([A, B, C]);

/* The index's own calendar for those weeks: weekdays, without 2 Oct. */
const OPEN = new Set(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01",
  "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
const ENTRIES = [
  { id: "e1", entry_date: "2026-09-30" },
  { id: "e2", entry_date: "2026-10-04" },          // a Sunday
];
const map = yearMap({ today: "2026-10-09", tradingDays: OPEN, idx, entries: ENTRIES, weeks: 2 });
const cell = (d) => map.cols.flat().find((c) => c && c.date === d);

test("a cell per day the market was open; a holiday is a gap, not a cell", () => {
  eq(map.cols.length, 2, "two Monday-to-Friday columns");
  ok(cell("2026-09-28") && cell("2026-10-09"));
  eq(cell("2026-10-02"), undefined, "Gandhi Jayanti is not a session");
  eq(map.cols[0][4], null, "its slot in the week stays empty");
});

test("a day's colour is the R it realised — every sell that day, added", () => {
  near(cell("2026-09-30").r, 1 - 0.5, 1e-9, "A's half at +1R and B's whole at −0.5R");
  eq(cell("2026-10-06").r, null, "a buy realises nothing…");
  ok(cell("2026-10-06").traded, "…but it is a day traded");
  ok(!cell("2026-10-07").traded);
  eq(cellTone(cell("2026-09-30")).kind, "gain");
  eq(cellTone(cell("2026-10-06")).kind, "traded");
  eq(cellTone(cell("2026-10-07")).kind, "idle");
  eq(cellTone({ r: -6, traded: true, entries: [] }).strength, 1, "flat at 3R and beyond");
});

test("an entry written on a weekend marks the session before it, and says so", () => {
  const fri = cell("2026-10-01");                  // 2 Oct closed, so Sun 4 Oct reaches back to Thu 1 Oct
  eq(fri.entries.map((x) => x.id).join(), "e2");
  eq(fri.entries[0].written, "2026-10-04", "the real date is kept for the hover");
  eq(cell("2026-09-30").entries[0].id, "e1");
});

test("the gaps are counted: days traded, days written, days traded and not written", () => {
  eq(map.stats.traded, 2, "30 Sep and 6 Oct");
  eq(map.stats.written, 2, "30 Sep, and 1 Oct for Sunday's entry");
  eq(map.stats.tradedUnwritten, 1, "6 Oct: traded, nothing written");
});

test("the map sits above the list and opens the day's entry", () => {
  const d = read("components/journal/Diary.jsx");
  ok(d.indexOf("<YearMap year={year} jump={jumpTo} />") < d.indexOf('<div className="dy-find">'), "above the search");
  ok(/tradingDays: regimes \? new Set\(regimes\.dates\) : null/.test(d), "the index's own calendar");
  ok(/const openEntry = \(id\) => \{\s*if \(!id\) return;\s*setQ\(""\); setEmotion\(""\); setMonth\(""\);\s*setOpen\(\(prev\) => new Set\(prev\)\.add\(id\)\);\s*setJump\(id\);/.test(d),
     "filters cleared so the entry is in the list, opened, and jumped to");
  ok(/const jumpTo = \(cell\) =>\s*cell\.entries\.length \? openEntry\(cell\.entries\[0\]\.id\)\s*: writeOn\(cell\.date\);/.test(d),
     "a day opens its first entry, or starts one dated it");
  ok(/id=\{`dy-\$\{e\.id\}`\}/.test(d), "each entry can be found by id");
  /* The first version smooth-scrolled in the same tick as the entry opened,
     and on a real book stopped at July for a December entry. */
  ok(/useEffect\(\(\) => \{\s*if \(!jump\) return undefined;/.test(d),
     "the scroll waits for the render with the entry open");
  ok(!/behavior: "smooth"/.test(d.slice(d.indexOf("const jumpTo"), d.indexOf("}, [jump]);"))),
     "and lands instantly rather than easing toward a stale target");
  ok(/const again = setTimeout\(go, 400\);/.test(d), "then corrects once images have their height");
  const ym = d.slice(d.indexOf("function YearMap"));
  ok(/<style jsx global>/.test(ym) && /\.dy-ym /.test(ym), "global under its prefix — a child component");
  ok(/traded and nothing written/.test(ym), "the gap is said in words");
});

/**
 * EVERY PAST DAY IS A DAY YOU CAN WRITE ABOUT. The footer said "84 traded and
 * nothing written" and then made those 84 days inert spans — the screen named
 * the gap and offered no way to close it. Invisible to a unit test.
 */
test("every cell on the map is a button that does the obvious thing", () => {
  const d = read("components/journal/Diary.jsx");
  const ym = d.slice(d.indexOf("function YearMap"), d.indexOf("function LastTime"));
  ok(!/\? "button" : "span"/.test(d), "no cell is a span because nothing was written on it");
  ok(/<button key=\{c\.date\} type="button" className="dy-ym-cell"/.test(ym), "a session is always a button");
  ok(/onClick=\{\(\) => jump\(c\)\} aria-label=\{tip\(c\)\}/.test(ym), "always clickable, always labelled");
  ok(/"nothing written — click to write"/.test(ym) && /"no trades — click to write"/.test(ym),
     "the hover says what the click will do");
  ok(!/button\.dy-ym-cell/.test(ym), "the outline and pointer are on every cell, not only buttons");
  /* writeOn is startEdit's rule: only a NEW draft with content can be lost. */
  const w = d.slice(d.indexOf("const writeOn"), d.indexOf("const discard"));
  ok(/if \(draft && !draft\.id && hasContent\(serializeDraft\(draft\)\) &&\s*!window\.confirm\(/.test(w), "confirm before discarding");
  ok(/setDraft\(\{ \.\.\.newDraft\(\), entry_date: date \}\);/.test(w), "a new draft dated that day");
  ok(!/setQ\(|setEmotion\(|setMonth\(/.test(w), "the reader's filters are left alone");
});

test("the draft card shows what its day was", () => {
  const d = read("components/journal/Diary.jsx");
  const card = d.slice(d.indexOf("Attach to a trade (optional)"), d.indexOf("How you were feeling"));
  ok(/<DayStrip facts=\{dayFacts\(draft\.entry_date, days, regimes\)\}/.test(card),
     "read off the draft's own date, so editing the date re-reads the day");
});
