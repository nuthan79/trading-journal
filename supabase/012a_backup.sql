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
--  The editor may warn about "destructive operations". That is the
--  three DROPs below, which only ever target the backup tables — never
--  your trades. On a first run they do not exist yet and nothing is
--  dropped. They are there so this file can be re-run cleanly.
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

-- Three locks on a copy of the trades table, which is the least it
-- deserves: the schema isn't served by PostgREST, the grants are
-- revoked, and RLS is on with no policy — so nothing reaches these rows
-- unless it comes in as postgres, which is what the SQL Editor and the
-- restore in 012e do. Without this the editor stops to ask.
alter table backup.trades_012 enable row level security;
alter table backup.exits_012  enable row level security;

select
  (select count(*) from backup.trades_012) as trades_backed_up,
  (select count(*) from backup.exits_012)  as sells_backed_up;
