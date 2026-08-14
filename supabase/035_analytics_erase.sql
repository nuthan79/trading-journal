-- ===================================================================
--  Migration 035 — let people delete the records kept about them
--
--  034 shipped a switch that turns product events and crash reports off
--  and deletes what was already collected. The switch worked. The
--  deletion did not: `user_events` and `client_errors` have INSERT and
--  SELECT policies and no DELETE policy, so the delete matched zero rows
--  and returned success. 388 events survived a request to erase them,
--  and the screen said "there was nothing collected to delete".
--
--  THIS IS THE THIRD TIME THIS EXACT SHAPE HAS APPEARED on this project.
--  An RLS-blocked DELETE is not an error. Postgres does not refuse it —
--  the rows are simply invisible to the statement, so it deletes nothing
--  and reports that it succeeded. It is what made account deletion do
--  nothing twice (027, 029) before /api/account was written to re-check
--  afterwards.
--
--  The rule worth carrying: after a delete that matters, count. Never
--  trust the absence of an error to mean rows went away.
--
--  WHY THESE TABLES WERE APPEND-ONLY, and why that changes. 016 and 025
--  deliberately gave no DELETE policy so that analytics could not be
--  quietly rewritten to flatter the numbers. That reasoning holds for
--  editing and for deleting somebody else's rows — it does not hold for
--  a person erasing records kept about them, which is a right rather
--  than tampering. The policy is scoped to auth.uid() so it is only ever
--  your own.
--
--  Nothing about the journal is affected. These two tables hold what the
--  app recorded ABOUT a user, never anything they entered.
--
--  Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

drop policy if exists own_events_delete on public.user_events;
create policy own_events_delete on public.user_events
  for delete using (auth.uid() = user_id);

drop policy if exists own_errors_delete on public.client_errors;
create policy own_errors_delete on public.client_errors
  for delete using (auth.uid() = user_id);

-- -------------------------------------------------------------------
--  Check it took
-- -------------------------------------------------------------------
--
--   select tablename, policyname, cmd from pg_policies
--    where schemaname='public'
--      and tablename in ('user_events','client_errors')
--    order by tablename, cmd;
--
-- Four rows before this ran, six after — a DELETE beside each table's
-- INSERT and SELECT.
