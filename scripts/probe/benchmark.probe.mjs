import { test, eq, ok, near } from "./harness.mjs";
import { indexReturn, cagr } from "@/lib/calc";

/**
 * THE COMPARISON NOBODY ESCAPES.
 *
 * A swing trader's real alternative is a broad index fund and no work at all,
 * so this figure decides whether the whole exercise paid. It has to be right
 * in the direction that is uncomfortable: a bug that flatters the trader is
 * worse than useless, because it is the one number they would most like to
 * believe.
 */

/** A price series at a fixed daily compound rate, weekdays only. */
const series = (from, days, annual) => {
  const out = [];
  const start = Date.UTC(...from.split("-").map((v, i) => (i === 1 ? +v - 1 : +v)));
  for (let i = 0; i <= days; i++) {
    const d = new Date(start + i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    out.push({ d: iso, c: 1000 * Math.pow(1 + annual, i / 365) });
  }
  return out;
};

test("a series that doubles in two years reads 41.42% a year", () => {
  const pts = [{ d: "2024-09-03", c: 1000 }, { d: "2026-09-03", c: 2000 }];
  const r = indexReturn(pts);
  near(r.rate, Math.SQRT2 - 1, 1e-6);
  near(r.total, 1.0, 1e-9, "and 100% in all");
  eq(r.days, 730);
});

test("it is measured over the prices' own span, not the record's", () => {
  /*
    A record can start on a Saturday, or before the index history the API
    returns. Dividing a real price move by a span the prices do not cover
    reports a rate for days that were never priced — flattering when the
    missing days sit at the start of a rise.
  */
  const r = indexReturn([{ d: "2025-01-06", c: 1000 }, { d: "2026-01-06", c: 1200 }]);
  eq(r.from, "2025-01-06");
  eq(r.to, "2026-01-06");
  eq(r.days, 365);
  near(r.rate, 0.2, 1e-9, "20% over exactly one year is 20% a year");
});

test("a compounding series annualises back to the rate that built it", () => {
  const pts = series("2023-01-01", 900, 0.18);
  near(indexReturn(pts).rate, 0.18, 1e-6);
});

test("a falling index reads as a fall", () => {
  const r = indexReturn([{ d: "2024-09-03", c: 2000 }, { d: "2026-09-03", c: 1000 }]);
  near(r.rate, Math.SQRT1_2 - 1, 1e-6);
  ok(r.total < 0);
});

test("unsorted, dirty and thin inputs cannot produce a number", () => {
  /* The API is a proxy over an unofficial source; it has returned nulls and
     out-of-order rows before, and this must not turn either into a return. */
  const jumbled = indexReturn([
    { d: "2026-09-03", c: 2000 }, { d: "2024-09-03", c: 1000 },
  ]);
  near(jumbled.rate, Math.SQRT2 - 1, 1e-6, "sorted before it is read");

  for (const bad of [null, undefined, [], [{ d: "2025-01-01", c: 100 }]]) {
    ok(!isFinite(indexReturn(bad).rate), "not enough to measure");
  }
  const dirty = indexReturn([
    { d: "2024-09-03", c: 1000 }, { d: "2025-01-01", c: null },
    { d: "2025-06-01", c: 0 }, { d: "2026-09-03", c: 2000 },
  ]);
  near(dirty.rate, Math.SQRT2 - 1, 1e-6, "a null close is dropped, not read as zero");
});

test("a short window is refused, exactly as the trader's own rate is", () => {
  /* Otherwise a two-month record would compare an annualised index against a
     dash, and whichever way that reads it is not a comparison. */
  const r = indexReturn([{ d: "2026-07-20", c: 1000 }, { d: "2026-09-03", c: 1040 }]);
  ok(!isFinite(r.rate), "no annual rate under 90 days");
  near(r.total, 0.04, 1e-9, "but the plain move is still known");
});
