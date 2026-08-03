-- ===================================================================
--  018 audit — are hand-entered trades getting their charges?
--
--  Reads only. Changes nothing. Safe to run any number of times.
--
--  THE SYMPTOM
--
--  A hand-entered position shows CHARGES ₹0 and "0.00% of size", with
--  zero against every sell as well, while an imported one alongside it
--  shows ₹2.4k at 0.21%. Both cannot be right, and the app has a charge
--  calculator that was supposed to make the first case unnecessary.
--
--  WHAT IT COULD BE, WHICH IS WHY THIS MEASURES RATHER THAN GUESSES
--
--   a) charges_auto is false on those rows — the field was switched to
--      manual and left at zero, so the computed figure was never
--      allowed to land. The DB default for that column is false.
--   b) charges_auto is true but charges is still zero — then the
--      calculator ran and produced nothing, which points at the broker
--      preset in profiles.charge_config rather than at the trade.
--   c) The trade is fine and only its exit tranches are empty, which
--      would put the fault in how a sell is recorded rather than how a
--      trade is.
--
--  Each of the three needs a different fix, and the difference between
--  them is visible below.
--
--  IMPORTANT: nothing here should be repaired by hand yet. A trade whose
--  charges were deliberately typed is an explicit override, and
--  overwriting one silently corrupts a real number — the same rule the
--  app follows when charges_auto is false.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================


-- -------------------------------------------------------------------
--  1. Every account, hand-entered against imported.
--
--  READ: the `zero_charges` column against `trades`. Imported rows take
--  their charges from the file and should be near zero here. A
--  hand-entered account with most of its rows at zero is the problem.
-- -------------------------------------------------------------------
select
  left(user_id::text, 8)                                     as account,
  case when imported then 'imported' else 'entered by hand' end as source,
  count(*)                                                   as trades,
  count(*) filter (where coalesce(charges, 0) = 0)           as zero_charges,
  count(*) filter (where charges_auto)                       as auto_on,
  count(*) filter (where not charges_auto)                   as auto_off,
  round(avg(nullif(charges, 0))::numeric, 2)                 as avg_when_charged
from public.trades
group by 1, 2
order by 1, 2;


-- -------------------------------------------------------------------
--  2. The sells underneath them.
--
--  A position's charges live partly on the trade and partly on each
--  tranche, so a zero on the trade alone is not the whole picture.
-- -------------------------------------------------------------------
select
  left(t.user_id::text, 8)                                     as account,
  case when t.imported then 'imported' else 'entered by hand' end as source,
  count(x.id)                                                  as sells,
  count(x.id) filter (where coalesce(x.charges, 0) = 0)        as sells_with_zero
from public.trades t
join public.trade_exits x on x.trade_id = t.id
group by 1, 2
order by 1, 2;


-- -------------------------------------------------------------------
--  3. Is a charge config even set?
--
--  An empty or zeroed charge_config would explain a calculator that
--  returns nothing, and would do it for every trade in that account.
-- -------------------------------------------------------------------
select
  left(id::text, 8)                                          as account,
  charge_config is null                                      as config_missing,
  charge_config ->> 'broker'                                 as broker,
  charge_config ->> 'brokeragePct'                           as brokerage_pct,
  charge_config ->> 'sttPct'                                 as stt_pct
from public.profiles
order by 1;


-- -------------------------------------------------------------------
--  4. The DIVISLAB row itself, with its sells.
--
--  charges_auto tells you which of the three causes it is.
-- -------------------------------------------------------------------
select
  left(t.user_id::text, 8)      as account,
  t.symbol, t.entry_date, t.status,
  t.quantity, t.entry_price,
  t.charges                     as trade_charges,
  t.charges_auto,
  t.charges_breakdown is null   as breakdown_missing,
  t.imported,
  x.exit_date, x.quantity       as sell_qty, x.price as sell_price,
  x.charges                     as sell_charges
from public.trades t
left join public.trade_exits x on x.trade_id = t.id
where t.symbol in ('DIVISLAB', 'DALBHARAT')
order by account, t.symbol, x.exit_date;
