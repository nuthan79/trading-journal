-- ===================================================================
--  012b — PREVIEW.  Run this SECOND.  Reads only; changes nothing.
--
--  Shows you exactly what 012c would do, one row per position that
--  would be merged. Nothing is written, so run it as often as you like.
--
--  Supabase → SQL Editor → New query → paste all of this → Run.
--
--  EXPECT: 29 rows, every one reading `will merge` in the last
--          column. If you changed the account below, expect its own
--          count instead.
--
--  READ THE `verdict` COLUMN.
--    will merge   — this position gets folded into one row
--    SKIPPED …    — left alone because someone wrote on it by hand
--
--  The other columns are what the merged trade will look like:
--  merged_quantity is the two halves added up, merged_entry_price is
--  their average weighted by size, sells_carried_over is how many
--  exit tranches end up underneath it.
--
--  If the row count or the verdicts are not what you expect, STOP and
--  do not run 012c.
-- ===================================================================

-- -------------------------------------------------------------------
--  WHICH ACCOUNT.  Edit the eight characters below to repair a
--  different one; 012_scope_check.sql lists them. 3af0f255 is the
--  account measured through the app — 29 split positions, 59 trades.
--
--  Everything past this point is confined to that account. The other
--  account holding split positions (fa6d145f, 91 trades) is untouched
--  until you come back and change this line.
-- -------------------------------------------------------------------
with target as (
  select distinct user_id
    from public.trades
   where left(user_id::text, 8) = '3af0f255'
),
grp as (
  select user_id, symbol, entry_date, side
    from public.trades
   where user_id in (select user_id from target)
   group by user_id, symbol, entry_date, side
  having count(*) > 1
),
eligible as (
  select t.*
    from public.trades t
    join grp g using (user_id, symbol, entry_date, side)
),
-- A group qualifies only if EVERY row in it is safe to fold together.
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
)
select
  e.symbol,
  e.entry_date,
  e.side,
  count(*)                                              as rows_now,
  1                                                     as rows_after,
  sum(e.quantity)                                       as merged_quantity,
  round(sum(e.quantity * e.entry_price) / nullif(sum(e.quantity), 0), 2)
                                                        as merged_entry_price,
  round(sum(e.charges), 2)                              as merged_charges,
  (select count(*) from public.trade_exits x
    where x.trade_id in (select id from public.trades t2
                          where t2.user_id = e.user_id
                            and t2.symbol = e.symbol
                            and t2.entry_date = e.entry_date
                            and t2.side = e.side))       as sells_carried_over,
  case when s.symbol is null then 'SKIPPED — hand-entered or annotated'
       else 'will merge' end                            as verdict
from eligible e
left join safe s using (user_id, symbol, entry_date, side)
group by e.user_id, e.symbol, e.entry_date, e.side, s.symbol
order by verdict, e.symbol, e.entry_date;
