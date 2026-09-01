import { test, eq, ok, near } from "./harness.mjs";
import { eligible, deckHealth, buildDeck, breakRuns, priority, score, pAtLeast, verdict,
         reveal, MIN_CALLS, STALE_DAYS } from "@/lib/drill";

const T = (o = {}) => ({ id: "t1", symbol: "RELIANCE", status: "closed",
  entry_date: "2025-01-10", exit_date: "2025-02-01", pnl: 5000, r: 1.4,
  mistakes: [], ...o });
const D = (o = {}) => ({ id: "d1", trade_id: "t1", image_path: "u/1.png",
  entry_date: "2025-01-10", body: "", ...o });

test("a card needs a picture, a settled outcome, and a trade", () => {
  eq(eligible([T()], [D()]).length, 1);
  eq(eligible([T()], []).length, 0, "no chart, no card");
  eq(eligible([T()], [D({ image_path: null })]).length, 0, "a note is not a chart");
  eq(eligible([T()], [D({ trade_id: null })]).length, 0, "an unlinked chart has no outcome");
  eq(eligible([T({ status: "open" })], [D()]).length, 0, "nothing to reveal yet");
  eq(eligible([T({ status: "partial" })], [D()]).length, 0);
  eq(eligible([T({ pnl: NaN })], [D()]).length, 0);

  /* Money, not R — the rule the Winners and Losers tabs settled on. A trade
     with no stop has no R and is still plainly a winner. */
  eq(eligible([T({ r: NaN })], [D()])[0].won, true, "no R is still a winner");
  eq(eligible([T({ pnl: 0 })], [D()])[0].won, false, "break-even sits with the losers");
});

test("the card shows the EARLIEST chart, not the latest", () => {
  /* A screenshot taken after the exit has the answer on its face. */
  const c = eligible([T()], [
    D({ id: "late", entry_date: "2025-02-05", image_path: "u/after.png" }),
    D({ id: "early", entry_date: "2025-01-09", image_path: "u/before.png" }),
  ])[0];
  eq(c.entry.image_path, "u/before.png");
  eq(c.shots.length, 2, "the rest are still available for the reveal");
});

/* ------------------------------------------------------------------ */

const many = (n, won, from = 0) => Array.from({ length: n }, (_, i) => ({
  id: `${won ? "w" : "l"}${from + i}`, won,
  trade: { id: `${won ? "w" : "l"}${from + i}`, exit_date: "2024-01-01", pnl: won ? 1 : -1 },
}));

test("the deck is dealt in equal parts, and says so when it cannot be", () => {
  /* A deck that is mostly winners can be scored well by answering "take" to
     everything — that would measure the win rate, not the eye. */
  const lopsided = [...many(20, true), ...many(2, false)];
  const d = buildDeck(lopsided, { size: 10, seed: 3 });
  eq(d.filter((c) => c.won).length, 2, "capped by the scarcer side");
  eq(d.filter((c) => !c.won).length, 2);
  eq(deckHealth(lopsided).balanced, 4, "and the screen can explain the short hand");

  const even = [...many(20, true), ...many(20, false)];
  const d2 = buildDeck(even, { size: 10, seed: 3 });
  eq(d2.length, 10);
  eq(d2.filter((c) => c.won).length, 5, "exactly half, so chance is exactly 50%");

  eq(buildDeck(many(9, true), { size: 10 }).length, 0, "one-sided deals nothing");
  eq(buildDeck([], { size: 10 }).length, 0);
});

test("a hand does not come out in blocks of one side", () => {
  /* A visible run tells the answer. Interleaving before the shuffle stops a
     weak shuffle on a short hand producing six-then-four. */
  const even = [...many(30, true), ...many(30, false)];
  let worst = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const d = buildDeck(even, { size: 10, seed });
    let run = 1, longest = 1;
    for (let i = 1; i < d.length; i++) {
      run = d[i].won === d[i - 1].won ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
    worst = Math.max(worst, longest);
  }
  ok(worst <= 4, `a run of ${worst} of the same outcome in a hand of 10`);
});

test("wrong cards come back sooner, recent ones stay away", () => {
  const now = Date.parse("2026-01-01");
  const old = { id: "a", won: true, trade: { exit_date: "2024-01-01" } };
  const fresh = { id: "b", won: true, trade: { exit_date: "2025-12-20" } };

  ok(priority(old, undefined, now) > priority(fresh, undefined, now),
     "an old trade is read; a recent one is remembered");
  ok(priority(old, { wrong: 3 }, now) > priority(old, { wrong: 0 }, now),
     "a card called wrong is the point of a flashcard");
  ok(priority(old, { last_seen: "2025-12-31" }, now) < priority(old, undefined, now),
     "seen yesterday drops down the deck");
  ok(priority(old, { last_seen: "2024-06-01" }, now) === priority(old, undefined, now),
     "seen long ago is no penalty at all");
});

/* ------------------------------------------------------------------ */

const A = (won, called) => ({ card: { won }, called });

test("the four buckets, and the two rates a trader recognises", () => {
  const s = score([A(true, "take"), A(true, "take"), A(false, "take"),
                   A(true, "pass"), A(false, "pass"), A(false, "pass")]);
  eq(s.tookWon, 2); eq(s.tookLost, 1); eq(s.passedWon, 1); eq(s.passedLost, 2);
  eq(s.n, 6); eq(s.right, 4);
  near(s.accuracy, 66.67, 0.01);
  near(s.precision, 66.67, 0.01, "of what you would take, what worked");
  near(s.recall, 66.67, 0.01, "of the winners, what you caught");

  const none = score([]);
  eq(none.n, 0);
  eq(isFinite(none.accuracy), false, "no calls is not zero percent");
  eq(score([{ card: { won: true }, called: "nonsense" }]).n, 0, "junk is not a call");
  eq(score(null).n, 0);
});

test("eight out of ten is not a result, and the maths says so", () => {
  /* The reason this exists: 8/10 feels like an eye for it and happens by luck
     about one time in nine. A page about self-assessment must not hand out
     congratulations for noise. */
  near(pAtLeast(10, 10), 1 / 1024, 1e-6, "a perfect ten is one in 1024");
  near(pAtLeast(5, 10), 0.6230, 0.001, "at chance");
  near(pAtLeast(0, 10), 1, 1e-9, "at least zero is certain");
  ok(pAtLeast(8, 10) > 0.05, `8/10 is p=${pAtLeast(8, 10).toFixed(3)} — not significant`);
  ok(pAtLeast(9, 10) < 0.05, "nine is");
  ok(pAtLeast(30, 40) < 0.01, "and a longer hand needs a smaller margin");

  /* Monotonic, and a probability throughout. */
  let prev = 1.1;
  for (let k = 0; k <= 20; k++) {
    const p = pAtLeast(k, 20);
    ok(p >= 0 && p <= 1, `p out of range at ${k}: ${p}`);
    ok(p <= prev + 1e-12, "not monotonic");
    prev = p;
  }
});

test("the verdict is hard to get a compliment out of", () => {
  eq(verdict(score(Array.from({ length: 4 }, () => A(true, "take")))).level, "thin",
     "four right out of four says nothing");
  eq(verdict({ n: MIN_CALLS - 1, right: 7 }).level, "thin");

  const eightOfTen = { n: 10, right: 8, accuracy: 80 };
  eq(verdict(eightOfTen).level, "chance", "80% on ten calls is still a coin");

  eq(verdict({ n: 40, right: 30, accuracy: 75 }).level, "real");

  /* Reliably wrong is information, not failure — and must not be reported as
     "no signal". */
  const inv = verdict({ n: 40, right: 10, accuracy: 25 });
  eq(inv.level, "inverted");
  ok(/worse than chance/i.test(inv.headline), inv.headline);

  /* Every branch says something, and none of them says undefined. */
  for (const v of [verdict(null), verdict({ n: 0, right: 0 }), verdict(eightOfTen),
                   verdict({ n: 40, right: 30, accuracy: 75 }), inv]) {
    ok(v.headline && !/undefined|NaN/.test(v.headline), v.headline);
    ok(v.detail && !/undefined|NaN/.test(v.detail), v.detail);
  }
});

test("the reveal separates an execution error from a setup that failed", () => {
  const card = eligible([T({ mistakes: ["Oversized", "Setup failed"] })],
                        [D({ body: "volume looks thin" })])[0];
  const r = reveal(card);
  eq(r.errors.join(), "Oversized", "something you did");
  eq(r.outcomes.join(), "Setup failed", "something the market did");
  eq(r.notes.join(), "volume looks thin", "your own sentence, returned");
  eq(reveal({ trade: {}, shots: [] }).notes.length, 0);
});
