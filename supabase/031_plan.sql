-- ===================================================================
--  Migration 031 — what an account is entitled to
--
--  Added while billing is still deliberately unbuilt, because this is
--  the piece that is cheap now and expensive later.
--
--  THE MISTAKE THIS AVOIDS. The obvious way to gate a paid app is to
--  ask the payment provider: "does this user have an active Razorpay
--  subscription?" That works until the first person you want to give
--  the app to for nothing — an investor, a friend, someone who found a
--  bug — and then the only options are faking a payment record or
--  special-casing their email in code. Both rot as the list grows.
--
--  So entitlement is a fact on the profile. Razorpay's webhook becomes
--  one of several things allowed to WRITE it, rather than the thing
--  that answers it. A complimentary account is then an UPDATE, with no
--  payment object, nothing to reconcile, and nothing to cancel.
--
--  plan        free | paid | comp
--  plan_until  when it lapses. NULL means never — which is what a
--              complimentary account normally wants.
--  plan_note   why, in words. "investor", "found the import bug".
--              Future-you will not remember, and a comp with no reason
--              attached is one nobody dares revoke.
--
--  THE TRAP TO REMEMBER. Today `free` means full access, because the
--  whole app is free. If `free` later comes to mean "limited", every
--  existing user silently loses something on the day billing ships.
--  That is a decision to make deliberately then — grandfather them by
--  moving them to `comp` with a note, or tell them first. Do not let
--  it happen as a side effect of a default.
--
--  AND: non-negotiable #7 says an expired plan goes read-only with
--  export, never locked out. So this is closer to `can_write` than to
--  `has_paid`, and expiry should never mean losing sight of your own
--  trading history.
--
--  Purely additive. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.profiles
  add column if not exists plan       text not null default 'free',
  add column if not exists plan_until timestamptz,
  add column if not exists plan_note  text;

-- Spelling mistakes here would be silent and would decide what somebody
-- is allowed to do, so they are refused at the door.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_plan_check'
  ) then
    alter table public.profiles
      add constraint profiles_plan_check
      check (plan in ('free', 'paid', 'comp'));
  end if;
end $$;

comment on column public.profiles.plan is
  'free | paid | comp. The single source of truth for entitlement — never ask '
  'the payment provider directly, or complimentary accounts become impossible.';
comment on column public.profiles.plan_until is
  'When the plan lapses. NULL means never, which is what a comp usually wants.';
comment on column public.profiles.plan_note is
  'Why this plan was granted. A comp with no reason recorded is one nobody '
  'later dares revoke.';

-- -------------------------------------------------------------------
--  Giving someone the app for nothing
-- -------------------------------------------------------------------
--
-- One statement, by email, at any time — before billing exists or years
-- after. Always leave a note.
--
--   update public.profiles
--      set plan = 'comp', plan_until = null, plan_note = 'investor'
--    where id = (select id from auth.users
--                 where lower(email) = lower('friend@example.com'));
--
-- Time-limited instead — a three-month trial for a reviewer:
--
--   update public.profiles
--      set plan = 'comp', plan_until = now() + interval '3 months',
--          plan_note = 'reviewer, Aug 2026'
--    where id = (select id from auth.users
--                 where lower(email) = lower('friend@example.com'));
--
-- Who currently has one, and why:
--
--   select u.email, p.plan, p.plan_until, p.plan_note
--     from public.profiles p join auth.users u on u.id = p.id
--    where p.plan <> 'free'
--    order by p.plan, u.email;
