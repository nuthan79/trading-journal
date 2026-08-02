-- ===================================================================
--  Migration 017 — acknowledging the breakeven reminder
--
--  The flag beside a holding says the trade has run past 1.5R and its
--  stop could go to breakeven at the broker. Having read it, there is
--  nothing to do with it: it stays lit on every visit, and a reminder
--  that cannot be dismissed stops being read.
--
--  This records that it was seen. One nullable timestamp, and the flag
--  hides once it is set.
--
--  WHAT IT IS NOT
--
--  Not a stop, and not connected to one. The flag used to write the
--  entry price into stop_loss so the dial would stop counting the
--  position, which gave every trade two stops and made a mistyped one
--  impossible to correct. That is gone and is not coming back. This
--  column says "I saw this and dealt with it at my broker" and nothing
--  else — no R moves, no risk figure changes, no stop is touched.
--
--  Purely additive, nullable, no default. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.trades
  add column if not exists breakeven_ack_at timestamptz;

comment on column public.trades.breakeven_ack_at is
  'When the trader dismissed the breakeven reminder for this position. '
  'An acknowledgement only — it moves no stop and changes no R. Null '
  'means the flag is still showing.';

-- -------------------------------------------------------------------
--  Check
-- -------------------------------------------------------------------
select count(*) filter (where breakeven_ack_at is not null) as acknowledged,
       count(*)                                             as trades
  from public.trades;
