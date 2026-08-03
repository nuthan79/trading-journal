-- ===================================================================
--  018b — how widespread is the missing-charges problem?
--
--  Reads only. ONE query, because the SQL Editor returns the result of
--  the last statement and a file of several throws the rest away. That
--  is the second time in this project; 018 should have been one query.
--
--  WHAT IS ALREADY KNOWN
--
--  The calculator works: a hand-entered open position in account
--  fa6d145f carries ₹1,007.52 with charges_auto true and a full
--  breakdown. The importer works: its sells carry real figures from the
--  file. What failed is one row in 4742b877 with charges_auto false, so
--  the computed figure was never allowed to land.
--
--  WHAT THIS ANSWERS: whether that is one row or a habit, and whether
--  hand-entered positions across every account are quietly recording no
--  cost at all.
--
--  READ `pct_zero` on the "entered by hand" lines. Imported rows are
--  expected to show zero on the trade — their charges sit on the sells,
--  which is why sells_zero_pct is the honest column for those.
--
--  Supabase → SQL Editor → New query → paste all of this → Run.
-- ===================================================================

with per_trade as (
  select
    t.user_id,
    t.imported,
    t.id,
    coalesce(t.charges, 0)                                as charges,
    t.charges_auto,
    coalesce(sum(x.charges), 0)                           as sell_charges,
    count(x.id)                                           as sells
  from public.trades t
  left join public.trade_exits x on x.trade_id = t.id
  group by t.user_id, t.imported, t.id, t.charges, t.charges_auto
)
select
  left(user_id::text, 8)                                        as account,
  case when imported then 'imported' else 'entered by hand' end as source,
  count(*)                                                      as trades,
  -- The figure that matters: nothing recorded anywhere on the position.
  count(*) filter (where charges = 0 and sell_charges = 0)      as no_cost_at_all,
  round(100.0 * count(*) filter (where charges = 0 and sell_charges = 0)
        / nullif(count(*), 0), 1)                               as pct_zero,
  count(*) filter (where charges_auto)                          as auto_on,
  count(*) filter (where not charges_auto)                      as auto_off,
  count(*) filter (where sells > 0)                             as with_sells,
  count(*) filter (where sells > 0 and sell_charges = 0)        as sells_all_zero,
  round(avg(nullif(charges + sell_charges, 0))::numeric, 2)     as avg_cost_when_recorded
from per_trade
group by 1, 2
order by 1, 2;
