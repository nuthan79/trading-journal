-- ===================================================================
--  Trading Journal — schema
--  Paste this whole file into Supabase → SQL Editor → Run.
--  Safe to re-run.
-- ===================================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------------
--  Settings (one row per user)
-- -------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users on delete cascade,
  journal_name      text    not null default 'Breakout Ledger',
  account_size      numeric not null default 1000000,   -- INR
  default_risk_pct  numeric not null default 0.75,
  created_at        timestamptz not null default now()
);

-- -------------------------------------------------------------------
--  Trades
-- -------------------------------------------------------------------
create table if not exists public.trades (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users on delete cascade,

  symbol           text not null,                       -- RELIANCE
  company          text,                                -- Reliance Industries Ltd
  exchange         text not null default 'NSE' check (exchange in ('NSE','BSE')),
  side             text not null default 'long'  check (side   in ('long','short')),
  status           text not null default 'open'  check (status in ('open','closed')),

  -- position
  entry_date       date    not null,
  entry_price      numeric not null check (entry_price > 0),
  quantity         numeric not null check (quantity   > 0),
  -- NOT NULL here is the ORIGINAL shape, and migration 006 dropped it: an
  -- import arrives with no stop when the broker file has no stop column, and
  -- both this and stop_source come through null. Read this file as the
  -- starting point and the numbered migrations as what happened since —
  -- believing this line is how a predicate came to be named hasRealStop
  -- while passing trades that had no stop at all.
  stop_loss        numeric not null check (stop_loss  > 0),

  -- setup
  pattern          text,
  pivot_price      numeric,
  vol_pct_avg      numeric,        -- % of 30-day average volume (100 = average)
  weinstein_stage  smallint check (weinstein_stage between 1 and 4),
  rs_rank          smallint check (rs_rank between 1 and 99),

  -- exit
  exit_date        date,
  exit_price       numeric,
  exit_reason      text,
  charges          numeric not null default 0,   -- brokerage + STT + all costs

  -- review
  mistakes         text[] not null default '{}',
  notes            text,

  -- cached mark-to-market for open positions
  last_price       numeric,
  last_price_at    timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint closed_needs_exit check (
    status = 'open' or (exit_price is not null and exit_date is not null)
  )
);

create index if not exists trades_user_entry_idx on public.trades (user_id, entry_date desc);
create index if not exists trades_user_status_idx on public.trades (user_id, status);

-- -------------------------------------------------------------------
--  Diary
-- -------------------------------------------------------------------
create table if not exists public.diary_entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  entry_date   date not null default current_date,
  emotions     text[] not null default '{}',
  body         text,
  trade_id     uuid references public.trades on delete set null,
  image_path   text,                        -- path inside the 'charts' storage bucket
  created_at   timestamptz not null default now(),
  -- Nullable on purpose: null means never edited, which the diary renders as
  -- the absence of an "edited" marker. See 024_diary_edited.sql.
  updated_at   timestamptz
);

create index if not exists diary_user_date_idx on public.diary_entries (user_id, entry_date desc);

-- -------------------------------------------------------------------
--  Capital flows — what makes XIRR possible
--  amount > 0 = money added to the account, < 0 = withdrawn
-- -------------------------------------------------------------------
create table if not exists public.capital_flows (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  flow_date  date not null,
  amount     numeric not null check (amount <> 0),
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists flows_user_date_idx on public.capital_flows (user_id, flow_date);

-- -------------------------------------------------------------------
--  Row level security — every table, every user sees only their rows
-- -------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.trades        enable row level security;
alter table public.diary_entries enable row level security;
alter table public.capital_flows enable row level security;

do $$
declare t text;
begin
  foreach t in array array['trades','diary_entries','capital_flows'] loop
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format(
      'create policy own_rows on public.%I for all
         using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;

drop policy if exists own_profile on public.profiles;
create policy own_profile on public.profiles for all
  using (auth.uid() = id) with check (auth.uid() = id);

-- -------------------------------------------------------------------
--  Create a profile row automatically on signup
-- -------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------------------
--  Keep updated_at honest
-- -------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trades_touch on public.trades;
create trigger trades_touch before update on public.trades
  for each row execute function public.touch_updated_at();

-- The diary shows its stamp to the reader, so it gets a guard trades doesn't
-- need: a save that changed nothing must not brand the entry as edited.
drop trigger if exists diary_entries_touch on public.diary_entries;
create trigger diary_entries_touch before update on public.diary_entries
  for each row when (old.* is distinct from new.*)
  execute function public.touch_updated_at();

-- -------------------------------------------------------------------
--  Storage bucket for chart screenshots (private, per-user folders)
-- -------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('charts', 'charts', false)
on conflict (id) do nothing;

drop policy if exists own_charts on storage.objects;
create policy own_charts on storage.objects for all
  using      (bucket_id = 'charts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'charts' and (storage.foldername(name))[1] = auth.uid()::text);
