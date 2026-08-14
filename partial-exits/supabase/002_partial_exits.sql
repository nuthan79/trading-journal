-- ===================================================================
--  Migration 002 — partial exits
--
--  Purely additive. No column is dropped, no existing value is
--  overwritten. Safe to re-run. Your current trades keep working
--  exactly as they do now; they simply gain one exit row each.
--
--  Run in Supabase → SQL Editor → New snippet → Run.
--  Take a JSON backup from the app's settings sheet first anyway.
-- ===================================================================

-- -------------------------------------------------------------------
--  1. The immutable stop.
--
--  1R has to be fixed at entry, or the denominator of every R figure
--  moves whenever you trail a stop. So: initial_stop_loss defines 1R
--  forever, stop_loss becomes the *current* stop used for live
--  distance-to-stop on open positions.
-- -------------------------------------------------------------------
alter table public.trades
  add column if not exists initial_stop_loss numeric;

update public.trades
   set initial_stop_loss = stop_loss
 where initial_stop_loss is null;

alter table public.trades
  alter column initial_stop_loss set not null;

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
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- -------------------------------------------------------------------
--  3. Backfill: every already-closed trade becomes a single full exit.
--
--  charges are left at 0 on these rows because the value still sits on
--  trades.charges — the app sums both, so putting it in either place
--  once keeps the total honest. Only rows without exits are touched,
--  which is what makes this re-runnable.
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

-- The old guard demanded exit_price on anything closed. Exits now live
-- in their own table, so that check has to go or partial closes fail.
alter table public.trades drop constraint if exists closed_needs_exit;

-- -------------------------------------------------------------------
--  5. Keep status in step with the tranches automatically, so the app
--     can never disagree with the data about whether a trade is open.
-- -------------------------------------------------------------------
create or replace function public.sync_trade_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  tid       uuid := coalesce(new.trade_id, old.trade_id);
  sold      numeric;
  original  numeric;
  last_exit date;
  last_px   numeric;
begin
  select coalesce(sum(quantity), 0) into sold
    from public.trade_exits where trade_id = tid;

  select quantity into original from public.trades where id = tid;

  select exit_date, price into last_exit, last_px
    from public.trade_exits
   where trade_id = tid
   order by exit_date desc, created_at desc
   limit 1;

  update public.trades
     set status = case
                    when sold <= 0                     then 'open'
                    when sold < original - 0.000001    then 'partial'
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
--  6. Convenience view: one row per trade with its exits rolled up.
-- -------------------------------------------------------------------
create or replace view public.trades_rollup as
select
  t.*,
  coalesce(x.exits_count, 0)                       as exits_count,
  coalesce(x.qty_exited, 0)                        as qty_exited,
  t.quantity - coalesce(x.qty_exited, 0)           as qty_open,
  x.avg_exit_price,
  x.exit_charges,
  x.first_exit_date,
  x.last_exit_date
from public.trades t
left join (
  select trade_id,
         count(*)                                  as exits_count,
         sum(quantity)                             as qty_exited,
         sum(price * quantity) / sum(quantity)     as avg_exit_price,
         sum(charges)                              as exit_charges,
         min(exit_date)                            as first_exit_date,
         max(exit_date)                            as last_exit_date
    from public.trade_exits
   group by trade_id
) x on x.trade_id = t.id;
