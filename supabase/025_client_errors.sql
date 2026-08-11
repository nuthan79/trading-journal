-- ===================================================================
--  Migration 025 — client errors
--
--  WHAT THIS IS FOR
--
--  Today a user who hits a crash is invisible. They see a broken page,
--  they close the tab, and nothing anywhere records that it happened —
--  so the first launch would produce a retention number with no way to
--  tell whether people left because the app was not for them or because
--  it broke in front of them. Those are opposite conclusions.
--
--  WHY NOT SENTRY. It would be better at this: real stack traces
--  against source maps, grouping, alerting. It is also a new dependency
--  on an app that still has to move off next@14, and a new processor to
--  name in the privacy policy. At this size a table you can query
--  answers the only question that matters — is anyone hitting this, and
--  where — and src/lib/errors.js is one seam to swap when volume earns
--  the upgrade.
--
--  SIGNED-IN ONLY, deliberately. An insert policy loose enough to catch
--  errors from signed-out visitors is an open write endpoint on a public
--  URL, and the landing page is static enough not to be worth it.
--
--  WHAT IT HOLDS. A message, where it happened, and a stack. No inputs,
--  no form values, no journal content — a crash in the trade form must
--  not post somebody's position size into a table with different rules
--  from the one it came out of.
--
--  Purely additive. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

create table if not exists public.client_errors (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  message    text not null,
  source     text,                       -- which boundary or listener caught it
  path       text,                       -- pathname only, never the query string
  stack      text,
  created_at timestamptz not null default now()
);

create index if not exists client_errors_created_idx
  on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;

-- Insert and select your own, and nothing else. No update and no delete
-- policy, so a report cannot be quietly rewritten after the fact — the
-- same append-only shape as user_events in 016.
drop policy if exists own_errors on public.client_errors;
create policy own_errors on public.client_errors
  for select using (auth.uid() = user_id);

drop policy if exists insert_own_errors on public.client_errors;
create policy insert_own_errors on public.client_errors
  for insert with check (auth.uid() = user_id);

-- Read them all from the SQL editor, which runs as the service role and
-- is not subject to the policies above:
--
--   select created_at, path, message, count(*) over (partition by message)
--   from public.client_errors
--   order by created_at desc
--   limit 100;
