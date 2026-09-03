import { test, eq, ok } from "./harness.mjs";
import { fyStartYear, fyQuarter, fyLabel, quarterLabel, monthLabel } from "@/lib/calc";
import { monthShort, dmy } from "@/lib/format";

/**
 * THE BUG THESE EXIST FOR ONLY APPEARS SOMEWHERE ELSE.
 *
 * `new Date("2025-04-01")` is UTC midnight, and every getter reads it back in
 * the LOCAL zone. India is UTC+5:30, so the date always reads back as itself
 * and nothing here ever looked wrong. West of Greenwich it reads back as the
 * previous day — so the first of April falls into the previous financial year,
 * the first of a month into the month before, and a trade is filed under the
 * wrong year for the life of the journal.
 *
 * A bug nobody in the room can see is one that survives every review, so these
 * assert the boundaries directly rather than trusting the ambient timezone.
 *
 *     npm run probe:tz
 *
 * runs the whole suite under America/New_York, which is where this class of
 * bug is visible. Measured with the fix reverted: Asia/Kolkata passed all 126,
 * America/New_York and Pacific/Honolulu failed five each. Running only in the
 * local zone is what let it live in calc.js for as long as it did.
 */

test("the first day of a financial year belongs to that financial year", () => {
  /* 1 April is the whole question. Parsed through Date and read local, this is
     31 March in any zone behind UTC — the previous FY. */
  eq(fyStartYear("2025-04-01"), 2025, "1 April starts FY25-26");
  eq(fyStartYear("2025-03-31"), 2024, "31 March is still the old one");
  eq(fyLabel("2025-04-01"), "FY26");
  eq(fyLabel("2025-03-31"), "FY25");

  /* And the last day, which is the mirror of the same failure. */
  eq(fyStartYear("2026-03-31"), 2025);
  eq(fyStartYear("2026-04-01"), 2026);
});

test("a quarter is read off the month, not off a parsed date", () => {
  eq(fyQuarter("2025-04-01"), 1, "April opens Q1");
  eq(fyQuarter("2025-06-30"), 1);
  eq(fyQuarter("2025-07-01"), 2);
  eq(fyQuarter("2025-10-01"), 3);
  eq(fyQuarter("2026-01-01"), 4);
  eq(fyQuarter("2026-03-31"), 4, "March closes Q4");
  eq(quarterLabel("2025-04-01"), "FY26 Q1");
  eq(quarterLabel("2026-03-31"), "FY26 Q4");
});

test("the month label is three letters, and is a bucket key", () => {
  /* toLocaleDateString gives "Sept" under some ICU builds and "Sep" under
     others. This label KEYS the period buckets, so two spellings would split
     one month into two rows — and it can differ between the server and the
     browser, which React lists as a cause of hydration mismatch. */
  eq(monthLabel("2025-09-01"), "Sep 25");
  eq(monthLabel("2025-09-30"), "Sep 25", "and the last day is the same bucket");
  eq(monthLabel("2025-01-01"), "Jan 25");
  eq(monthLabel("2025-12-31"), "Dec 25");
  ok(!/Sept/.test(monthLabel("2025-09-15")), "four-letter September is back");

  /* One spelling across the app: the label and the date in a table cell must
     agree, or September reads two ways on one screen. */
  eq(monthLabel("2025-09-15").split(" ")[0], monthShort("2025-09-15"));
  ok(dmy("2025-09-15").includes(monthShort("2025-09-15")));
});

test("the first of every month lands in its own month", () => {
  /* Twelve boundaries, because this is the failure and it is cheap to cover. */
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    eq(monthLabel(`2025-${mm}-01`), monthLabel(`2025-${mm}-15`),
       `the 1st of month ${mm} fell into a different bucket from the 15th`);
  }
});

test("a Date still works, because that is what 'today' arrives as", () => {
  /* Holdings and the filter presets pass `new Date()`. Reading the string form
     by hand must not break the Date form. */
  eq(fyStartYear(new Date(2025, 3, 1)), 2025, "1 April as a local Date");
  eq(fyStartYear(new Date(2025, 2, 31)), 2024, "31 March as a local Date");
  eq(monthLabel(new Date(2025, 8, 15)), "Sep 25");
  eq(fyQuarter(new Date(2025, 3, 1)), 1);

  /* And a full timestamp, which is what a stored timestamptz looks like. */
  eq(fyStartYear("2025-04-01T00:00:00.000Z"), 2025);
  eq(monthLabel("2025-09-01T18:30:00.000Z"), "Sep 25");
});
