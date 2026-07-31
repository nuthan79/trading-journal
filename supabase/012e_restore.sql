-- ===================================================================
--  012e — RESTORE.  Only if something went wrong, or as a rehearsal.
--
--  Puts every merged trade back exactly as 012a found it, under the
--  same ids, with its sells reattached.
--
--  WORTH RUNNING ONCE ON PURPOSE. Do 012a, then 012c, then this, and
--  check your trade count comes back to what it was. That is the
--  difference between having a backup and hoping you have one. Then
--  run 012a and 012c again for real.
--
--  Needs backup.trades_012 to still exist — so do not run 012f until
--  you are certain.
--
--  Supabase → SQL Editor → New query → paste all of this → Run.
--
--  EXPECT: two numbers matching what 012a printed.
-- ===================================================================

begin;

-- The survivors kept their ids, so this clears the merged rows and
-- anything still hanging off them.
delete from public.trade_exits
 where trade_id in (select id from backup.trades_012);
delete from public.trades
 where id in (select id from backup.trades_012);

insert into public.trades      select * from backup.trades_012;
insert into public.trade_exits select * from backup.exits_012;

commit;

select
  (select count(*) from public.trades t
     join backup.trades_012 b on b.id = t.id) as trades_restored,
  (select count(*) from public.trade_exits x
     join backup.exits_012  b on b.id = x.id) as sells_restored;
