-- ===================================================================
--  Migration 042 — "no stop on record" as an answer, not a gap
--
--  WHY
--
--  1170 of 1192 trades on a real journal carry an assumed stop, and
--  the queue that lists them cannot empty. The only ways out were:
--
--    · type a number that is not true, which puts an invented 1R
--      under every R figure in the app, or
--    · leave it assumed, and be nagged for ever.
--
--  A Zerodha tax P&L has no stop column. The importer assumed one
--  because the FILE lacked it, not because the trader did — so for
--  an old trade nobody can say which, and there was no honest move.
--
--  This is the third answer. It says the stop is not on record and
--  never will be, which is always true of these trades, rather than
--  "I traded without a stop", which often is not.
--
--  WHAT IT CHANGES
--
--  A trade marked this way sits out of every R statistic — there is
--  no 1R to measure against. It stays in every money statistic: net
--  P&L, win rate by count, XIRR and holding period are all knowable
--  without a stop, and dropping them would be a second error.
--
--  stop_loss is untouched and still holds whatever was there. The
--  column is `not null check (> 0)` so zero was never storable, and
--  a stop of zero would mean "breakeven" rather than "none" anyway.
--  Nothing reads it while stop_source is 'none'.
--
--  REVERSIBLE. Marking a trade this way does not stop somebody
--  typing a real stop later if they dig the number out.
--
--  Purely additive — widens a check constraint, writes no rows.
--
--  Supabase -> SQL Editor -> New query -> Run.
-- ===================================================================

alter table public.trades
  drop constraint if exists trades_stop_source_check;

alter table public.trades
  add constraint trades_stop_source_check
  check (stop_source in ('recorded', 'assumed', 'none'));

comment on column public.trades.stop_source is
  'recorded = the trader set this stop, and R means what it says. '
  'assumed = the importer invented it because the file carried no stop '
  'column; a to-do, still correctable. '
  'none = no stop is on record and never will be; settled, excluded from '
  'every R statistic and kept in every money statistic.';

-- -------------------------------------------------------------------
--  Check
-- -------------------------------------------------------------------
select coalesce(stop_source, '(null)') as stop_source,
       count(*)                        as trades
  from public.trades
 group by 1
 order by 2 desc;
