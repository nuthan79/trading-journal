-- ===================================================================
--  021 — which accounts exist, how each one signs in, and what it owns
--
--  READS ONLY. One query. Nothing here is a password and nothing here
--  can be turned into one.
--
--  WHY THERE IS NO "SHOW ME MY PASSWORD" QUERY
--
--  auth.users.encrypted_password holds a bcrypt hash. Hashing is
--  one-way on purpose: Supabase cannot read your password either, and
--  a system that could would be one bad backup away from handing every
--  account to whoever found it. A forgotten password is RESET, never
--  recovered. The column is not selected below even though it is only
--  a hash — there is no reason to put it on screen.
--
--  WHAT THIS ANSWERS INSTEAD
--
--  Four accounts have been referred to all session by the first eight
--  characters of their id — 3af0f255, fa6d145f, 4742b877. This maps
--  each prefix to the email that signs into it, whether that login uses
--  a password or Google, when it was last used, and how many trades it
--  holds. That is the thing actually worth writing down.
--
--  READ `signs_in_with`:
--    password        — email + password. Reset it from the app's
--                      "Forgot your password?" link, or from
--                      Supabase → Authentication → Users → the row's
--                      menu → Send recovery email.
--    google          — no password exists to find. Sign in with Google.
--    google,password — either works.
--
--  An account showing `google` only and no password is not broken and
--  does not need one. Adding a password to it is optional, done through
--  the same recovery flow.
--
--  Supabase → SQL Editor → New query → paste all of this → Run.
-- ===================================================================

with providers as (
  select
    i.user_id,
    string_agg(distinct i.provider, ',' order by i.provider) as provider_list
  from auth.identities i
  group by i.user_id
),
trade_counts as (
  select user_id,
         count(*)                                   as trades,
         min(entry_date)                            as first_trade,
         max(entry_date)                            as last_trade
  from public.trades
  group by user_id
)
select
  left(u.id::text, 8)                               as prefix,
  u.email,
  -- how this login actually gets in
  coalesce(
    nullif(
      concat_ws(',',
        nullif(p.provider_list, 'email'),
        case when u.encrypted_password is not null and u.encrypted_password <> ''
             then 'password' end
      ), ''),
    'no method recorded')                           as signs_in_with,
  u.last_sign_in_at::date                           as last_signed_in,
  u.created_at::date                                as created,
  u.email_confirmed_at is not null                  as email_confirmed,
  coalesce(t.trades, 0)                             as trades,
  t.first_trade,
  t.last_trade,
  pr.journal_name
from auth.users u
left join providers    p  on p.user_id  = u.id
left join trade_counts t  on t.user_id  = u.id
left join public.profiles pr on pr.id   = u.id
order by coalesce(t.trades, 0) desc, u.created_at;
