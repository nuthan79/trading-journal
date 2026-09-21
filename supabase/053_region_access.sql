-- ===================================================================
--  Migration 053 — who may write in which market
--
--  WHY THIS IS NOT A COLUMN ON profiles. The policy on that table is
--  `own_profile ... for all using (auth.uid() = id) with check (...)`,
--  so a user may update ANY column of their own profile row from the
--  browser with their own token. An entitlement kept there is an
--  entitlement anybody can grant themselves in one API call. This
--  table has a select policy and NO write policy at all, which means
--  only the service role can write it — the SQL editor, or Pulse on
--  the admin's own machine.
--
--  INDIA IS FREE AND STAYS FREE. `has_region` answers true for 'IN'
--  without consulting this table, so nothing changes for anybody who
--  has ever used this app. A row here is only needed for a market
--  that is sold.
--
--  WRITES ARE BLOCKED, READS ARE KEPT. Somebody who paid for a year,
--  logged two hundred US trades and did not renew can still open that
--  book and read it; they cannot add to it. Locking a person out of
--  their own records is what turns a lapsed customer into an angry
--  one, and under the DPDP Act it is their data either way.
--
--  AS RESTRICTIVE, NOT AS A SECOND PERMISSIVE POLICY. Permissive
--  policies are OR-ed together, so adding one would have GRANTED
--  everything it described rather than limiting anything. A
--  restrictive policy is AND-ed with the existing `own_rows`, and
--  `using (true)` leaves reads exactly as they are.
--
--  expires_at NULL means forever — the admin's own accounts, and any
--  lifetime grant. A paid subscription later just writes a row with a
--  date in it; nothing else here has to change.
--
--  Purely additive. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

create table if not exists public.region_access (
  user_id    uuid not null references auth.users on delete cascade,
  region     text not null check (region in ('IN', 'US')),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,                      -- null = no expiry
  note       text,                             -- 'tester', 'paid 2026-27', an order id later
  primary key (user_id, region)
);

comment on table public.region_access is
  'Which markets a user may WRITE trades in. India needs no row — it is free. '
  'Read by the user, written only by the service role: there is no write policy.';

alter table public.region_access enable row level security;

drop policy if exists own_access on public.region_access;
create policy own_access on public.region_access
  for select using (auth.uid() = user_id);
-- Deliberately no insert/update/delete policy. Grants come from the admin.

/**
 * The single source of truth, used by the policy below and by Pulse.
 *
 * SECURITY DEFINER so the policy can consult the table without every caller
 * needing a select policy on someone else's row; STABLE so Postgres may cache
 * it within a statement.
 */
create or replace function public.has_region(uid uuid, r text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select r = 'IN'                              -- free for everyone, always
      or exists (
           select 1 from public.region_access a
            where a.user_id = uid
              and a.region = r
              and (a.expires_at is null or a.expires_at > now())
         );
$$;

revoke all on function public.has_region(uuid, text) from public;
grant execute on function public.has_region(uuid, text) to authenticated, service_role;

-- Writes only into a market you may write in. Reads are untouched.
drop policy if exists trades_region_entitled on public.trades;
create policy trades_region_entitled on public.trades
  as restrictive for all
  using (true)
  with check (public.has_region(auth.uid(), region));

-- The capital ledger belongs to a book too, and nothing writes it from the UI
-- yet — this is here so it cannot be the gap when something does.
drop policy if exists flows_region_entitled on public.capital_flows;
create policy flows_region_entitled on public.capital_flows
  as restrictive for all
  using (true)
  with check (public.has_region(auth.uid(), region));

-- ---- granting, for now -------------------------------------------------
-- A tester, for a year:
--   insert into public.region_access (user_id, region, expires_at, note)
--   select id, 'US', now() + interval '1 year', 'tester'
--     from auth.users where email = 'someone@example.com'
--   on conflict (user_id, region)
--   do update set expires_at = excluded.expires_at, note = excluded.note;
--
-- Forever (your own accounts): leave expires_at null.
-- Revoke:  delete from public.region_access where region = 'US' and user_id = ...;
--
-- ---- rollback, if a policy ever blocks something it should not ----------
--   drop policy if exists trades_region_entitled on public.trades;
--   drop policy if exists flows_region_entitled on public.capital_flows;
--
-- Verify (as yourself, in the app's own session):
--   select public.has_region(auth.uid(), 'IN'), public.has_region(auth.uid(), 'US');
