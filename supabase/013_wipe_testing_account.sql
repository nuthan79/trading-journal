-- ===================================================================
--  013 wipe — empty the Zerodha Testing account and start again
--
--  THIS DELETES EVERY TRADE IN ONE ACCOUNT. There is no undo beyond
--  re-importing the files.
--
--  Asked for deliberately: the trades in 3af0f255 came from Tax P&L
--  files edited by hand to get zero-cost rows past an importer that
--  should not have refused them. Some of those entry prices are
--  fabricated and there is no way to tell, row by row, which. Re-
--  importing clean files is more trustworthy than repairing them.
--
--  WHAT IT LEAVES ALONE
--    · every other account
--    · your diary, capital flows, profile, settings and charge config
--    · the 012 backups, which still hold the pre-merge state
--
--  RUN 013_zero_cost_shares.sql FIRST, and re-import only after the
--  rebuilt importer is in place — otherwise the same files produce the
--  same wrong numbers.
--
--  Supabase → SQL Editor → New query → Run.
--
--  EXPECT: one row showing what was removed and a trades count of 0.
-- ===================================================================

do $$
declare
  -- ---------------------------------------------------------------
  --  WHICH ACCOUNT. 3af0f255 is Zerodha Testing.
  -- ---------------------------------------------------------------
  v_prefix constant text := '3af0f255';

  v_user   uuid;
  v_n      int;
  v_trades int;
  v_exits  int;
begin
  select count(distinct user_id) into v_n
    from public.trades
   where left(user_id::text, 8) = v_prefix;

  if v_n <> 1 then
    raise exception 'expected exactly one account for prefix %, matched %',
      v_prefix, v_n;
  end if;

  select distinct user_id into v_user
    from public.trades
   where left(user_id::text, 8) = v_prefix;

  select count(*) into v_trades from public.trades where user_id = v_user;
  select count(*) into v_exits
    from public.trade_exits where user_id = v_user;

  -- Kept as the record of what was thrown away, and as the last resort
  -- if a file turns out to be unreproducible.
  drop table if exists backup.wiped_013_trades;
  drop table if exists backup.wiped_013_exits;

  create table backup.wiped_013_trades as
    select * from public.trades where user_id = v_user;
  create table backup.wiped_013_exits as
    select * from public.trade_exits where user_id = v_user;

  alter table backup.wiped_013_trades enable row level security;
  alter table backup.wiped_013_exits  enable row level security;

  -- trade_exits cascades from trades, but deleting it explicitly means
  -- the count above is the count that goes, not an inference.
  delete from public.trade_exits where user_id = v_user;
  delete from public.trades       where user_id = v_user;

  raise notice 'removed % trades and % sells from %', v_trades, v_exits, v_user;
end $$;

select
  (select count(*) from backup.wiped_013_trades) as trades_removed,
  (select count(*) from backup.wiped_013_exits)  as sells_removed,
  (select count(*) from public.trades
    where left(user_id::text, 8) = '3af0f255')   as trades_left_should_be_0;
