-- ===================================================================
--  012 scope check — WHO owns the rows 012a backed up?
--
--  Reads only. Run before 012c.
--
--  012a reported 150 trades in split groups. Measured through the app,
--  the signed-in account had 59. The gap matters: the browser sees only
--  its own rows because RLS filters them, while the SQL Editor runs as
--  postgres and sees the whole table. So either other accounts have
--  split positions of their own, or something is grouping that should
--  not be.
--
--  This answers which, before anything is merged.
--
--  Supabase → SQL Editor → New query → paste all of this → Run.
-- ===================================================================

-- 1. Split groups broken down by owner.
--    If several user_ids appear, the extra rows belong to other
--    accounts and 012c would merge their positions too. That may be
--    fine — it groups by user_id, so nothing crosses between accounts —
--    but it should be a decision, not a surprise.
select
  t.user_id,
  count(*)                                        as trades_in_split_groups,
  count(distinct (t.symbol, t.entry_date, t.side)) as split_positions,
  min(t.entry_date)                               as earliest,
  max(t.entry_date)                               as latest,
  bool_and(t.imported)                            as all_imported
from public.trades t
join (
  select user_id, symbol, entry_date, side
    from public.trades
   group by user_id, symbol, entry_date, side
  having count(*) > 1
) g using (user_id, symbol, entry_date, side)
group by t.user_id
order by trades_in_split_groups desc;


-- 2. How many accounts hold trades at all, for context.
select count(distinct user_id) as accounts_with_trades,
       count(*)                as trades_total
  from public.trades;


-- 3. The other possible cause: rows with nothing to group ON.
--    A batch of trades sharing a null symbol, entry_date or side would
--    collapse into one enormous "group" and be merged into a single
--    trade. EXPECT 0. If this is not 0, do not run 012c.
select count(*) as rows_missing_a_grouping_key
  from public.trades
 where symbol is null or entry_date is null or side is null;


-- 4. What 012c would actually merge, versus what it would skip,
--    across the whole table. The `safe` filter is the one in 012b/012c.
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
verdicts as (
  select user_id, symbol, entry_date, side,
         count(*) as rows_now,
         (bool_and(status = 'closed')
      and bool_and(imported is true)
      and bool_and(coalesce(notes, '') = '')
      and bool_and(coalesce(pattern, '') = '')
      and bool_and(coalesce(thesis, '') = '')
      and bool_and(coalesce(array_length(mistakes, 1), 0) = 0)) as will_merge
    from eligible
   group by user_id, symbol, entry_date, side
)
select will_merge,
       count(*)        as positions,
       sum(rows_now)   as trades,
       sum(rows_now) - count(*) as rows_that_would_be_deleted
  from verdicts
 group by will_merge;
