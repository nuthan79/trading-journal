-- ===================================================================
--  Migration 049 — trades bought on margin (MTF)
--
--  Two figures per trade, both copied from the broker rather than
--  worked out here:
--
--    mtf_leverage  position value ÷ your own money. At 2.35 your
--                  ₹1,00,000 bought ₹2,35,000 and the broker funded
--                  the rest. Null means the trade was not on margin.
--    mtf_rate      interest in RUPEES PER LAKH PER DAY on the funded
--                  part — ₹40 is 0.04% a day, the way brokers quote it.
--
--  And one per user:
--
--    profiles.mtf_rate  the rate last used, filled in on the next
--                       margin trade until the user types another.
--                       On the profile rather than in the browser so
--                       it follows them to another machine.
--
--  Interest itself is NOT stored. It depends on how long each part of
--  the position was held, which changes every day a position is open
--  and every time part of it is sold; stored, it would be wrong by
--  tomorrow. src/lib/mtf.js works it out from these two numbers.
--
--  Checked, not just typed: a leverage of 1 or less borrows nothing and
--  a rate of zero or less charges nothing, so neither is a margin trade
--  and both would put a nonsense cost on the page.
--
--  Purely additive, nullable, no default. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.trades
  add column if not exists mtf_leverage numeric,
  add column if not exists mtf_rate     numeric;

alter table public.profiles
  add column if not exists mtf_rate numeric;

alter table public.trades drop constraint if exists trades_mtf_leverage_check;
alter table public.trades add constraint trades_mtf_leverage_check
  check (mtf_leverage is null or mtf_leverage > 1);

alter table public.trades drop constraint if exists trades_mtf_rate_check;
alter table public.trades add constraint trades_mtf_rate_check
  check (mtf_rate is null or mtf_rate > 0);

alter table public.profiles drop constraint if exists profiles_mtf_rate_check;
alter table public.profiles add constraint profiles_mtf_rate_check
  check (mtf_rate is null or mtf_rate > 0);

comment on column public.trades.mtf_leverage is
  'MTF leverage as the broker states it: position value divided by the trader''s '
  'own money. 2.35 means 1 lakh of their own bought 2.35 lakh. Null = not on margin.';
comment on column public.trades.mtf_rate is
  'MTF interest in rupees per lakh per day on the funded part (40 = 0.04% a day). '
  'Interest is computed from this and the holding period, never stored.';
comment on column public.profiles.mtf_rate is
  'The MTF rate this user last saved a trade with, offered as the default next time.';

-- -------------------------------------------------------------------
--  Check — should list all three columns
-- -------------------------------------------------------------------
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'trades'   and column_name in ('mtf_leverage', 'mtf_rate'))
     or (table_name = 'profiles' and column_name = 'mtf_rate'))
 order by table_name, column_name;
