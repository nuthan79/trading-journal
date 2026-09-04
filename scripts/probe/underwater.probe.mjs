import { test, eq, ok, near } from "./harness.mjs";
import { underwater } from "@/lib/calc";
import { derivePosition } from "@/lib/positions";

/**
 * THE HALF OF A DRAWDOWN THAT PEOPLE ACTUALLY LIVE THROUGH.
 *
 * Depth is a number; duration is what makes somebody abandon a system that
 * was working. The failure modes here are all off-by-one — where an episode
 * starts, whether it has ended, and what "still under water" means on a
 * record whose last trade was months ago — so each is pinned separately.
 */

const mk = (id, entry, exit, price, qty = 100) => {
  const t = { id, symbol: id, side: "long", status: "closed",
    entry_date: entry, entry_price: 100, quantity: qty,
    stop_loss: 90, stop_source: "recorded", charges: 0,
    exit_date: exit, exit_price: price,
    exits: [{ exit_date: exit, quantity: qty, price, charges: 0 }] };
  return { ...t, ...derivePosition(t, 1e6), status: "closed", exits: t.exits };
};

const AT = new Date("2026-09-04T00:00:00Z");
const run = (book, asOf = AT) =>
  underwater(book, { openingCapital: 1000000, flows: [], asOf });

test("an account that only goes up is never under water", () => {
  const u = run([
    mk("a", "2026-01-02", "2026-02-01", 120),
    mk("b", "2026-02-05", "2026-03-01", 130),
  ]);
  eq(u.episodes.length, 0);
  eq(u.current, null);
  ok(u.atHigh, "and it says so");
});

test("a dip and a recovery is one episode, dated peak to recovery", () => {
  /*
    +2000 on 1 Feb sets the high. A loss on 1 Mar goes under. Back above on
    1 May. The stretch is 1 Feb to 1 May — measured from the HIGH, not from
    the losing trade, because that is the day the account was last at its
    best.
  */
  const u = run([
    mk("up", "2026-01-02", "2026-02-01", 120),
    mk("dn", "2026-02-10", "2026-03-01", 90),
    mk("bk", "2026-03-10", "2026-05-01", 140),
  ]);
  eq(u.episodes.length, 1);
  const e = u.episodes[0];
  ok(e.recovered, "it ended");
  eq(e.days, 89, "1 Feb to 1 May");
  eq(u.current, null, "so nothing is open");
  ok(u.atHigh);
});

test("a stretch that never recovered runs to today, not to the last trade", () => {
  /*
    THE ONE PEOPLE MOST NEED TO SEE. The last trade was in March; it is now
    September. Measuring to the last trade would report six months of being
    under water as six weeks.
  */
  const u = run([
    mk("up", "2026-01-02", "2026-02-01", 120),
    mk("dn", "2026-02-10", "2026-03-01", 85),
  ]);
  eq(u.episodes.length, 1);
  ok(u.current, "still open");
  ok(!u.current.recovered);
  eq(u.current.days, 215, "1 Feb to 4 Sep, not 1 Feb to 1 Mar");
  ok(!u.atHigh);
});

test("the longest episode is reported even when a shorter one is current", () => {
  /* A trader 10 days down after a 100-day stretch last year needs both: the
     one they are in, and the worst they have survived. */
  const u = run([
    mk("h1", "2026-01-02", "2026-01-10", 130),
    mk("d1", "2026-01-12", "2026-02-01", 80),      // long dip
    mk("r1", "2026-02-05", "2026-06-01", 200),     // new high, recovers it
    mk("d2", "2026-06-05", "2026-08-25", 95),      // recent, still down
  ], AT);
  eq(u.episodes.length, 2);
  ok(u.current && !u.current.recovered);
  ok(u.longest.days > u.current.days,
    `the worst survived (${u.longest.days}d) outlasts the current one (${u.current.days}d)`);
  eq(u.longest.days, 142, "10 Jan to 1 Jun — 21 + 28 + 31 + 30 + 31 + 1");
  eq(u.current.days, 95, "1 Jun to 4 Sep");
});

test("depth travels with duration, measured to the trough", () => {
  const u = run([
    mk("up", "2026-01-02", "2026-02-01", 120),   // +2000
    mk("d1", "2026-02-10", "2026-03-01", 90),    // -1000
    mk("d2", "2026-03-10", "2026-04-01", 80),    // -2000, the trough
    mk("bk", "2026-04-10", "2026-06-01", 160),
  ]);
  const e = u.episodes[0];
  near(e.depth, 3000, 1e-6, "peak 1,002,000 down to 999,000");
  near(e.depthPct, (3000 / 1002000) * 100, 1e-9);
});

test("the typical recovery is a median of the ones that ended", () => {
  /* An open episode has no recovery time yet and must not be counted as a
     fast one — which averaging over all episodes would do. */
  const u = run([
    mk("h1", "2026-01-02", "2026-01-05", 130),
    mk("a1", "2026-01-06", "2026-01-20", 80), mk("a2", "2026-01-21", "2026-02-05", 200),
    mk("b1", "2026-02-06", "2026-02-20", 80), mk("b2", "2026-02-21", "2026-04-05", 300),
    mk("c1", "2026-04-06", "2026-08-30", 80),
  ]);
  const closed = u.episodes.filter((e) => e.recovered);
  eq(closed.length, 2);
  ok(u.current, "and one still open");
  ok(isFinite(u.typicalRecovery), "a median exists");
  ok(u.typicalRecovery <= u.longest.days);
  /* The open one is longer than either closed one, and must not have pulled
     the typical figure up. */
  ok(u.typicalRecovery < u.current.days || closed.some((e) => e.days >= u.current.days));
});

test("an empty book says nothing rather than guessing", () => {
  const u = run([]);
  eq(u.episodes.length, 0);
  eq(u.longest, null);
  eq(u.current, null);
});
