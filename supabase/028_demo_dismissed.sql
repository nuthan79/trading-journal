-- ===================================================================
--  Migration 028 — remember that the sample data is finished with
--
--  A brand-new journal shows nothing: every screen asks for twenty
--  closed trades before it can say anything, which is most of the app
--  invisible on the day somebody signs up. So a generated sample book
--  is shown until they have a trade of their own.
--
--  WHY A COLUMN AND NOT localStorage. Dismissing it on a laptop and
--  finding it back on the phone reads as a bug. This is a fact about
--  the account, not about the browser.
--
--  WHY A TIMESTAMP AND NOT A BOOLEAN. It answers "when did this person
--  stop needing help", which is worth knowing later against the
--  retention figures in 026 — and null already means "still showing",
--  so the boolean is free.
--
--  THE SAMPLE ITSELF IS NEVER IN THE DATABASE. It is generated in the
--  browser and held in memory. Rows in `trades` carrying an is_sample
--  flag would need excluding from expectancy, the R distribution,
--  drawdown, capital deployment, the review page, every export and
--  every product event — and one missed filter would have the app
--  quietly reporting a blend of real and invented trades. This column
--  is the only trace the sample leaves anywhere.
--
--  Purely additive. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.profiles
  add column if not exists demo_dismissed_at timestamptz;

comment on column public.profiles.demo_dismissed_at is
  'When the generated sample book was dismissed, or first real trade logged. '
  'Null means it is still being shown. The sample is never stored as rows.';
