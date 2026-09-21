-- ===================================================================
--  Migration 056 — what a trade has already been adjusted for
--
--  A split, or a bonus issue, restates a holding: ten for one turns
--  1.27 shares at $1,219 into 12.7 at $121.90. A broker's order book
--  states what happened on the day, so an imported position that has
--  lived through one carries the old numbers — and shows a 94% loss
--  that never happened, with an R built on a stop ten times too far
--  away.
--
--  The app can see the splits (Yahoo reports bonus issues as splits
--  too, which is why India needs no separate idea of one) and can
--  restate the position in one click. What it cannot do without this
--  column is REMEMBER. Offered again on the next page load, the same
--  adjustment applied twice turns 10:1 into 100:1 — and the second
--  application looks exactly as reasonable as the first.
--
--  So the date of the last split applied is written on the trade. It
--  is also the honest record: this row is stated in the terms of that
--  day forward.
--
--  Null everywhere, which is correct: nothing has been adjusted yet.
--
--  Purely additive. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.trades
  add column if not exists split_adjusted_to date;

comment on column public.trades.split_adjusted_to is
  'The date of the most recent split or bonus this row has been restated for. '
  'Null means none. Read by lib/splits.js so an adjustment is never applied twice.';

-- Verify:
--   select symbol, entry_date, quantity, entry_price, split_adjusted_to
--     from public.trades where split_adjusted_to is not null;
