import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { losingRuns, losingRun } from "@/lib/bottleneck";
import { lastTime, LAST_TIME_MIN } from "@/lib/diaryLastTime";
import { fullDate } from "@/lib/diaryList";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/* A trade per entry day; r < 0 a loss, r > 0 a win. */
let k = 0;
const T = (date, r, o = {}) => ({ id: `t${k++}`, symbol: o.symbol || `S${k}`, entry_date: date, r, status: "closed", ...o });
const days = (start, n) => {
  const out = []; let t = Date.UTC(...start.split("-").map((x, i) => (i === 1 ? x - 1 : +x)));
  while (out.length < n) { const d = new Date(t); if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10)); t += 86400000; }
  return out;
};

/* Jan: a run of 9, ended by WIN1. Mar: a run of 2. May: a run of 4, ended by
   WIN3 at +2.4R. Now (Sep): a run of 5, still going. */
const D = days("2026-01-05", 200);
const book = [
  ...D.slice(0, 9).map((d) => T(d, -1)), T(D[9], 1.5, { symbol: "WIN1" }),
  ...D.slice(40, 42).map((d) => T(d, -1)), T(D[42], 0.8, { symbol: "WIN2" }),
  ...D.slice(80, 84).map((d) => T(d, -1)), T(D[84], 2.4, { symbol: "WIN3" }),
  ...D.slice(150, 155).map((d) => T(d, -1)),
];

test("losingRuns counts every run the way the losing-run card counts the current one", () => {
  const runs = losingRuns(book);
  eq(runs.map((r) => r.n).join(), "9,2,4,5");
  const card = losingRun(book);
  const last = runs.at(-1);
  eq([last.n, last.from, last.to].join(), [card.n, card.from, card.to].join(), "the same run, the same length, the same days");
  eq(last.endedBy, null, "still going");
  eq(runs[2].endedBy.symbol, "WIN3");
});

test("a day where anything won ends the run — ties never lengthen one", () => {
  const d = "2026-02-02";
  const runs = losingRuns([T("2026-02-01", -1), T(d, -1), T(d, 0.5, { symbol: "TIE" }), T("2026-02-03", -1)]);
  eq(runs.map((r) => r.n).join(), "1,1", "the loser on the winning day is not counted into either run");
  eq(runs[0].endedBy.symbol, "TIE");
});

test("a trade with no R still counts, by its money", () => {
  const runs = losingRuns([T("2026-03-02", NaN, { pnl: -500 }), T("2026-03-03", -1)]);
  eq(runs[0].n, 2);
});

/* THE ONE RULE: on a run, the most recent earlier run at least as long as
   now less two — longer counts too — and what was written while it lasted. */
test("the last run like this one is the most recent at least nearly as long", () => {
  const diary = [
    { id: "d1", entry_date: D[1] },              // during the January run
    { id: "d2", entry_date: D[81] },             // during the May run
    { id: "d3", entry_date: D[83] },             // its last losing day
    { id: "d4", entry_date: D[84] },             // the day WIN3 ended it — after, not during
    { id: "d5", entry_date: D[41] },             // during the 2-run, which is too short
  ];
  const lt = lastTime(book, diary);
  eq(lt.now.n, 5);
  eq(lt.then.n, 4, "May's 4 (≥ 5 − 2), not January's older 9");
  eq(lt.then.endedBy.symbol, "WIN3");
  eq(lt.entries.map((e) => e.id).join(), "d2,d3", "written while it lasted — not the day it ended");
});

test("nothing to say: no run, a short one, or one already over", () => {
  eq(lastTime(book.slice(0, 10), []), null, "the last day won — no run going");
  eq(lastTime([...book.slice(0, 10), T("2026-09-01", -1), T("2026-09-02", -1)], []), null,
     `a run of 2 is under ${LAST_TIME_MIN}`);
  const first = lastTime(D.slice(0, 6).map((d) => T(d, -1)), []);
  eq(first.then, null, "a run with nothing earlier at all says so");
});

/* A record run: nothing earlier within two of it. The block falls back to
   the longest earlier run and says so, instead of going quiet. */
test("on a record run, the longest earlier run — named as the longest", () => {
  const record = [...book.slice(0, -5), ...D.slice(150, 162).map((d) => T(d, -1))];   // now: 12
  const lt = lastTime(record, [{ id: "jan", entry_date: D[3] }]);
  eq(lt.now.n, 12);
  eq(lt.match, "longest");
  eq(lt.then.n, 9, "January's 9 — the longest before, though not within two of 12");
  eq(lt.entries.map((e) => e.id).join(), "jan");
  eq(lastTime(book, []).match, "similar", "a close match is still preferred");
  /* Only runs worth the name: a book whose earlier runs are all one or two
     long has nothing to fall back to. */
  const thin = [T("2026-01-05", -1), T("2026-01-06", 1), ...D.slice(150, 156).map((d) => T(d, -1))];
  eq(lastTime(thin, []).then, null);
});

test("the block sits at the top of the diary and opens what it lists", () => {
  const d = read("components/journal/Diary.jsx");
  ok(/const recall = useMemo\(\(\) => lastTime\(closed \|\| \[\], diary \|\| \[\]\), \[closed, diary\]\);/.test(d));
  ok(d.indexOf("{recall && <LastTime recall={recall} open={openEntry} />}") < d.indexOf("<YearMap year={year}"),
     "above the year map");
  const lt = d.slice(d.indexOf("function LastTime"));
  ok(/onClick=\{\(\) => open\(e\.id\)\}/.test(lt), "an entry it lists opens in the list");
  ok(/You wrote nothing while it lasted\./.test(lt), "and the absence is said, not hidden");
  ok(/match === "longest"[\s\S]{0,80}the longest before this was/.test(lt), "a fallback says it is the longest, not a like one");
  ok(/<style jsx global>/.test(lt) && /\.dy-lt /.test(lt));
  ok(/closed=\{closed\}/.test(read("app/(app)/diary/page.jsx")), "the page hands it the finished trades");
  eq(fullDate("2026-09-09"), "9 Sep 2026");
});
