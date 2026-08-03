-- ===================================================================
--  018c — the trades with no cost recorded anywhere
--
--  Reads only. One query.
--
--  018b put the scale at six of 124 hand-entered trades, plus a tail in
--  the imported accounts. This names them, with the turnover each one
--  would have been charged on, so the size of what is missing is
--  visible rather than estimated.
--
--  READ `would_have_cost_about`: statutory charges only — stamp duty,
--  exchange, SEBI and the GST on them — at the standard rates, with no
--  brokerage. It is a floor, not the figure the app would compute, and
--  it is there to answer "does this matter" rather than to be written
--  anywhere.
--
--  `fixable_in_the_app` is the useful column. A row with charges_auto
--  false is one the app has been told not to touch; opening the trade
--  and pressing the small `auto` button beside the charges field hands
--  it back to the calculator. That is the safe repair, because it is the
--  trader choosing per trade rather than a query overwriting figures it
--  cannot tell apart from deliberate ones.
--
--  Supabase → SQL Editor → New query → paste all of this → Run.
-- ===================================================================

with per_trade as (
  select
    t.id, t.user_id, t.imported, t.symbol, t.entry_date, t.status,
    t.quantity, t.entry_price, t.exit_price, t.acquisition,
    t.charges_auto,
    coalesce(t.charges, 0)          as charges,
    coalesce(sum(x.charges), 0)     as sell_charges,
    coalesce(sum(x.quantity * x.price), 0) as sell_turnover
  from public.trades t
  left join public.trade_exits x on x.trade_id = t.id
  group by t.id
)
select
  left(user_id::text, 8)                                        as account,
  case when imported then 'imported' else 'entered by hand' end as source,
  symbol, entry_date, status, quantity, entry_price,
  acquisition,
  charges_auto,
  round((
    -- buy leg: stamp duty is buy-side only
    (quantity * entry_price) * (0.00015 + 0.0000297 + 0.000001)
    -- sell leg: no stamp duty, but STT applies on delivery sells
    + sell_turnover * (0.001 + 0.0000297 + 0.000001)
  )::numeric, 0)                                                as would_have_cost_about,
  case
    when acquisition = 'bonus' then 'free shares — a zero here is correct'
    when not charges_auto then 'yes — open it and press the auto button'
    else 'no — auto is already on, so this needs looking at'
  end                                                           as fixable_in_the_app
from per_trade
where charges = 0
  and sell_charges = 0
order by source, would_have_cost_about desc nulls last;
