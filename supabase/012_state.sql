-- ===================================================================
--  012 state — DID THE MERGE HAPPEN?
--
--  Reads only. Changes nothing. Safe to run any number of times.
--
--  012c reported positions_merged 0, which means its plan table came
--  out empty. That has two very different causes and they need telling
--  apart before anything else is run:
--
--    a) the merge already succeeded on an earlier run, so there are no
--       split positions left to find and a second run correctly does
--       nothing;
--    b) it never matched anything, and the 59 rows are untouched.
--
--  backup.trades_012 is the pre-merge state, captured by 012a. Comparing
--  it against the live table answers this exactly rather than by
--  inference.
--
--  Supabase → SQL Editor → New query → paste all of this → Run.
--
--  HOW TO READ IT
--    'rows_absorbed' 30  → the merge WORKED. Go to 012d_check.sql.
--    'rows_absorbed'  0  → nothing happened. Send me the whole result.
-- ===================================================================

select 1 as ord,
       'backed up for account 3af0f255' as measure,
       count(*)::text as value
  from backup.trades_012
 where left(user_id::text, 8) = '3af0f255'

union all
select 2,
       'of those, still in the trades table',
       count(t.id)::text
  from backup.trades_012 b
  left join public.trades t on t.id = b.id
 where left(b.user_id::text, 8) = '3af0f255'

union all
select 3,
       'rows_absorbed (expect 30 if the merge ran)',
       (count(*) - count(t.id))::text
  from backup.trades_012 b
  left join public.trades t on t.id = b.id
 where left(b.user_id::text, 8) = '3af0f255'

union all
select 4,
       'split positions left in account 3af0f255',
       coalesce((
         select count(*)::text from (
           select 1 from public.trades
            where left(user_id::text, 8) = '3af0f255'
            group by user_id, symbol, entry_date, side
           having count(*) > 1
         ) z), '0')

union all
select 5, 'trades in the whole table now', count(*)::text from public.trades

union all
select 6,
       'the plan table 012c wrote',
       case when to_regclass('backup.merge_plan_012') is null
            then 'does not exist — 012c never got that far'
            else (select count(*)::text from backup.merge_plan_012) || ' rows'
       end

union all
-- If this is not 0 the account prefix is the problem, not the merge.
select 7,
       'accounts matching prefix 3af0f255 (must be 1)',
       count(distinct user_id)::text
  from public.trades
 where left(user_id::text, 8) = '3af0f255'

order by ord;
