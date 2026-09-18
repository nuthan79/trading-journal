-- ===================================================================
--  Migration 050 — the user's own MTF settings
--
--    mtf_pledge_fee    rupees charged to pledge shares bought on MTF,
--                      once per buy. Was fixed at ₹18 in the code.
--    mtf_unpledge_fee  rupees charged to unpledge them for a sale,
--                      once per sell. Was fixed at ₹18.
--    mtf_in_pnl        true  — MTF (interest with those two fees) comes
--                              out of P&L and R, as it has since 71bba50;
--                      false — MTF is worked out and shown as an expense,
--                              and taken out of nothing.
--
--  The defaults are exactly what the app did before this existed, so
--  running this changes no figure until the user changes a setting. The
--  app also falls back to the same values when these columns are absent,
--  and only writes them when a user changes one in Setup, so there is no
--  wrong order to deploy and migrate in.
--
--  Fees may be zero (a broker that charges none); never negative.
--
--  Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.profiles
  add column if not exists mtf_pledge_fee   numeric not null default 18,
  add column if not exists mtf_unpledge_fee numeric not null default 18,
  add column if not exists mtf_in_pnl       boolean not null default true;

alter table public.profiles drop constraint if exists profiles_mtf_pledge_fee_check;
alter table public.profiles add constraint profiles_mtf_pledge_fee_check
  check (mtf_pledge_fee >= 0);

alter table public.profiles drop constraint if exists profiles_mtf_unpledge_fee_check;
alter table public.profiles add constraint profiles_mtf_unpledge_fee_check
  check (mtf_unpledge_fee >= 0);

comment on column public.profiles.mtf_pledge_fee is
  'Rupees to pledge shares bought on MTF, charged once per buy. Default 18.';
comment on column public.profiles.mtf_unpledge_fee is
  'Rupees to unpledge MTF shares for a sale, charged once per sell. Default 18.';
comment on column public.profiles.mtf_in_pnl is
  'True: MTF (interest plus pledge and unpledge) is taken out of P&L and R. '
  'False: it is worked out and shown as an expense only.';

-- -------------------------------------------------------------------
--  Check — should list all three columns with their defaults
-- -------------------------------------------------------------------
select column_name, data_type, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles'
   and column_name in ('mtf_pledge_fee', 'mtf_unpledge_fee', 'mtf_in_pnl')
 order by column_name;
