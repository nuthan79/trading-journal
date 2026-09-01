/**
 * The chart drill: can you tell your own winners from your own losers?
 *
 * WHY IT IS NOT A SLIDESHOW OF WINNERS. The obvious build is "show me my good
 * charts so I learn the pattern". That deck is all answers and no questions.
 * There is no discrimination task in it: every card is a winner, so nothing
 * you decide can be wrong, and the patterns being memorised almost certainly
 * appear in the losers too — which are never shown. It would send somebody
 * away more confident and no more accurate, which is the worst combination a
 * trading journal can produce.
 *
 * So the deck is MIXED, the outcome is HIDDEN, a call is required, and only
 * then is the answer shown. That produces a number no slideshow can: how often
 * the call was right, against how often it would have been right by chance.
 *
 * AND THE HONEST ANSWER MIGHT BE "NO". A trader who cannot beat chance on
 * their own charts has learned something worth far more than a streak: their
 * edge is not in reading the setup. It is in sizing, or in exits, or in
 * risk control — all of which this app measures elsewhere. `verdict()` is
 * written to be able to say that plainly rather than to congratulate.
 */

import { isExecutionError } from "./constants";

const DAY = 86_400_000;

/** Below this a session says nothing at all, and is reported as saying nothing. */
export const MIN_CALLS = 8;

/**
 * Charts older than this are the ones worth drilling.
 *
 * A trade from last month is remembered, not read — the outcome comes back
 * before the eye has finished the chart, and the card tests recall rather than
 * pattern recognition. Older cards are preferred rather than required, because
 * a young journal has nothing else and a smaller deck beats no deck.
 */
export const STALE_DAYS = 180;

/* ------------------------------------------------------------------ *
 *  What can be drilled
 * ------------------------------------------------------------------ */

/**
 * A card needs three things: a picture, a settled outcome, and a trade to
 * attach them to.
 *
 * The outcome is on MONEY, not on R — the same rule the Winners and Losers
 * tabs settled on. A trade with no stop has no R and is still plainly a winner
 * or a loser, and excluding those here would quietly drop most of an imported
 * book from the deck.
 */
export function eligible(trades, diary) {
  const shots = new Map();
  for (const d of diary || []) {
    if (!d.trade_id || !d.image_path) continue;
    if (!shots.has(d.trade_id)) shots.set(d.trade_id, []);
    shots.get(d.trade_id).push(d);
  }

  const out = [];
  for (const t of trades || []) {
    if (t.status !== "closed") continue;          // no outcome to reveal yet
    if (!isFinite(t.pnl)) continue;
    const mine = shots.get(t.id);
    if (!mine?.length) continue;
    /* The EARLIEST chart, because the drill asks what the setup looked like.
       A screenshot taken after the exit shows the answer on its face. */
    const first = [...mine].sort((a, b) =>
      String(a.entry_date || "").localeCompare(String(b.entry_date || "")))[0];
    out.push({
      id: t.id,
      trade: t,
      entry: first,
      shots: mine,
      won: t.pnl > 0,
      /* Break-even sits with the losers, as it does on the tabs. */
    });
  }
  return out;
}

export const deckHealth = (cards) => {
  const won = cards.filter((c) => c.won).length;
  return { total: cards.length, won, lost: cards.length - won,
           balanced: Math.min(won, cards.length - won) * 2 };
};

/* ------------------------------------------------------------------ *
 *  Building a hand
 * ------------------------------------------------------------------ */

/**
 * Deterministic shuffle, seeded.
 *
 * Math.random cannot be used in this codebase's probes, and a seeded shuffle
 * is better here anyway: a session can be replayed exactly when something
 * about it looks wrong.
 */
function shuffled(list, seed) {
  const a = [...list];
  let r = (seed || 1) >>> 0;
  const next = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * How badly this card wants to be seen.
 *
 * Three pulls, and they are deliberately small integers rather than a tuned
 * formula — this decides an order, not a truth, and a number nobody can
 * explain is worse than a rough one anybody can.
 *
 *   OLD is better. A recent trade is recalled rather than read.
 *   WRONG LAST TIME is better. That is the whole point of a flashcard.
 *   SEEN RECENTLY is worse, so a short deck does not repeat itself.
 */
export function priority(card, review, now = Date.now()) {
  const ageDays = card.trade?.exit_date
    ? (now - new Date(card.trade.exit_date).getTime()) / DAY : 0;
  let p = 0;
  p += ageDays >= STALE_DAYS ? 3 : ageDays >= 60 ? 1 : 0;
  if (review?.wrong > 0) p += Math.min(review.wrong, 3) * 2;
  if (review?.last_seen) {
    const sinceDays = (now - new Date(review.last_seen).getTime()) / DAY;
    if (sinceDays < 1) p -= 6;
    else if (sinceDays < 7) p -= 3;
    else if (sinceDays < 30) p -= 1;
  }
  return p;
}

/**
 * NO LONG RUNS OF ONE OUTCOME.
 *
 * A visible run tells the answer: five winners in a row and the sixth card is
 * being read with a thumb on the scale. Interleaving winner-loser-winner and
 * then shuffling does not work — the shuffle is exactly what undoes it, and a
 * hand of ten came out with runs of five often enough to matter.
 *
 * So the hand is shuffled and then REPAIRED: walk it, and where a run passes
 * `max`, swap the offending card with the nearest later card of the other
 * outcome. That bounds the tell without making the order predictable, which
 * strict alternation would — knowing every second card is a winner is the same
 * leak wearing a tidier shape.
 */
export function breakRuns(hand, max = 3) {
  const a = [...hand];
  let run = 1;
  for (let i = 1; i < a.length; i++) {
    if (a[i].won === a[i - 1].won) run++;
    else { run = 1; continue; }
    if (run <= max) continue;
    const j = a.findIndex((c, k) => k > i && c.won !== a[i].won);
    if (j < 0) break;              // nothing left to swap with; the deck is spent
    [a[i], a[j]] = [a[j], a[i]];
    run = 1;
  }
  return a;
}

/**
 * A hand of cards, as balanced between winners and losers as the library
 * allows.
 *
 * BALANCE IS THE POINT. A deck that is 80% winners can be scored 80% by
 * answering "take" to everything, so the number would measure the book's win
 * rate rather than the trader's eye. Taking equal counts from each side makes
 * chance exactly 50% and the score meaningful. The cost is that a lopsided
 * library yields a shorter hand than asked for, which is the honest trade —
 * and `deckHealth` reports it so the screen can say why.
 */
export function buildDeck(cards, { size = 10, seed = 1, reviews = {}, now = Date.now() } = {}) {
  const rank = (list) => shuffled(list, seed)
    .map((c) => ({ c, p: priority(c, reviews[c.id], now) }))
    .sort((a, b) => b.p - a.p)
    .map((x) => x.c);

  const winners = rank(cards.filter((c) => c.won));
  const losers = rank(cards.filter((c) => !c.won));
  const each = Math.min(Math.floor(size / 2), winners.length, losers.length);
  if (each === 0) return [];

  const hand = shuffled([...winners.slice(0, each), ...losers.slice(0, each)], seed + 7);
  return breakRuns(hand, 3);
}

/* ------------------------------------------------------------------ *
 *  Scoring
 * ------------------------------------------------------------------ */

/** Answers are `{ card, called: "take" | "pass" }`. */
export function score(answers) {
  const m = { tookWon: 0, tookLost: 0, passedWon: 0, passedLost: 0 };
  for (const a of answers || []) {
    if (!a?.card || (a.called !== "take" && a.called !== "pass")) continue;
    const took = a.called === "take";
    if (took && a.card.won) m.tookWon++;
    else if (took) m.tookLost++;
    else if (a.card.won) m.passedWon++;
    else m.passedLost++;
  }
  const n = m.tookWon + m.tookLost + m.passedWon + m.passedLost;
  const right = m.tookWon + m.passedLost;
  return {
    ...m, n, right,
    accuracy: n ? (right / n) * 100 : NaN,
    /* Of the ones you would have taken, how many actually worked. The number
       a trader recognises, and the one that costs money when it is low. */
    precision: m.tookWon + m.tookLost ? (m.tookWon / (m.tookWon + m.tookLost)) * 100 : NaN,
    /* Of the winners in the hand, how many you would have caught. */
    recall: m.tookWon + m.passedWon ? (m.tookWon / (m.tookWon + m.passedWon)) * 100 : NaN,
  };
}

/**
 * Two-sided binomial tail: the chance of doing THIS well or better on a fair
 * coin.
 *
 * Here because eight out of ten feels like a result and is not one — on ten
 * flips it happens by luck about one time in nine. Without this the screen
 * would hand out congratulations for noise, which on a page about
 * self-assessment is the one thing it must not do.
 */
export function pAtLeast(right, n) {
  if (!n || right < 0 || right > n) return NaN;
  let logC = 0, tail = 0;
  for (let k = 0; k <= n; k++) {
    if (k > 0) logC += Math.log((n - k + 1) / k);
    const p = Math.exp(logC - n * Math.LN2);
    if (k >= right) tail += p;
  }
  return Math.min(1, tail);
}

/**
 * What the session is allowed to claim.
 *
 * Deliberately hard to get a compliment out of, and able to say the most
 * useful thing it could ever say: that the setup is not where the edge is.
 */
export function verdict(s) {
  if (!s || s.n < MIN_CALLS) {
    return { level: "thin",
      headline: `${s?.n || 0} calls is not enough to read anything into.`,
      detail: `Answer at least ${MIN_CALLS} in a session before the score means much. ` +
              `Below that a run of luck looks exactly like an eye for it.` };
  }
  const p = pAtLeast(s.right, s.n);
  if (p <= 0.05) {
    return { level: "real",
      headline: `${Math.round(s.accuracy)}% right — better than chance.`,
      detail: `A coin gets this or better about ${(p * 100).toFixed(1)}% of the time, ` +
              `so there is something in how you read a chart. The gap between ` +
              `precision and recall says which way you lean.` };
  }
  const pWorse = pAtLeast(s.n - s.right, s.n);
  if (pWorse <= 0.05) {
    return { level: "inverted",
      headline: `${Math.round(s.accuracy)}% right — worse than chance, which is information.`,
      detail: `Reliably wrong is not the same as random: something in these setups ` +
              `is reading as attractive to you and is not. Worth going through the ` +
              `ones you took that lost, one at a time.` };
  }
  return { level: "chance",
    headline: `${Math.round(s.accuracy)}% right — not distinguishable from chance.`,
    detail: `On ${s.n} calls a coin lands here often enough that this says nothing yet. ` +
            `Keep drilling — and if it settles here over a few hundred cards, that is ` +
            `a real finding: your edge is not in picking the setup, it is in sizing, ` +
            `stops and exits, which this journal measures elsewhere.` };
}

/* ------------------------------------------------------------------ *
 *  The reveal
 * ------------------------------------------------------------------ */

/**
 * What the trader wrote at the time, and what they tagged afterwards.
 *
 * The most useful thing this feature can put on screen is somebody's own
 * sentence from the day they took the trade, read back beside the outcome —
 * "volume looks thin" over a trade they took anyway. That is not analysis the
 * app performs; it is the trader's own words, returned at the moment they
 * mean something.
 */
export function reveal(card) {
  const t = card?.trade || {};
  const notes = (card?.shots || [])
    .map((d) => (d.body || "").trim())
    .filter(Boolean);
  const tags = t.mistakes || [];
  return {
    won: !!card?.won,
    pnl: t.pnl, r: t.r,
    heldDays: t.heldDays,
    exitReason: t.exit_reason || null,
    notes,
    errors: tags.filter(isExecutionError),
    outcomes: tags.filter((x) => !isExecutionError(x)),
  };
}
