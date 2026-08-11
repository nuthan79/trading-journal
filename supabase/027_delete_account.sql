-- ===================================================================
--  Migration 027 — let someone delete their own account
--
--  WHY THIS IS SQL AND NOT AN API ROUTE
--
--  Removing a row from auth.users is an admin operation, and the usual
--  way to do it is a server route holding SUPABASE_SERVICE_ROLE_KEY.
--  That key can read and write every row belonging to every user, and
--  it bypasses row level security entirely — so introducing it means
--  the app's strongest guarantee now depends on one environment
--  variable never leaking, for the sake of one button.
--
--  A security definer function is narrower by construction. It deletes
--  `auth.uid()` and nothing else: there is no parameter to tamper with,
--  no id to pass, and a caller cannot name a victim. Non-negotiable #10
--  says the service key stays unreachable from user code, and this is
--  how that stays true.
--
--  WHAT GOES, AND WHAT DOES NOT GO BY ITSELF
--
--  Every table references auth.users with on delete cascade, so trades,
--  exits, diary entries, capital flows, import batches, events, errors
--  and the profile all follow the user out.
--
--  STORAGE DOES NOT CASCADE. Uploaded charts and avatars are rows in
--  storage.objects with no foreign key to auth.users, so deleting the
--  user leaves the files behind — paid for, unreachable, and still
--  holding someone's chart images after they asked to be forgotten.
--  They are removed first, explicitly.
--
--  Irreversible. There is no undo and no soft delete: "erased" in a
--  privacy policy has to mean erased.
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

  -- Files first, while the owner still exists to identify them. Matched by
  -- owner AND by the per-user folder the app writes into, because objects
  -- uploaded through different paths have not always carried an owner.
  delete from storage.objects
   where bucket_id in ('charts', 'avatars')
     and (owner = me or name like me::text || '/%');

  -- Everything else follows this row out through its cascades.
  delete from auth.users where id = me;
end $$;

-- Only a signed-in user, and only ever themselves. Revoked from anon
-- explicitly rather than relying on the default grant, since a function
-- that deletes accounts is not one to leave to a default.
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
