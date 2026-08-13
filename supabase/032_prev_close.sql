-- ===================================================================
--  Migration 032 — yesterday's close, so "today" can be shown
--
--  Holdings can already say what a position has made since entry. It
--  cannot say what it did TODAY, because the only price kept is the
--  current one, and a change needs two numbers.
--
--  The quote source has been returning `prevClose` all along —
--  src/lib/quotes.js line 63 — and markOpenPositions was dropping it on
--  the floor, writing only last_price. So this is one column and one
--  field in a patch that already runs.
--
--  THE INVARIANT THAT MATTERS. prev_close is written in the SAME update
--  as last_price, always, including when the quote comes back without
--  one — in which case it is set to NULL rather than left alone.
--
--  Leaving it alone would be the tempting choice: why throw away a good
--  value? Because the pair would then come from two different fetches,
--  and today's change would be computed against a close from some other
--  day. That is not a missing number, it is a wrong one, printed in
--  rupees next to real ones, with nothing to mark it as suspect. A blank
--  cell is recoverable; a plausible wrong figure is not.
--
--  ON WHAT "TODAY" MEANS. The pair is only as fresh as the last fetch,
--  which is whenever the user last hit Refresh Prices — so on a Monday
--  morning, before any refresh, this is Friday's move, not today's. The
--  Holdings header already says the values are "at the last CMP
--  fetched"; the column should lean on last_price_at rather than assert
--  a day of its own.
--
--  Purely additive. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.trades
  add column if not exists prev_close numeric;

comment on column public.trades.prev_close is
  'Previous close, from the same quote fetch as last_price — the two are '
  'written together and prev_close is nulled when a fetch has no close, so '
  'that today''s change is never computed across two different days.';
