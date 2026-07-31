-- ===================================================================
--  012 diagnose — WHERE DID THE BROKEN ENTRY PRICES COME FROM?
--
--  Reads only. Changes nothing.
--
--  After 012c the app shows three trades with an impossible entry
--  price — GARFIBRES 432 shares at 0.16 selling at 886, AJANTPHARM 3 at
--  3.33 selling at 1276, CHOLAFIN 50 at 123.55 selling at 1300. Risk is
--  then near zero and R runs to five figures.
--
--  Two candidates, and they need separating before anything is undone:
--
--    a) the merge did it — the quantity-weighted entry price is wrong,
--       which would mean 012c is unsafe and everything should go back;
--
--    b) it was already like that — the import's `grow` path sets
--       quantity to the largest figure it has seen and entry_price to
--       whatever the newest file said, and those two need not describe
--       the same lot. That corruption is older than the merge and the
--       merge only made it visible.
--
--  backup.trades_012 is the pre-merge state. If a row is not in it, the
--  merge never touched that trade and (b) is the answer.
--
--  Supabase → SQL Editor → New query → paste all of this → Run.
-- ===================================================================

with suspects as (
  select id, symbol, entry_date, quantity, entry_price, initial_stop_loss,
         imported, import_batch, created_at, updated_at
    from public.trades
   where left(user_id::text, 8) = '3af0f255'
     and entry_price > 0
     and quantity    > 0
     -- An entry price wildly below where the trade actually sold is the
     -- signature: nobody buys at 0.16 and sells at 886.
     and exit_price / entry_price > 5
)
select
  s.symbol,
  s.entry_date,
  s.quantity                            as qty_now,
  s.entry_price                         as entry_now,
  round(s.quantity * s.entry_price, 2)  as cost_implied_now,
  case when b.id is null
       then 'NOT in the backup — the merge never touched this row'
       else 'was merged'
  end                                   as touched_by_012c,
  b.quantity                            as qty_before_merge,
  b.entry_price                         as entry_before_merge,
  s.import_batch,
  s.created_at,
  s.updated_at
from suspects s
left join backup.trades_012 b on b.id = s.id
order by s.exit_price / s.entry_price desc;
