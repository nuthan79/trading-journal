-- ===================================================================
--  012 scope check — WHO owns the rows, and is anything ungroupable?
--
--  Reads only. Run before 012c.
--
--  ONE query on purpose. The SQL Editor shows the result of the last
--  statement only, so a file of four separate selects silently throws
--  three of them away — which is exactly what happened the first time
--  this was asked.
--
--  Supabase → SQL Editor → New query → paste all of this → Run.
--
--  READ THE FIRST ROW FIRST. If it is not 0, stop and do not run 012c:
--  SQL groups nulls together, so rows with no symbol, entry date or
--  side would collapse into one group and be merged into one trade.
--
--  The `account …` rows show which accounts own split positions. 012c
--  groups by user_id, so nothing ever merges across accounts — but if
--  more than yours appears, that is other people's data being changed
--  and should be a decision rather than a surprise.
-- ===================================================================

with grp as (
  select user_id, symbol, entry_date, side
    from public.trades
   group by user_id, symbol, entry_date, side
  having count(*) > 1
),
eligible as (
  select t.*
    from public.trades t
    join grp g using (user_id, symbol, entry_date, side)
)
select 1 as ord,
       'MUST BE 0 — rows with a null symbol, entry_date or side' as question,
       count(*)::text as answer
  from public.trades
 where symbol is null or entry_date is null or side is null

union all
select 2, 'accounts holding trades', count(distinct user_id)::text
  from public.trades

union all
select 3, 'trades in the whole table', count(*)::text
  from public.trades

union all
select 4, 'accounts owning split positions', count(distinct user_id)::text
  from eligible

union all
select 5,
       'account ' || left(user_id::text, 8) || ' — trades in split groups',
       count(*)::text
  from eligible
 group by user_id

order by ord, question;
