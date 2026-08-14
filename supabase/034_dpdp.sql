-- ===================================================================
--  Migration 034 — two DPDP rights the app promises and cannot deliver
--
--  1. NOMINATION. The privacy policy already tells people they may
--     "nominate someone to exercise these rights if you die or become
--     incapacitated". That is a real right under section 14 of the
--     Digital Personal Data Protection Act, 2023, it is published on a
--     live site, and there has never been anywhere to record a nominee.
--
--     A right you have published and cannot honour is worse than one
--     you never mentioned: the first is a representation you are
--     failing, the second is a gap you have not reached yet.
--
--  2. DECLINING ANALYTICS. Product events and crash reports are not
--     needed to run a trading journal — the app works identically
--     without them. They are collected because they are useful to the
--     person building it, which is exactly the kind of processing
--     somebody should be able to decline without losing the service.
--
--     Today the only way to stop them is to delete the account. That is
--     not withdrawal, it is abandonment, and DPDP asks that withdrawing
--     be as easy as giving.
--
--  WHAT THIS DELIBERATELY DOES NOT COVER. There is no toggle for the
--  journal itself. Trades, diary entries and charge settings are the
--  thing the user asked us to store; switching them off is called
--  deleting your account, and that already exists and is verified.
--
--  ON THE NOMINEE'S OWN DATA. A nominee is a third party who has not
--  agreed to anything here, so this stores the least that can work: a
--  name and one way to reach them. No relationship, no address, no
--  identity document. Whoever is handling an estate will have those;
--  this only has to be enough to recognise the right person.
--
--  Purely additive. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.profiles
  add column if not exists nominee_name     text,
  add column if not exists nominee_contact  text,
  add column if not exists nominee_set_at   timestamptz,
  -- Opt OUT rather than opt in, and named so the default reads correctly:
  -- a column defaulting to false means analytics stay on for existing
  -- accounts, which is the behaviour they already have. Flipping the sense
  -- would silently switch collection off for everyone on deploy.
  add column if not exists analytics_opt_out boolean not null default false;

comment on column public.profiles.nominee_name is
  'Who may exercise this person''s DPDP rights if they die or are incapacitated. '
  'Section 14 of the Act; promised in the privacy policy since it shipped.';
comment on column public.profiles.nominee_contact is
  'One way to reach the nominee — an email or a phone number, their choice. '
  'Deliberately the least that can work: a nominee is a third party who has '
  'agreed to nothing here.';
comment on column public.profiles.nominee_set_at is
  'When the nomination was recorded, so it can be shown back and so a stale '
  'one is visible as stale.';
comment on column public.profiles.analytics_opt_out is
  'true = record no product events or crash reports for this account. The '
  'journal is unaffected; those are the only two things this switch governs.';

-- -------------------------------------------------------------------
--  Who has declined, and who has nominated
-- -------------------------------------------------------------------
--
--   select count(*) filter (where analytics_opt_out) as opted_out,
--          count(*) filter (where nominee_name is not null) as nominated,
--          count(*) as accounts
--     from public.profiles;
--
-- Worth checking after this ships: if a large share opt out, the events
-- being collected are ones people mind, and the answer is to collect
-- less rather than to ask more persuasively.
