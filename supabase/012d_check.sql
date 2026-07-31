-- ===================================================================
--  012d — CHECK.  Run this FOURTH, after 012c.  Reads only.
--
--  Four questions, one result, a row each.
--
--  Supabase → SQL Editor → New query → paste all of this → Run.
-- ===================================================================

-- ONE query, because the SQL Editor shows the last statement's result
-- only. Read every row.
--
-- Since 012c is scoped to one account, split positions belonging to the
-- OTHER account are expected to remain — that is not a failure, it is
-- the scoping working. The row that must be 0 is the orphan count.
with grp as (
  select user_id, symbol, entry_date, side
    from public.trades
   group by user_id, symbol, entry_date, side
  having count(*) > 1
)
select 1 as ord,
       'MUST BE 0 — sells whose trade no longer exists' as question,
       count(*)::text as answer
  from public.trade_exits x
  left join public.trades t on t.id = x.trade_id
 where t.id is null

union all
select 2, 'trades now in the whole table', count(*)::text from public.trades

union all
select 3, 'sells now in the whole table', count(*)::text from public.trade_exits

union all
select 4,
       'account ' || left(user_id::text, 8) || ' — trades still in split groups',
       count(*)::text
  from public.trades t
  join grp g using (user_id, symbol, entry_date, side)
 group by user_id

order by ord, question;
