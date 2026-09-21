/**
 * Positions caught by a split — or a bonus issue, which is the same
 * arithmetic under another name.
 *
 * WHAT GOES WRONG WITHOUT THIS. A broker's order book states the price and
 * quantity of the day the order filled. When the stock splits ten for one,
 * the same holding becomes ten times the shares at a tenth the price, and
 * every figure the journal derives from the old numbers is wrong: the entry
 * price against today's mark (Netflix bought at $1,219.69, marked at $73.34 —
 * a 94% loss that never happened), the stop and therefore R, the percentage
 * move, and the P&L of anything sold on the other side of it.
 *
 * A BONUS IS A SPLIT HERE. One new share for each held is two shares where
 * there was one, which the source reports as 2:1 — see `splitsFor`. India
 * calls it a bonus and the arithmetic does not care.
 *
 * DIVIDENDS ARE NOT IN THIS FILE, ON PURPOSE. A dividend is cash arriving
 * beside a position, not a change to it: no figure already in the journal
 * becomes wrong when one is paid. Folding them into a trade's P&L would
 * quietly redefine R and return — and on swing trades held for weeks they
 * are noise besides. If they are ever wanted they belong in a ledger of
 * their own, not in the trade.
 *
 * WHAT IS ADJUSTED, AND WHAT IS LEFT ALONE. Everything about the position
 * dated BEFORE the split is restated in post-split terms — quantity up by
 * the ratio, prices down by it, including the stop, the pinned initial stop
 * and the pivot. Anything dated after it is already in those terms. So a
 * trade that opened and closed before a split is untouched: both its legs
 * agree with each other, and "adjusting" it would falsify what happened.
 */

const day = (d) => String(d || "").slice(0, 10);
const round2 = (v) => Math.round(v * 100) / 100;
/* Quantities keep their fractions — a US book deals in them, and a ratio of
   3:2 turns 5 shares into 7.5. */
const round4 = (v) => Math.round(v * 1e4) / 1e4;

/** The last day this position had any activity. */
function lastLeg(t) {
  const exits = (t.exits || []).map((e) => day(e.exit_date)).filter(Boolean);
  return exits.length ? exits.sort().pop() : day(t.exit_date) || null;
}

/**
 * Which splits still apply to a trade.
 *
 * A split counts when it happened AFTER the position was opened and while
 * something was still held — so an open position takes every split since it
 * was bought, and a closed one takes only those before its last sell.
 *
 * `split_adjusted_to` is how a trade remembers what has already been applied.
 * Without it the same adjustment is offered again the moment the page
 * reloads, and applying it twice turns 10:1 into 100:1.
 */
export function splitsDue(trade, splits = []) {
  const entry = day(trade?.entry_date);
  if (!entry) return [];
  const done = day(trade?.split_adjusted_to);
  const out = day(trade?.status === "closed" ? lastLeg(trade) : null);
  return splits
    .filter((s) => s?.date && s.ratio > 0 && s.ratio !== 1)
    .filter((s) => s.date > entry)
    .filter((s) => !done || s.date > done)
    .filter((s) => !out || s.date <= out)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * What one trade would become. Returns null when nothing applies.
 *
 * The exits are restated leg by leg: a sell BEFORE the split was in old
 * shares at old prices and moves with the entry; a sell after it was already
 * in new ones and does not.
 */
export function adjustForSplits(trade, splits = []) {
  const due = splitsDue(trade, splits);
  if (!due.length) return null;
  const factor = due.reduce((a, s) => a * s.ratio, 1);
  if (!(factor > 0) || factor === 1) return null;

  const over = (v, f) => (Number.isFinite(Number(v)) && Number(v) !== 0 ? round2(Number(v) / f) : v);
  const exits = (trade.exits || []).map((e) => {
    /* Only the splits this particular sell predates. */
    const f = due.filter((s) => s.date > day(e.exit_date)).reduce((a, s) => a * s.ratio, 1);
    return f === 1 ? e : { ...e, quantity: round4(Number(e.quantity) * f), price: over(e.price, f) };
  });

  return {
    id: trade.id,
    symbol: trade.symbol,
    exchange: trade.exchange,
    entryDate: day(trade.entry_date),
    factor,
    splits: due,
    quantity: round4(Number(trade.quantity) * factor),
    entry_price: over(trade.entry_price, factor),
    stop_loss: over(trade.stop_loss, factor),
    initial_stop_loss: over(trade.initial_stop_loss, factor),
    pivot_price: over(trade.pivot_price, factor),
    /* The mirrors of the last sell, which the trigger keeps in step with the
       tranches but which must not be left in old money in the meantime. */
    exit_price: (trade.exits || []).length ? undefined : over(trade.exit_price, factor),
    exits,
    split_adjusted_to: due[due.length - 1].date,
    /* For the card: what it says now, and what it would say. */
    was: { quantity: Number(trade.quantity), entry_price: Number(trade.entry_price) },
  };
}

/**
 * Every trade in the book that a split has overtaken.
 *
 * `splits` is keyed "SYMBOL:EXCHANGE", as the API returns it. A symbol with
 * no entry is a stock that has never split, which is most of them.
 */
export function splitPlan(trades = [], splits = {}) {
  const plan = [];
  for (const t of trades) {
    if (String(t?.id || "").startsWith("demo-")) continue;
    const key = `${String(t.symbol || "").toUpperCase()}:${String(t.exchange || "").toUpperCase()}`;
    const found = adjustForSplits(t, splits[key] || []);
    if (found) plan.push(found);
  }
  return plan;
}

/** The symbols worth asking about: one entry per symbol and venue. */
export const symbolsOf = (trades = []) => {
  const seen = new Set();
  for (const t of trades) {
    const key = `${String(t?.symbol || "").toUpperCase()}:${String(t?.exchange || "").toUpperCase()}`;
    if (t?.symbol && t?.exchange) seen.add(key);
  }
  return [...seen];
};

/**
 * PROVE IT AGAINST THE MARKET BEFORE OFFERING IT.
 *
 * The dates say a split happened while this position was held. They cannot
 * say whether the row is still in the old shares — and that is the difference
 * between a fix and a corruption, because applying the adjustment twice
 * multiplies the quantity and divides the price by the same number:
 *
 *   bought 1 at 1200, sold 10 at 130      P&L +100
 *   adjusted once:  10 at 120             P&L +100   ← right
 *   adjusted twice: 100 at 12             P&L +100   ← nonsense, same P&L
 *
 * So the one figure anybody would check it with is the one figure that cannot
 * tell. `split_adjusted_to` stops US doing it twice; it cannot know that a
 * broker's file arrived already adjusted, and Stockal's report says in its own
 * notes that it sometimes does.
 *
 * The proof is the price on the day. Yahoo restates closes after a split, so a
 * close is always in TODAY's shares: a row whose entry is about `factor` times
 * that day's close is in old money and should be adjusted; a row whose entry
 * is about equal to it is already in new money and must be left alone.
 *
 * `closes` is keyed "SYMBOL:EXCHANGE" and holds the close on the entry date.
 * A candidate with no price to check against is reported, never adjusted —
 * an unprovable fix is the one thing worse than no fix.
 */
export const VERIFY_TOLERANCE = 0.35;

export function verifySplitPlan(plan = [], closes = {}) {
  return plan.map((p) => {
    const close = Number(closes[`${String(p.symbol).toUpperCase()}:${String(p.exchange || "").toUpperCase()}`]);
    const entry = Number(p.was?.entry_price);
    if (!(close > 0) || !(entry > 0)) {
      return { ...p, verdict: "unknown",
               why: "No price for that day to check against, so this is left alone." };
    }
    const ratio = entry / close;
    const near = (a, b) => Math.abs(a - b) / b <= VERIFY_TOLERANCE;
    if (near(ratio, p.factor)) {
      return { ...p, verdict: "pre-split", close,
               why: `Bought at ${entry}, and the stock closed at ${close.toFixed(2)} that day — ` +
                    `${Math.round(ratio * 100) / 100}× apart, which is the split.` };
    }
    if (near(ratio, 1)) {
      return { ...p, verdict: "already-adjusted", close,
               why: `Bought at ${entry}, and the stock closed at ${close.toFixed(2)} that day — ` +
                    `these already agree, so your broker's file was adjusted before you imported it.` };
    }
    return { ...p, verdict: "unknown", close,
             why: `Bought at ${entry} against a close of ${close.toFixed(2)} that day: ` +
                  `neither the split nor no split explains that, so this is left alone.` };
  });
}

/** The entry dates a verification needs, as "SYMBOL:EXCHANGE:YYYY-MM-DD". */
export const priceKeysFor = (plan = []) =>
  plan.map((p) => `${String(p.symbol).toUpperCase()}:${String(p.exchange || "").toUpperCase()}:${day(p.entryDate || p.entry_date)}`)
      .filter((k) => !k.endsWith(":"));
