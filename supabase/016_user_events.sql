-- ===================================================================
--  Migration 016 — product events
--
--  WHAT THIS IS FOR
--
--  The app goes out free on a domain to answer three questions: how
--  many show interest, how many use it regularly, and how many are
--  still here after thirty days. None of them can be answered today —
--  there is no instrumentation anywhere in the app, so a launch would
--  report a Supabase user count and nothing else.
--
--  This is the smallest table that answers questions two and three.
--  Question one — visitors who never signed up — has no user_id and
--  belongs to a page analytics script instead.
--
--  WHAT IT DELIBERATELY DOES NOT HOLD
--
--  No IP address, no user agent, no referrer, no page path. Events are
--  a verb and a few numbers: imported 412 rows, logged a trade, opened
--  the review. That is enough to see whether someone is using the
--  journal, and nothing in here would embarrass anyone if it leaked.
--  `props` is for counts and enums only — never a symbol, a price or
--  anything about the positions themselves.
--
--  Append-only by design: policies allow insert and select of one's
--  own rows, and nothing else. There is no update or delete policy, so
--  a user cannot rewrite their own history and neither can the app.
--
--  Purely additive. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

create table if not exists public.user_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  event      text not null,
  props      jsonb not null default '{}',
  created_at timestamptz not null default now()
);

comment on table public.user_events is
  'Product events for the free-launch survey: activity only, never '
  'position data. Deleting an account deletes its events, which loses '
  'some retention history — the honest trade, and the one the DPDP Act '
  'expects.';

-- Retention is read per user over time, activity per event over time.
create index if not exists user_events_user_idx
  on public.user_events (user_id, created_at desc);
create index if not exists user_events_event_idx
  on public.user_events (event, created_at desc);
-- Weekly-active counts scan by date across everyone.
create index if not exists user_events_at_idx
  on public.user_events (created_at desc);

alter table public.user_events enable row level security;

-- Insert and read your own. No update, no delete: the absence of those
-- policies is what makes the table append-only for everyone except the
-- SQL editor, which runs as postgres and bypasses RLS.
drop policy if exists own_events_insert on public.user_events;
create policy own_events_insert on public.user_events for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists own_events_select on public.user_events;
create policy own_events_select on public.user_events for select
  to authenticated
  using (auth.uid() = user_id);

-- -------------------------------------------------------------------
--  Check
-- -------------------------------------------------------------------
select
  (select count(*) from public.user_events)              as events_so_far,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'user_events') as policies;
