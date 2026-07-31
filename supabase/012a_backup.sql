-- ===================================================================
--  012a — BACKUP.  Run this FIRST.  Writes nothing to your trades.
--
--  Copies every trade that 012c is going to merge, plus all their
--  sells, into a `backup` schema. If anything goes wrong later,
--  012e_restore.sql puts them back exactly as they are right now.
--
--  Its own schema rather than `public`, because PostgREST serves the
--  public schema — a copy of the trades table there would be readable
--  through the API by anyone holding the anon key.
--
--  Supabase → SQL Editor → New query → paste all of this → Run.
--
--  EXPECT: one row, two numbers, both greater than zero.
--          On the Zerodha Testing account: 59 and rather more.
--          If either is 0, stop and say so — nothing to restore from.
-- ===================================================================

create schema if not exists backup;
revoke all on schema backup from anon, authenticated;

drop table if exists backup.trades_012;
drop table if exists backup.exits_012;

create table backup.trades_012 as
select t.*
  from public.trades t
  join (
    select user_id, symbol, entry_date, side
      from public.trades
     group by user_id, symbol, entry_date, side
    having count(*) > 1
  ) g using (user_id, symbol, entry_date, side);

create table backup.exits_012 as
select x.*
  from public.trade_exits x
 where x.trade_id in (select id from backup.trades_012);

revoke all on all tables in schema backup from anon, authenticated;

select
  (select count(*) from backup.trades_012) as trades_backed_up,
  (select count(*) from backup.exits_012)  as sells_backed_up;
