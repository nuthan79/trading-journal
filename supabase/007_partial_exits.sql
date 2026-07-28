-- ===================================================================
--  Migration 007 — partial exits
--
--  Supersedes the never-applied 002. That one assumed it ran before
--  the import migration and would abort here: it did
--  `alter column initial_stop_loss set not null`, and since 006 made
--  stop_loss nullable, every imported trade would carry a null and
--  SET NOT NULL refuses. initial_stop_loss stays nullable below and
--  R simply remains uncomputable until a stop is filled in — the same
--  bargain 006 already made.
--
--  Purely additive otherwise. No column dropped, no value overwritten.
--  Safe to re-run. Existing trades keep working exactly as they do;
--  they each gain one exit row representing the full exit.
--
--  Run in Supabase → SQL Editor → New query → Run.
-- ===================================================================

-- -------------------------------------------------------------------
--  1. The immutable stop.
--
--  1R has to be fixed at entry, or the denominator of every R figure
--  moves the moment you trail a stop. initial_stop_loss defines 1R for
--  the life of the trade; stop_loss becomes the *current* stop, used
--  for live distance-to-stop on what's still open.
-- -------------------------------------------------------------------
alter table public.trades
  add column if not exists initial_stop_loss numeric;

-- Only fills where it's still unset, which is what makes this re-runnable.
-- Nulls stay null: an imported trade has no known stop and inventing one
-- would put every loser near -1R by construction.
update public.trades
   set initial_stop_loss = stop_loss
 where initial_stop_loss is null
   and stop_loss is not null;

-- -------------------------------------------------------------------
--  2. Exit tranches. One row per sell.
-- -------------------------------------------------------------------
create table if not exists public.trade_exits (
  id         uuid primary key default gen_random_uuid(),
  trade_id   uuid not null references public.trades on delete cascade,
  user_id    uuid not null references auth.users     on delete cascade,

  exit_date  date    not null,
  quantity   numeric not null check (quantity > 0),
  price      numeric not null check (price    > 0),
  reason     text,
  charges    numeric not null default 0,
  note       text,

  created_at timestamptz not null default now()
);

create index if not exists trade_exits_trade_idx on public.trade_exits (trade_id, exit_date);
create index if not exists trade_exits_user_idx  on public.trade_exits (user_id, exit_date desc);

alter table public.trade_exits enable row level security;

drop policy if exists own_rows on public.trade_exits;
create policy own_rows on public.trade_exits for all
  to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- -------------------------------------------------------------------
--  3. Backfill: every already-closed trade becomes a single full exit.
--
--  charges stay 0 on these rows because the figure still sits on
--  trades.charges and the app sums both — recording it in one place
--  only is what keeps the total honest. Skipping trades that already
--  have exits is what makes this re-runnable.
-- -------------------------------------------------------------------
insert into public.trade_exits (trade_id, user_id, exit_date, quantity, price, reason, charges)
select t.id, t.user_id, t.exit_date, t.quantity, t.exit_price, t.exit_reason, 0
  from public.trades t
 where t.status = 'closed'
   and t.exit_price is not null
   and t.exit_date  is not null
   and not exists (select 1 from public.trade_exits e where e.trade_id = t.id);

-- -------------------------------------------------------------------
--  4. Allow the 'partial' status.
-- -------------------------------------------------------------------
alter table public.trades drop constraint if exists trades_status_check;
alter table public.trades
  add constraint trades_status_check
  check (status in ('open', 'partial', 'closed'));

-- The old guard demanded exit_price on anything closed. Exits live in
-- their own table now, so that check has to go or a partial close fails.
alter table public.trades drop constraint if exists closed_needs_exit;

-- -------------------------------------------------------------------
--  5. Keep status in step with the tranches automatically, so the app
--     can never disagree with the data about what's still open.
-- -------------------------------------------------------------------
create or replace function public.sync_trade_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  tid       uuid := coalesce(new.trade_id, old.trade_id);
  sold      numeric;
  original  numeric;
  last_exit date;
begin
  select coalesce(sum(quantity), 0) into sold
    from public.trade_exits where trade_id = tid;

  select quantity into original from public.trades where id = tid;

  -- The trade may already be gone when this fires from a cascading
  -- delete, in which case there is nothing left to keep in step.
  if original is null then
    return null;
  end if;

  select exit_date into last_exit
    from public.trade_exits
   where trade_id = tid
   order by exit_date desc, created_at desc
   limit 1;

  update public.trades
     set status = case
                    when sold <= 0                  then 'open'
                    when sold < original - 0.000001 then 'partial'
                    else 'closed'
                  end,
         -- mirrored onto the trade for convenience; the tranches are the truth
         exit_date  = case when sold > 0 then last_exit else null end,
         exit_price = case
                        when sold >= original - 0.000001 then (
                          select sum(price * quantity) / sum(quantity)
                            from public.trade_exits where trade_id = tid
                        )
                        else null
                      end
   where id = tid;

  return null;
end $$;

drop trigger if exists exits_sync_status on public.trade_exits;
create trigger exits_sync_status
  after insert or update or delete on public.trade_exits
  for each row execute function public.sync_trade_status();

-- -------------------------------------------------------------------
--  Verify
-- -------------------------------------------------------------------
select count(*)                                    as trades,
       count(*) filter (where status = 'partial')  as partial,
       (select count(*) from public.trade_exits)   as exit_rows,
       (select count(*) from public.trades
         where stop_loss is null)                  as awaiting_stop
  from public.trades;
