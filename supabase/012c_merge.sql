-- ===================================================================
--  012c — THE MERGE.  Run this THIRD.  THIS ONE CHANGES YOUR DATA.
--
--  Do not run it until 012a_backup.sql has printed two non-zero counts
--  and 012b_preview.sql has shown you a list you are happy with.
--
--  Folds each split position back into one trade with its sells as
--  tranches — which is what the importer produces today. Net P&L and
--  charges come out identical to the rupee. Trade count falls, and R
--  is restated against the whole position rather than each fragment.
--
--  Everything below is a single transaction: it all lands or none of
--  it does. Run the whole file at once, not statement by statement.
--
--  Supabase → SQL Editor → New query → paste all of this → Run.
--
--  EXPECT: "Success. No rows returned." Then run 012d_check.sql.
-- ===================================================================

begin;

create temporary table merge_plan on commit drop as
with grp as (
  select user_id, symbol, entry_date, side
    from public.trades
   group by user_id, symbol, entry_date, side
  having count(*) > 1
),
eligible as (
  select t.* from public.trades t
    join grp g using (user_id, symbol, entry_date, side)
),
safe as (
  select user_id, symbol, entry_date, side
    from eligible
   group by user_id, symbol, entry_date, side
  having bool_and(status = 'closed')
     and bool_and(imported is true)
     and bool_and(coalesce(notes, '') = '')
     and bool_and(coalesce(pattern, '') = '')
     and bool_and(coalesce(thesis, '') = '')
     and bool_and(coalesce(array_length(mistakes, 1), 0) = 0)
),
rows_in_play as (
  select e.* from eligible e join safe s using (user_id, symbol, entry_date, side)
),
-- The oldest row survives, so the position keeps the identity it has
-- had longest. id breaks a tie on identical timestamps.
ranked as (
  select id, user_id, symbol, entry_date, side, quantity, entry_price, charges,
         stop_loss, initial_stop_loss,
         row_number() over (partition by user_id, symbol, entry_date, side
                            order by created_at, id) as rn
    from rows_in_play
)
select
  (select id from ranked r2
    where r2.user_id = r.user_id and r2.symbol = r.symbol
      and r2.entry_date = r.entry_date and r2.side = r.side
      and r2.rn = 1)                                     as keep_id,
  r.id                                                   as row_id,
  r.rn                                                   as rn
from ranked r;

-- 1. Every sell moves onto the surviving position. Nothing is deleted:
--    the tranches are the record of what actually happened.
update public.trade_exits x
   set trade_id = p.keep_id
  from merge_plan p
 where x.trade_id = p.row_id
   and p.rn > 1;

-- 2. The survivor takes on the whole position. Entry price is weighted
--    by quantity, which is what the importer does with two fills on one
--    day inside a single file.
with totals as (
  select p.keep_id,
         sum(t.quantity)                                     as qty,
         sum(t.quantity * t.entry_price) / nullif(sum(t.quantity), 0) as entry,
         sum(t.charges)                                      as charges
    from merge_plan p
    join public.trades t on t.id = p.row_id
   group by p.keep_id
),
-- The stop is re-derived at the percentage it already sat at, so an
-- assumed 18% stays an assumed 18% of the new entry rather than a
-- number left over from one fragment.
pct as (
  select t.id,
         case when t.entry_price > 0 and t.initial_stop_loss > 0
              then (t.entry_price - t.initial_stop_loss) / t.entry_price
         end as frac
    from public.trades t
)
update public.trades t
   set quantity          = totals.qty,
       entry_price       = round(totals.entry, 2),
       charges           = round(totals.charges, 2),
       -- Left alone where there was no stop to take a percentage from,
       -- rather than overwritten with a null. A trade with no stop keeps
       -- having no stop; it does not lose one it had.
       initial_stop_loss = case when pct.frac is not null
                                then round(totals.entry * (1 - pct.frac), 2)
                                else t.initial_stop_loss end,
       stop_loss         = case when pct.frac is not null
                                then round(totals.entry * (1 - pct.frac), 2)
                                else t.stop_loss end,
       updated_at        = now()
  from totals
  join pct on pct.id = totals.keep_id
 where t.id = totals.keep_id;

-- 3. The legacy single-exit columns are a summary of the tranches, so
--    they are restated from them: last sell out, average price in.
--    schema.sql requires both to be present on a closed trade.
with agg as (
  select x.trade_id,
         max(x.exit_date)                                       as last_out,
         sum(x.quantity * x.price) / nullif(sum(x.quantity), 0)  as avg_price
    from public.trade_exits x
   where x.trade_id in (select keep_id from merge_plan)
   group by x.trade_id
)
update public.trades t
   set exit_date  = agg.last_out,
       exit_price = round(agg.avg_price, 2)
  from agg
 where t.id = agg.trade_id;

-- 4. The absorbed rows go. Their sells were moved in step 1, so the
--    cascade on trade_exits has nothing left to take with it.
delete from public.trades t
 using merge_plan p
 where t.id = p.row_id
   and p.rn > 1;

commit;
