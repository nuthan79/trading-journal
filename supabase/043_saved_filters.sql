-- ===================================================================
--  043 — Saved views on the trades table
--
--  A saved filter is an ENTITY, not a setting, which is why this is a
--  table and not another jsonb column on `profiles`. They are created,
--  renamed, reordered and deleted one at a time; a jsonb array would
--  make every one of those a read-modify-write of the whole profile
--  row, and two tabs saving different filters would silently lose one.
--
--  `rules` is jsonb because the rule vocabulary lives in
--  src/lib/filters.js and will grow — a column per operand would need a
--  migration every time a field is added to a dropdown. The shape is:
--
--    { "field": "pnl", "op": "lt", "value": 0, "value2": null }
--
--  and `conjunction` joins them. Deliberately flat — see the header of
--  filters.js for why there are no nested groups.
--
--  Safe to re-run.
-- ===================================================================

create table if not exists public.saved_filters (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,

  name         text not null,
  conjunction  text not null default 'and' check (conjunction in ('and','or')),
  rules        jsonb not null default '[]'::jsonb,

  -- The sort the view opens in, so "Biggest losers" can land already
  -- ordered by P&L rather than by entry date like everything else.
  sort_key     text,
  sort_dir     smallint not null default -1 check (sort_dir in (-1, 1)),

  -- Hand-ordered in the menu. Not created_at: the view somebody reaches
  -- for daily is rarely the one they wrote first.
  position     integer not null default 0,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists saved_filters_user_idx
  on public.saved_filters (user_id, position, created_at);

-- One name per user. Saving over an existing name should REPLACE that
-- view rather than leave two identical entries in the menu with no way
-- to tell them apart.
create unique index if not exists saved_filters_user_name_idx
  on public.saved_filters (user_id, lower(name));

alter table public.saved_filters enable row level security;

drop policy if exists own_rows on public.saved_filters;
create policy own_rows on public.saved_filters for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists saved_filters_touch on public.saved_filters;
create trigger saved_filters_touch before update on public.saved_filters
  for each row execute function public.touch_updated_at();
