-- ===================================================================
--  022 — delete a testing account and everything it owns
--
--  THIS IS THE DESTRUCTIVE ONE. Work through the parts in order. Only
--  PART 4 removes anything, and it cannot be undone from inside the
--  database once PART 2's backup is dropped.
--
--  WHAT CASCADES, AND WHAT DOES NOT
--
--  Every user-scoped table declares `references auth.users on delete
--  cascade` — trades, trade_exits, diary_entries, capital_flows,
--  profiles, import_batches, user_events. Deleting the auth user takes
--  all seven with it. You do not need to empty them by hand, and doing
--  so first only makes the operation harder to verify.
--
--  Storage is the exception. Chart images live in the `charts` bucket
--  under a folder named after the user id, and storage.objects has no
--  foreign key to auth.users. Delete the user and those files stay,
--  paid for and unreachable. PART 3 deals with them, and it is the one
--  step that is not SQL.
--
--  SET THE PREFIX ONCE, HERE, and use the same value in every part.
--  Get it from 021_which_accounts.sql — match on the EMAIL, not on a
--  half-remembered prefix. Deleting the wrong account is the failure
--  this file exists to prevent.
-- ===================================================================


-- -------------------------------------------------------------------
--  PART 1 — confirm the account, and see exactly what would go.
--  READS ONLY. Run it and read every number before continuing.
--
--  CHECK THE EMAIL IS THE TESTING ONE. If `trades` is larger than you
--  expect for a test account, stop — that is the signal you have the
--  wrong prefix.
-- -------------------------------------------------------------------
with target as (select 'PASTE-PREFIX-HERE'::text as prefix),
u as (
  select id, email, created_at, last_sign_in_at
    from auth.users, target
   where left(id::text, 8) = target.prefix
)
select
  (select count(*) from u)                                              as accounts_matched,
  (select email from u)                                                 as email,
  (select last_sign_in_at::date from u)                                 as last_signed_in,
  (select count(*) from public.trades         where user_id = (select id from u)) as trades,
  (select count(*) from public.trade_exits    where user_id = (select id from u)) as exit_tranches,
  (select count(*) from public.diary_entries  where user_id = (select id from u)) as diary_entries,
  (select count(*) from public.capital_flows  where user_id = (select id from u)) as capital_flows,
  (select count(*) from public.import_batches where user_id = (select id from u)) as import_batches,
  (select count(*) from public.user_events    where user_id = (select id from u)) as events,
  (select count(*) from storage.objects
     where bucket_id = 'charts'
       and (storage.foldername(name))[1] = (select id::text from u))    as chart_images;

--  accounts_matched MUST be 1. Zero means the prefix is wrong. Two
--  means it is too short to be unique — use more characters.


-- -------------------------------------------------------------------
--  PART 2 — back it up first. Run this before PART 4.
--
--  Copies every row this account owns into a `backup` schema. It is not
--  a restore button — putting rows back means re-creating the auth user
--  and rewriting user_id — but it means the DATA still exists if you
--  find out next week that the "testing" account had something real in
--  it. Drop these tables when you are certain.
-- -------------------------------------------------------------------
-- create schema if not exists backup;
--
-- do $$
-- declare
--   v_prefix constant text := 'PASTE-PREFIX-HERE';
--   v_user uuid;
--   v_tag  text;
-- begin
--   select id into v_user from auth.users where left(id::text, 8) = v_prefix;
--   if v_user is null then
--     raise exception 'no account matches prefix %', v_prefix;
--   end if;
--   v_tag := 'del_' || v_prefix;
--
--   execute format('create table backup.%I as select * from public.trades         where user_id = %L', v_tag||'_trades',         v_user);
--   execute format('create table backup.%I as select * from public.trade_exits    where user_id = %L', v_tag||'_exits',          v_user);
--   execute format('create table backup.%I as select * from public.diary_entries  where user_id = %L', v_tag||'_diary',          v_user);
--   execute format('create table backup.%I as select * from public.capital_flows  where user_id = %L', v_tag||'_flows',          v_user);
--   execute format('create table backup.%I as select * from public.import_batches where user_id = %L', v_tag||'_batches',        v_user);
--   execute format('create table backup.%I as select * from public.user_events    where user_id = %L', v_tag||'_events',         v_user);
--   execute format('create table backup.%I as select * from public.profiles       where id      = %L', v_tag||'_profile',        v_user);
--
--   raise notice 'backed up account % into backup.% *', v_prefix, v_tag;
-- end $$;
--
-- -- what you just saved
-- select table_name,
--        (xpath('/row/c/text()',
--          query_to_xml(format('select count(*) c from backup.%I', table_name),
--                       false, true, '')))[1]::text::int as rows
--   from information_schema.tables
--  where table_schema = 'backup' and table_name like 'del\_%'
--  order by table_name;


-- -------------------------------------------------------------------
--  PART 3 — the chart images. NOT SQL, and do it before PART 4.
--
--  Deleting rows out of storage.objects by hand leaves the underlying
--  files behind in the bucket — the row is the index, not the file. Use
--  the interface that removes both:
--
--    Supabase → Storage → charts → the folder named after the user id
--    → select it → Delete.
--
--  PART 1 told you how many images to expect. If it said 0, skip this.
--
--  The full user id, to find the folder:
-- -------------------------------------------------------------------
-- select id::text as folder_name, email
--   from auth.users
--  where left(id::text, 8) = 'PASTE-PREFIX-HERE';


-- -------------------------------------------------------------------
--  PART 4 — THE DELETE. Nothing before this removed anything.
--
--  Do it from the dashboard rather than here:
--
--    Supabase → Authentication → Users → find the email → the row's
--    ⋮ menu → Delete user → confirm.
--
--  Why not SQL: the dashboard goes through the admin API, which also
--  clears refresh tokens, identities and sessions that a bare
--  `delete from auth.users` can leave behind on some projects. It also
--  makes you retype the email, which is a better last line of defence
--  than a prefix you pasted twenty minutes ago.
--
--  If you would rather do it in SQL anyway, this is the equivalent —
--  the cascade does the rest:
--
--    delete from auth.users
--     where left(id::text, 8) = 'PASTE-PREFIX-HERE'
--     returning id, email;
--
--  It should return exactly one row. If it returns none, nothing was
--  deleted and the prefix was wrong.
-- -------------------------------------------------------------------


-- -------------------------------------------------------------------
--  PART 5 — verify. READS ONLY. Every number must be 0.
-- -------------------------------------------------------------------
-- with target as (select 'PASTE-PREFIX-HERE'::text as prefix)
-- select
--   (select count(*) from auth.users, target where left(id::text,8) = target.prefix) as account_rows,
--   (select count(*) from public.trades t, target        where left(t.user_id::text,8) = target.prefix) as trades,
--   (select count(*) from public.trade_exits x, target   where left(x.user_id::text,8) = target.prefix) as exits,
--   (select count(*) from public.diary_entries d, target where left(d.user_id::text,8) = target.prefix) as diary,
--   (select count(*) from public.capital_flows f, target where left(f.user_id::text,8) = target.prefix) as flows,
--   (select count(*) from public.profiles p, target      where left(p.id::text,8)      = target.prefix) as profiles,
--   (select count(*) from storage.objects o, target
--      where o.bucket_id = 'charts'
--        and left((storage.foldername(o.name))[1], 8) = target.prefix)                as chart_images;
