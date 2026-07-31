-- ===================================================================
--  012d — CHECK.  Run this FOURTH, after 012c.  Reads only.
--
--  Three questions, answered in one result each.
--
--  Supabase → SQL Editor → New query → paste all of this → Run.
-- ===================================================================

-- 1. Are there any split positions left?
--    EXPECT: no rows at all. Anything here was not merged.
select symbol, entry_date, side, count(*) as still_split
  from public.trades
 group by symbol, entry_date, side
having count(*) > 1
 order by symbol;


-- 2. Did the money survive?
--    EXPECT: trades_now is 30 lower than before (1098 → 1068 on the
--    Zerodha Testing account) and net_pnl is UNCHANGED. The merge
--    moves sells between rows; it never adds or drops one.
select
  (select count(*) from public.trades)                     as trades_now,
  (select count(*) from public.trade_exits)                as sells_now,
  (select round(sum(quantity * price) - sum(charges), 2)
     from public.trade_exits)                              as gross_out_less_exit_charges;


-- 3. Did every sell keep a trade to hang off?
--    EXPECT: 0. An orphan would mean a tranche pointing at a row that
--    was deleted, which is the one thing that would lose real history.
select count(*) as orphaned_sells
  from public.trade_exits x
  left join public.trades t on t.id = x.trade_id
 where t.id is null;
