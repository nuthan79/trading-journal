-- ===================================================================
--  Migration 010 — profile pictures
--
--  A place to keep one image per account, and somewhere on the profile
--  row to point at it.
--
--  Private, like the charts bucket, and for the same reason: the path
--  is the only thing standing between a stranger and the file, and a
--  photograph of a person is not something to leave on a guessable URL
--  because it happened to be convenient. Reads go through a signed URL
--  that expires.
--
--  Per-user folders, enforced by policy rather than by the client
--  choosing well-behaved paths: the first segment of the object name
--  must be the caller's own uid, so one account cannot write into or
--  read another's folder even if it asks.
--
--  Purely additive. Safe to re-run.
--
--  Run in Supabase → SQL Editor → New query → Run.
-- ===================================================================

-- -------------------------------------------------------------------
--  1. Where the image lives, on the profile.
--
--  A path inside the bucket, not a URL — signed URLs expire, so storing
--  one would leave a dead link behind within the hour.
-- -------------------------------------------------------------------
alter table public.profiles
  add column if not exists avatar_path text;

-- -------------------------------------------------------------------
--  2. The bucket.
-- -------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

drop policy if exists own_avatar on storage.objects;
create policy own_avatar on storage.objects for all
  using      (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- -------------------------------------------------------------------
--  3. Verify.
--
--  has_column and has_bucket must both be 1; policies must be 1.
-- -------------------------------------------------------------------
select (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'profiles'
           and column_name = 'avatar_path')                     as has_column,
       (select count(*) from storage.buckets where id = 'avatars') as has_bucket,
       (select count(*) from pg_policies
         where schemaname = 'storage' and tablename = 'objects'
           and policyname = 'own_avatar')                       as policies;
