-- ===================================================================
--  Migration 052 — which market a trade belongs to
--
--  PHASE 1 OF GOING INTERNATIONAL, and deliberately the invisible one.
--  Nothing in the app reads these columns yet; the region switch is
--  behind SHOW_REGIONS in src/lib/flags.js. This migration exists so
--  that by the time anything does read them, every row already has an
--  honest answer.
--
--  A REGION IS A SEPARATE BOOK. India and the US each get their own
--  account size, their own capital ledger, their own equity curve.
--  Nothing ever sums a rupee to a dollar: an exchange rate would make
--  a finished Indian trade's P&L move whenever the dollar moves, which
--  is false — the trade made what it made. R and win rate are ratios
--  and stay comparable across both, which is the honest way to
--  compare, and is where this ends up.
--
--  'IN' EVERYWHERE, INCLUDING ON ROWS WRITTEN BEFORE TODAY. Every
--  trade in the database is an NSE or BSE trade, so the default is the
--  truth rather than a placeholder — no backfill, no ambiguity, and a
--  journal that has never heard of regions keeps behaving exactly as
--  it does now.
--
--  WHY per-region settings ARE jsonb AND NOT MORE COLUMNS. India's
--  account size and risk % keep the columns they have; a second market
--  would otherwise mean account_size_us, default_risk_pct_us,
--  charge_config_us, and a third would mean three more. The India
--  values stay exactly where they are, so nothing reads differently
--  for the users who have one.
--
--  Purely additive. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.trades
  add column if not exists region text not null default 'IN';

alter table public.capital_flows
  add column if not exists region text not null default 'IN';

alter table public.profiles
  add column if not exists region text not null default 'IN',
  add column if not exists region_settings jsonb not null default '{}'::jsonb;

comment on column public.trades.region is
  'Which market this trade was taken in: IN (NSE/BSE) or US. A region is a '
  'separate book — no screen sums across two currencies.';

comment on column public.profiles.region is
  'The region this user last had selected. Remembered on the profile rather '
  'than in the browser so it follows them across devices.';

comment on column public.profiles.region_settings is
  'Per-region account size, risk %% and charge config for regions OTHER than '
  'India, which keeps the existing top-level columns. Shape: '
  '{"US": {"account_size": 25000, "default_risk_pct": 0.75}}';

-- Only the regions the app knows. A typo here would split somebody's book in
-- two silently, and the row would still look right in every listing.
alter table public.trades  drop constraint if exists trades_region_known;
alter table public.trades  add  constraint trades_region_known  check (region in ('IN', 'US'));
alter table public.capital_flows drop constraint if exists capital_flows_region_known;
alter table public.capital_flows add constraint capital_flows_region_known check (region in ('IN', 'US'));
alter table public.profiles drop constraint if exists profiles_region_known;
alter table public.profiles add  constraint profiles_region_known check (region in ('IN', 'US'));

-- Every screen will filter by region, and the trades table is already the
-- hot one.
create index if not exists trades_user_region_idx on public.trades (user_id, region);

-- Verify:
--   select region, count(*) from public.trades group by region;
