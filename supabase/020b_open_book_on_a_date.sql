-- ===================================================================
--  020b — what was actually open on the day the count peaked
--
--  READS ONLY. Changes nothing. Run PART 1, then PART 2.
--
--  WHY 020 CAME BACK EMPTY, AND WHAT THAT RULED OUT
--
--  020 looked for closed trades whose sells fall short of what was
--  bought — positions the old code would have held open forever. It
--  found none. That kills the theory, and usefully: it means exits are
--  complete and positions really do close. The book being at 1 today
--  says the same thing.
--
--  So on 28 Jul 22 the record genuinely holds 303 things open. The
--  question left is whether that is 303 DIFFERENT holdings, or a much
--  smaller book recorded many times over.
--
--  There is good reason to suspect the second. This project already
--  knows about split positions — one real position stored as several
--  rows — and migration 012 was written to fold them back together. It
--  was run against 3af0f255 and never against fa6d145f, which still
--  has 91 of them outstanding. Each fragment is counted as its own
--  concurrent position.
--
--  PART 1 answers it in one line: rows open that day versus distinct
--  symbols open that day. If those two numbers are close, the book was
--  genuinely that wide and nothing is wrong. If rows are a large
--  multiple of symbols, the count is fragmentation.
--
--  CHANGE THE DATE if your own peak sits elsewhere — the tile on the
--  deployment screen names the day.
-- ===================================================================

-- -------------------------------------------------------------------
--  PART 1 — the shape of the book that day, per account
-- -------------------------------------------------------------------
with as_of as (select date '2022-07-28' as d),
open_then as (
  select
    t.user_id,
    t.symbol,
    t.id,
    t.quantity,
    t.entry_price,
    coalesce((
      select sum(x.quantity)
        from public.trade_exits x
       where x.trade_id = t.id
         and x.exit_date <= (select d from as_of)
    ), 0) as sold_by_then
  from public.trades t, as_of
  where t.entry_date <= as_of.d
)
select
  left(user_id::text, 8)                                    as account,
  count(*)                                                  as rows_open,
  count(distinct symbol)                                    as distinct_symbols,
  round(count(*)::numeric / nullif(count(distinct symbol), 0), 1)
                                                            as rows_per_symbol,
  round(sum((quantity - sold_by_then) * entry_price)::numeric, 0)
                                                            as committed_then,
  round(avg((quantity - sold_by_then) * entry_price)::numeric, 0)
                                                            as avg_row_size
from open_then
where quantity - sold_by_then > 0.000001
group by 1
order by rows_open desc;

-- -------------------------------------------------------------------
--  PART 2 — the symbols carrying the most rows that day.
--
--  Run this after PART 1. Put the account prefix PART 1 showed into the
--  quotes below.
--
--  READ `rows_for_this_symbol`. One or two is a normal position, maybe
--  bought in two lots. Ten of the same symbol all open on one day is
--  one position wearing ten coats — the thing 012 folds back together.
--
--  `distinct_entry_dates` separates the two honest explanations: ten
--  rows across ten dates is someone scaling into a position over time,
--  which is real. Ten rows on ONE date is a single fill split apart,
--  which is not.
-- -------------------------------------------------------------------
-- with as_of as (select date '2022-07-28' as d),
-- open_then as (
--   select t.user_id, t.symbol, t.id, t.entry_date, t.quantity, t.entry_price,
--          coalesce((select sum(x.quantity) from public.trade_exits x
--                     where x.trade_id = t.id and x.exit_date <= (select d from as_of)), 0)
--            as sold_by_then
--     from public.trades t, as_of
--    where t.entry_date <= as_of.d
-- )
-- select symbol,
--        count(*)                          as rows_for_this_symbol,
--        count(distinct entry_date)        as distinct_entry_dates,
--        min(entry_date)                   as first_entry,
--        max(entry_date)                   as last_entry,
--        round(sum((quantity - sold_by_then) * entry_price)::numeric, 0) as committed
--   from open_then
--  where quantity - sold_by_then > 0.000001
--    and left(user_id::text, 8) = 'PASTE-PREFIX'
--  group by symbol
--  order by rows_for_this_symbol desc, committed desc
--  limit 40;
