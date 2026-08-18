-- ===================================================================
--  Migration 039 — asking for the sample book back
--
--  The sample book shows while `demo_dismissed_at` is null AND the
--  account has no trades of its own. Both conditions are right, and
--  together they make the thing irreversible: log one trade — even by
--  accident, even to see what happens — and the sample is gone for
--  good, because 028's rule writes the dismissal the first time a trade
--  exists so that deleting everything later cannot resurrect it.
--
--  That is the correct behaviour for somebody getting on with it, and
--  the wrong answer for somebody still deciding whether they trust the
--  app. "I logged one trade to try it and now I cannot see how the
--  charts work" is a fair thing to ask for help with, and today the only
--  remedy would be deleting their trade — destroying real data to
--  restore fiction, which is exactly backwards.
--
--  So a third state: pinned. The user has asked for the sample back and
--  it stays until they say otherwise, regardless of what they own.
--
--    demoOn = demo_pinned_at IS NOT NULL
--             OR (demo_dismissed_at IS NULL AND no trades)
--
--  NOTHING IS DELETED OR HIDDEN FROM THE DATABASE. The sample only ever
--  replaced the trade list in the view — `shown = demo ? demo.trades :
--  trades` — so a pinned sample hides the user's own rows on screen and
--  touches nothing. Unpinning brings them straight back. The banner has
--  to say so, or somebody will reasonably conclude their trades were
--  eaten by the thing they just switched on.
--
--  Purely additive, null for everybody, and null means exactly what it
--  meant before.
-- ===================================================================

alter table public.profiles
  add column if not exists demo_pinned_at timestamptz;

comment on column public.profiles.demo_pinned_at is
  'Set when the user asks for the sample book back after it has gone. '
  'Overrides both the dismissal and the has-trades test, so the sample shows '
  'over their real trades — which are hidden in the view only, never touched. '
  'NULL is the normal state and behaves exactly as before 039.';

-- ===================================================================
--  Check it landed. Expect pinned = 0 until somebody uses it.
-- ===================================================================
-- select count(*)                                       as profiles,
--        count(*) filter (where demo_pinned_at is not null) as pinned,
--        count(*) filter (where demo_dismissed_at is not null) as dismissed
--   from public.profiles;
