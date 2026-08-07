-- ===================================================================
--  020 — closed trades whose sells do not add up to what was bought
--
--  READS ONLY. Changes nothing. One query, so the SQL Editor returns it.
--
--  WHY THIS EXISTS
--
--  The deployment chart showed 303 concurrent positions in one account
--  against 1 held today, with the count climbing steadily for two and a
--  half years. A swing book does not do that; an accumulating counter
--  does.
--
--  The cause was in the app: the deployment series decided a position
--  was finished by adding up its exit tranches, and never consulted
--  trades.status. So a trade the database calls CLOSED, whose sells
--  fall even one share short of its quantity, stayed open in that
--  series for the rest of the record — holding a slot in the position
--  count and its leftover cost in committed capital. That is fixed:
--  status is authoritative there now, as it already was everywhere
--  else.
--
--  THIS QUERY IS THE OTHER HALF. The fix stops the symptom. It does not
--  tell you why the quantities disagree, and that is worth knowing,
--  because the same shortfall means the P&L and R on those trades are
--  computed against a position size that was never fully accounted for.
--
--  HOW TO READ IT
--
--  shortfall_qty  — bought minus sold, on a trade marked closed.
--                   Positive means shares were never sold on the record.
--  cost_adrift    — that shortfall at the entry price. This is what the
--                   old chart was holding open forever.
--
--  WHAT THE CAUSES USUALLY ARE
--    · a tax P&L file that carried the sell in a different financial
--      year from the buy, so only one leg was imported
--    · bonus or demerger shares merged into a position whose sells
--      predate them
--    · a hand edit to quantity after the exits were recorded
--    · the split positions that 012 was written for, in an account
--      where it was never run — fa6d145f still has 91 of them
--
--  Nothing here needs fixing for the chart's sake. Fix a row only if
--  its quantity is genuinely wrong, and fix it in the app so the
--  charges and R are recomputed with it.
--
--  Supabase → SQL Editor → New query → paste all of this → Run.
-- ===================================================================

with per_trade as (
  select
    t.id,
    t.user_id,
    t.symbol,
    t.entry_date,
    t.status,
    t.imported,
    t.acquisition,
    t.quantity                                   as bought,
    t.entry_price,
    coalesce(sum(x.quantity), 0)                 as sold,
    count(x.id)                                  as tranches,
    max(x.exit_date)                             as last_sell
  from public.trades t
  left join public.trade_exits x on x.trade_id = t.id
  group by t.id
),
flagged as (
  select
    *,
    bought - sold                                as shortfall_qty,
    (bought - sold) * entry_price                as cost_adrift
  from per_trade
  where status = 'closed'
    and bought - sold > 0.000001
)
select
  left(user_id::text, 8)                                          as account,
  count(*)                                                        as closed_trades_short,
  count(*) filter (where tranches = 0)                            as with_no_sells_at_all,
  count(*) filter (where imported)                                as imported,
  count(*) filter (where acquisition = 'bonus')                   as free_shares,
  round(sum(cost_adrift)::numeric, 0)                             as total_cost_adrift,
  round(max(cost_adrift)::numeric, 0)                             as worst_single_trade,
  min(entry_date)                                                 as earliest,
  max(entry_date)                                                 as latest
from flagged
group by 1
order by closed_trades_short desc;

-- -------------------------------------------------------------------
--  Then, to name the worst offenders in one account, swap the prefix
--  and run this instead. Still reads only.
-- -------------------------------------------------------------------
-- with per_trade as (
--   select t.id, t.user_id, t.symbol, t.entry_date, t.status, t.imported,
--          t.quantity as bought, t.entry_price,
--          coalesce(sum(x.quantity), 0) as sold, count(x.id) as tranches
--     from public.trades t
--     left join public.trade_exits x on x.trade_id = t.id
--    group by t.id
-- )
-- select symbol, entry_date, bought, sold,
--        bought - sold                                as shortfall_qty,
--        round(((bought - sold) * entry_price)::numeric, 0) as cost_adrift,
--        tranches, imported
--   from per_trade
--  where status = 'closed'
--    and bought - sold > 0.000001
--    and left(user_id::text, 8) = 'PASTE-PREFIX'
--  order by cost_adrift desc
--  limit 50;
