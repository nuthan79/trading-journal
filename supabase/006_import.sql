-- ===================================================================
--  Migration 006 — trade import
--
--  Additive except for one deliberate relaxation: stop_loss becomes
--  nullable. Imported trades genuinely have no stop, and storing a
--  guess would corrupt every statistic built on R.
--
--  Re-runnable. Independent of migrations 002-005.
-- ===================================================================

-- -------------------------------------------------------------------
--  1. Stop loss may be unknown.
--
--  A tax report cannot know what you risked. Rather than invent a
--  number, the column accepts null and R simply stays uncomputable
--  until you fill it in. Everything downstream already guards on
--  isFinite(), so those trades sit out of the R analysis rather than
--  poisoning it.
--
--  The existing CHECK (stop_loss > 0) is left alone — in Postgres a
--  check passes unless it evaluates false, and NULL > 0 is NULL.
-- -------------------------------------------------------------------
alter table public.trades alter column stop_loss drop not null;

-- If migration 002 has already run, its initial_stop_loss carries the
-- same constraint and needs the same relaxation.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'trades'
       and column_name = 'initial_stop_loss'
  ) then
    execute 'alter table public.trades alter column initial_stop_loss drop not null';
  end if;
end $$;

-- -------------------------------------------------------------------
--  2. Provenance
-- -------------------------------------------------------------------
alter table public.trades add column if not exists imported     boolean not null default false;
alter table public.trades add column if not exists import_batch uuid;

create index if not exists trades_import_batch_idx
  on public.trades (user_id, import_batch) where import_batch is not null;

-- Finding which trades still need a stop is the single most common
-- query after an import, so it gets its own index.
create index if not exists trades_needs_stop_idx
  on public.trades (user_id) where stop_loss is null;

-- -------------------------------------------------------------------
--  3. Batches, so an import can be reviewed or undone as a unit
--
--  Getting a 300-trade import wrong and having to unpick it by hand is
--  what stops people trying a second time.
-- -------------------------------------------------------------------
create table if not exists public.import_batches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  filename      text,
  source        text not null default 'zerodha-taxpnl',
  trades_count  integer not null default 0,
  lots_count    integer,             -- rows in the file before grouping
  date_from     date,
  date_to       date,
  created_at    timestamptz not null default now()
);

alter table public.import_batches enable row level security;
drop policy if exists own_batches on public.import_batches;
create policy own_batches on public.import_batches for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- -------------------------------------------------------------------
--  4. Undo
-- -------------------------------------------------------------------
create or replace function public.undo_import(p_batch uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare removed integer;
begin
  delete from public.trades
   where user_id = auth.uid() and import_batch = p_batch;
  get diagnostics removed = row_count;

  delete from public.import_batches
   where user_id = auth.uid() and id = p_batch;

  return removed;
end $$;

grant execute on function public.undo_import(uuid) to authenticated;

-- -------------------------------------------------------------------
--  5. Keys already held, so re-importing an overlapping file is safe
--
--  Each report covers one financial year, so a position entered in
--  March and exited in April appears in two of them. This is what the
--  importer checks against before writing anything.
-- -------------------------------------------------------------------
create or replace function public.my_trade_keys()
returns table (dedupe_key text)
language sql security definer set search_path = public as $$
  select symbol || '|' || entry_date::text || '|' ||
         coalesce(exit_date::text, '') || '|' || quantity::text
    from public.trades
   where user_id = auth.uid();
$$;

grant execute on function public.my_trade_keys() to authenticated;

-- -------------------------------------------------------------------
--  Verify
-- -------------------------------------------------------------------
select is_nullable as stop_loss_nullable
  from information_schema.columns
 where table_schema='public' and table_name='trades' and column_name='stop_loss';

select count(*) filter (where imported)          as imported,
       count(*) filter (where stop_loss is null) as awaiting_stop,
       count(*)                                   as total
  from public.trades;
