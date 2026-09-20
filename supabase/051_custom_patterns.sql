-- ===================================================================
--  Migration 051 — a trader's own setups, up to three
--
--  `trades.pattern` has always been free text; the eleven names in the
--  dropdown are a UI list, not a constraint. What was missing was
--  somewhere to keep a name so it appears in the dropdown next time —
--  otherwise "Support Entry" has to be spelled identically by hand on
--  every trade, and one typo splits the breakdown in two.
--
--  WHY THREE. The breakdown on Analysis calls a slice under fifteen
--  trades thin. Eleven patterns across a real book is already close to
--  that; fourteen is fine, and unlimited would quietly cut the page
--  into one-trade categories that cannot say anything. The cap is the
--  feature, not a limitation of the storage.
--
--  WHY jsonb AND NOT A TABLE. These are three short strings belonging
--  to one profile, never queried across users, never joined. A table
--  would bring an id, a foreign key and RLS policies to hold what fits
--  in one column, and every read of the list already loads the profile.
--
--  A trade keeps whatever string it carries whether or not the name is
--  still in this list — deleting a name from here never touches
--  history, and the app refuses to delete one that is still in use.
--
--  Purely additive. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.profiles
  add column if not exists custom_patterns jsonb not null default '[]'::jsonb;

comment on column public.profiles.custom_patterns is
  'Up to 3 setup names this trader added, as a JSON array of strings. '
  'They join the built-in PATTERNS list in the trade form and the filters. '
  'trades.pattern stores the chosen name as text, so history survives a name '
  'being removed from this list.';

-- Three, and strings. The app enforces the same rule with a message; this is
-- here so a stray write cannot leave a list no screen can render.
alter table public.profiles
  drop constraint if exists profiles_custom_patterns_shape;

alter table public.profiles
  add constraint profiles_custom_patterns_shape check (
    jsonb_typeof(custom_patterns) = 'array'
    and jsonb_array_length(custom_patterns) <= 3
  );

-- Verify:
--   select id, custom_patterns from public.profiles where id = auth.uid();
