-- ===================================================================
--  Migration 012 — merge positions that one import split in two
--
--  WHAT THIS IS FIXING
--
--  A Zerodha Tax P&L file reports only the lots matched inside its own
--  financial year. A position bought once and sold down across two
--  years therefore appears in two files: the first showing the sells
--  made that year, the second showing the rest.
--
--  Imported before migration 009, each file inserted its own row. The
--  money was never double-counted — the two rows carry different sells
--  — but one real position ended up recorded as two trades, each with
--  a slice of the quantity and its own R against that slice.
--
--  It also blocks every future import for that symbol and date. The
--  importer matches a sell to a position by symbol and entry date, and
--  when two positions share both it cannot tell which one the sell
--  belongs to. It refuses to guess, so those rows are held back at the
--  preview and the exits never land.
--
--  This merges each split back into one position with its sells as
--  tranches, which is exactly what the importer produces today.
--
--  WHAT IT DELIBERATELY WILL NOT TOUCH
--
--  Only groups where every row is a closed, imported trade carrying no
--  writing of your own — no note, no pattern, no thesis, no mistake
--  tag. A position you entered or annotated by hand is never merged,
--  because two trades on one day may well be two decisions you meant
--  to record separately. Side is part of the key, so a long and a short
--  opened the same day stay apart.
--
--  WHAT CHANGES, HONESTLY
--
--  Net P&L, charges and every sell are preserved exactly. Trade count
--  falls. Total R moves slightly: R is currently pnl/risk per fragment
--  and summed, and afterwards it is one ratio over the whole position.
--  The second is the right number; it is not the same number.
--
--  NOT RE-RUNNABLE IN THE USUAL SENSE — it is idempotent only because
--  a merged group no longer has two rows to find. Running it twice is
--  harmless; the second run reports zero.
--
--  Run PART 1 on its own first and read what it says. Run PART 2 when
--  you are happy with it. Take a backup before PART 2.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================


-- -------------------------------------------------------------------
--  PART 1 — preview. Reads only; writes nothing. Run this by itself.
-- -------------------------------------------------------------------
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
),
-- A group qualifies only if EVERY row in it is safe to fold together.
safe as (
  select user_id, symbol, entry_date, side
    from eligible
   group by user_id, symbol, entry_date, side
  having bool_and(status = 'closed')
     and bool_and(imported is true)
     and bool_and(coalesce(notes, '') = '')
     and bool_and(coalesce(pattern, '') = '')
     and bool_and(coalesce(thesis, '') = '')
     and bool_and(coalesce(array_length(mistakes, 1), 0) = 0)
)
select
  e.symbol,
  e.entry_date,
  e.side,
  count(*)                                              as rows_now,
  1                                                     as rows_after,
  sum(e.quantity)                                       as merged_quantity,
  round(sum(e.quantity * e.entry_price) / nullif(sum(e.quantity), 0), 2)
                                                        as merged_entry_price,
  round(sum(e.charges), 2)                              as merged_charges,
  (select count(*) from public.trade_exits x
    where x.trade_id in (select id from public.trades t2
                          where t2.user_id = e.user_id
                            and t2.symbol = e.symbol
                            and t2.entry_date = e.entry_date
                            and t2.side = e.side))       as sells_carried_over,
  case when s.symbol is null then 'SKIPPED — hand-entered or annotated'
       else 'will merge' end                            as verdict
from eligible e
left join safe s using (user_id, symbol, entry_date, side)
group by e.user_id, e.symbol, e.entry_date, e.side, s.symbol
order by verdict, e.symbol, e.entry_date;


-- -------------------------------------------------------------------
--  PART 2 — the merge. Everything below is one transaction: it either
--  all lands or none of it does.
-- -------------------------------------------------------------------
begin;

create temporary table merge_plan on commit drop as
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
safe as (
  select user_id, symbol, entry_date, side
    from eligible
   group by user_id, symbol, entry_date, side
  having bool_and(status = 'closed')
     and bool_and(imported is true)
     and bool_and(coalesce(notes, '') = '')
     and bool_and(coalesce(pattern, '') = '')
     and bool_and(coalesce(thesis, '') = '')
     and bool_and(coalesce(array_length(mistakes, 1), 0) = 0)
),
rows_in_play as (
  select e.* from eligible e join safe s using (user_id, symbol, entry_date, side)
),
-- The oldest row survives, so the position keeps the identity it has
-- had longest. id breaks a tie on identical timestamps.
ranked as (
  select id, user_id, symbol, entry_date, side, quantity, entry_price, charges,
         stop_loss, initial_stop_loss,
         row_number() over (partition by user_id, symbol, entry_date, side
                            order by created_at, id) as rn
    from rows_in_play
)
select
  (select id from ranked r2
    where r2.user_id = r.user_id and r2.symbol = r.symbol
      and r2.entry_date = r.entry_date and r2.side = r.side
      and r2.rn = 1)                                     as keep_id,
  r.id                                                   as row_id,
  r.rn                                                   as rn
from ranked r;

-- 1. Every sell moves onto the surviving position. Nothing is deleted:
--    the tranches are the record of what actually happened.
update public.trade_exits x
   set trade_id = p.keep_id
  from merge_plan p
 where x.trade_id = p.row_id
   and p.rn > 1;

-- 2. The survivor takes on the whole position. Entry price is weighted
--    by quantity, which is what the importer does with two fills on one
--    day inside a single file.
with totals as (
  select p.keep_id,
         sum(t.quantity)                                     as qty,
         sum(t.quantity * t.entry_price) / nullif(sum(t.quantity), 0) as entry,
         sum(t.charges)                                      as charges
    from merge_plan p
    join public.trades t on t.id = p.row_id
   group by p.keep_id
),
-- The stop is re-derived at the percentage it already sat at, so an
-- assumed 18% stays an assumed 18% of the new entry rather than a
-- number left over from one fragment.
pct as (
  select t.id,
         case when t.entry_price > 0 and t.initial_stop_loss > 0
              then (t.entry_price - t.initial_stop_loss) / t.entry_price
         end as frac
    from public.trades t
)
update public.trades t
   set quantity          = totals.qty,
       entry_price       = round(totals.entry, 2),
       charges           = round(totals.charges, 2),
       -- Left alone where there was no stop to take a percentage from,
       -- rather than overwritten with a null. A trade with no stop keeps
       -- having no stop; it does not lose one it had.
       initial_stop_loss = case when pct.frac is not null
                                then round(totals.entry * (1 - pct.frac), 2)
                                else t.initial_stop_loss end,
       stop_loss         = case when pct.frac is not null
                                then round(totals.entry * (1 - pct.frac), 2)
                                else t.stop_loss end,
       updated_at        = now()
  from totals
  join pct on pct.id = totals.keep_id
 where t.id = totals.keep_id;

-- 3. The legacy single-exit columns are a summary of the tranches, so
--    they are restated from them: last sell out, average price in.
--    schema.sql requires both to be present on a closed trade.
with agg as (
  select x.trade_id,
         max(x.exit_date)                                       as last_out,
         sum(x.quantity * x.price) / nullif(sum(x.quantity), 0)  as avg_price
    from public.trade_exits x
   where x.trade_id in (select keep_id from merge_plan)
   group by x.trade_id
)
update public.trades t
   set exit_date  = agg.last_out,
       exit_price = round(agg.avg_price, 2)
  from agg
 where t.id = agg.trade_id;

-- 4. The absorbed rows go. Their sells were moved in step 1, so the
--    cascade on trade_exits has nothing left to take with it.
delete from public.trades t
 using merge_plan p
 where t.id = p.row_id
   and p.rn > 1;

commit;


-- -------------------------------------------------------------------
--  Afterwards — should return no rows at all.
-- -------------------------------------------------------------------
-- select symbol, entry_date, side, count(*)
--   from public.trades
--  group by symbol, entry_date, side
-- having count(*) > 1;
