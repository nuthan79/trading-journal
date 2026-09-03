-- ===================================================================
--  Migration 046 — the flag that outlives the import screen
--
--  An import matches a position on symbol AND entry date. Type the
--  buy date as the 12th when the contract note says the 11th and the
--  file matches nothing: it imports as its own trade, correct in every
--  figure, beside the one already there — which stays open forever,
--  holding stock that is gone.
--
--  The import preview names these before the button. That is not
--  enough. A preview is read once, under the impression that a run
--  which imported cleanly went well, and this is the case where every
--  row looks right precisely because both of them are.
--
--  So the finding is written onto the trade instead of only being
--  announced. `possible_duplicate_of` points at the open position the
--  new row may be a second copy of, and the flag shows in the journal
--  until it is dealt with — which is either acknowledging it, or
--  deleting the position it points at, and both end it.
--
--  WHAT IT IS NOT
--
--  Not a merge, and not a claim. The app cannot know whether these are
--  one position or two — buying the same stock twice on different days
--  is ordinary — so it says what it noticed and leaves the decision
--  where it belongs. Nothing here changes a quantity, a date or a P&L.
--
--  `on delete set null` rather than cascade: deleting the stale open
--  position is the commonest fix, and it must not take the correct
--  imported trade with it. The pointer simply goes away, and with it
--  the flag.
--
--  Purely additive, both nullable, no defaults. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.trades
  add column if not exists possible_duplicate_of uuid
    references public.trades (id) on delete set null;

alter table public.trades
  add column if not exists duplicate_ack_at timestamptz;

comment on column public.trades.possible_duplicate_of is
  'An open position this imported trade may be a second copy of, found '
  'because the symbol matched while the entry date did not. Advisory '
  'only: no quantity, date or P&L is affected by it. Null means nothing '
  'was noticed. Nulls itself if the position it points at is deleted.';

comment on column public.trades.duplicate_ack_at is
  'When the trader said they had checked the pair and these are two real '
  'positions. Null while the flag is still showing.';

-- Only the handful still flagged are ever looked up, so the index covers
-- just those rather than every trade that was ever checked.
create index if not exists trades_duplicate_open_idx
  on public.trades (user_id)
  where possible_duplicate_of is not null and duplicate_ack_at is null;

-- -------------------------------------------------------------------
--  Check
-- -------------------------------------------------------------------
select count(*) filter (where possible_duplicate_of is not null
                          and duplicate_ack_at is null)     as flagged,
       count(*) filter (where duplicate_ack_at is not null) as acknowledged,
       count(*)                                             as trades
  from public.trades;
