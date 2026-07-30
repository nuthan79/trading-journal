-- ===================================================================
--  Migration 011 — remember where a stop came from
--
--  WHY THIS EXISTS
--
--  An imported Tax P&L file has no stops in it, so 1070 trades sit
--  with none and every R figure in the journal stays blank. Applying
--  one assumed percentage to all of them makes the whole thing work
--  and answers a fair question: what would my record look like if I
--  had risked a consistent 7% every time?
--
--  It is a what-if, and it has to stay labelled as one. A 7% stop
--  makes R a straight rescaling of percentage return — a trade that
--  made 21% is +3.00R by arithmetic, not by anything that happened.
--  Left unmarked, in six months there is no way to tell a stop that
--  was actually set from one this app invented, and the difference is
--  the entire meaning of every R on the screen.
--
--  It also protects the review. "Losses are running past the stop"
--  fires on losses worse than −1.15R. Against an invented stop that
--  finding accuses the trader of indiscipline over a line they never
--  drew. With this column the check can confine itself to stops that
--  were really set.
--
--  Purely additive. Safe to re-run.
--
--  Run in Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.trades
  add column if not exists stop_source text
    check (stop_source in ('recorded', 'assumed'));

-- Everything with a stop today was put there deliberately — by hand in
-- the form, or through StopFill one at a time. Nothing before this
-- migration was ever generated, so 'recorded' is the truthful backfill.
update public.trades
   set stop_source = 'recorded'
 where stop_source is null
   and stop_loss is not null;

create index if not exists trades_stop_source_idx
  on public.trades (user_id, stop_source)
  where stop_source is not null;

-- -------------------------------------------------------------------
--  Verify.
--
--  recorded  — stops that were genuinely set. Should equal the number
--              of trades that had a stop before this ran.
--  assumed   — 0 today; grows only when you ask for it.
--  no_stop   — still waiting, and still honest about it.
--  UNMARKED  — must be 0. A stop with no provenance is the thing this
--              column exists to prevent.
-- -------------------------------------------------------------------
select count(*) filter (where stop_source = 'recorded')        as recorded,
       count(*) filter (where stop_source = 'assumed')         as assumed,
       count(*) filter (where stop_loss is null)               as no_stop,
       count(*) filter (where stop_loss is not null
                          and stop_source is null)             as unmarked,
       count(*)                                                as total
  from public.trades;
