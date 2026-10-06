/**
 * When the open winners are carrying enough to be worth protecting.
 *
 * WHY A SHARE OF CAPITAL, NOT A RUPEE FIGURE. The user's own line was ₹5L, on
 * an account where that is a tenth of the capital. A fixed ₹5L would never
 * fire on a ₹2L account and would never go quiet on a ₹5Cr one, so the rule
 * travels as the proportion: open profit worth a tenth of the account.
 *
 * WINNERS ONLY, on purpose. An open loser does not make the winners' gains
 * any safer — ₹6L up on three positions is ₹6L that a regime turn can take
 * back, whatever two others are down. Netting them would hide exactly the
 * money the reminder is about.
 *
 * NO ACCOUNT SIZE, NO ALERT. The app falls back to ₹10L when none is set so
 * nothing divides by zero; a reminder built on that invented figure would
 * fire at ₹1L for someone who never said what they trade with.
 */
export const OPEN_PROFIT_SHARE = 0.10;

export function openProfitAlert(open, accountSize) {
  if (!(accountSize > 0)) return null;
  const winners = (open || []).filter((t) => isFinite(t.unrealisedPnl) && t.unrealisedPnl > 0);
  const profit = winners.reduce((a, t) => a + t.unrealisedPnl, 0);
  const threshold = accountSize * OPEN_PROFIT_SHARE;
  if (profit < threshold) return null;
  return { profit, winners: winners.length, threshold, share: (profit / accountSize) * 100 };
}
