-- ===================================================================
--  Migration 029 — account deletion, without the storage delete
--
--  WHAT WENT WRONG
--
--  027 removed the user's uploaded files with a plain DELETE against
--  storage.objects. Supabase guards that table with a trigger:
--
--    Direct deletion from storage tables is not allowed.
--    Use the Storage API instead.
--
--  A security definer function does not get past it — the guard is on
--  the table, not on the role. And because the raise aborts the whole
--  function, the delete from auth.users never ran either: the button
--  did not half-work, it did nothing at all, while telling the user
--  their account was being deleted permanently.
--
--  THE FIX, AND WHERE IT LIVES NOW
--
--  The files are removed by the client through the Storage API before
--  this is called — see deleteMyAccount() in src/lib/db.js. That path
--  is subject to the same row level security as every other read the
--  user makes, so it can only ever reach their own objects.
--
--  Storage still does not cascade from auth.users, so if that client
--  step fails the files outlive the account. That is now the lesser
--  evil: an orphaned image costs storage, whereas an account that
--  cannot be deleted breaks a promise made in the privacy policy.
--  Deletion goes ahead either way.
--
--  Replaces the function from 027. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  -- Everything the user owns follows this row out through its cascades:
  -- trades, exits, diary entries, capital flows, import batches, events,
  -- crash reports and the profile. Storage is handled before we get here.
  delete from auth.users where id = me;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
