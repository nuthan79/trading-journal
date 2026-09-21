-- ===================================================================
--  Migration 055 — the diary belongs to a book too
--
--  FOUND IN USE, on the first morning of a US book: "Write one diary
--  entry" was already ticked, because the count was every entry the
--  user had ever written — all of them about Indian trades. A new
--  book that congratulates you for work done in another one is
--  telling you something false on the first screen you see.
--
--  trades and capital_flows carry a region (052) and diary_entries
--  did not, which made it the last table that could leak one book
--  into another. An entry is either about a trade — and a trade is in
--  exactly one market — or about a day of trading in one.
--
--  'IN' FOR EVERY EXISTING ROW, which is the truth: every entry ever
--  written here was written beside Indian trades.
--
--  Purely additive. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.diary_entries
  add column if not exists region text not null default 'IN';

alter table public.diary_entries drop constraint if exists diary_entries_region_known;
alter table public.diary_entries
  add constraint diary_entries_region_known check (region in ('IN', 'US'));

comment on column public.diary_entries.region is
  'The book this entry belongs to. Every row written before this said IN, '
  'which is what they were.';

create index if not exists diary_entries_user_region_idx
  on public.diary_entries (user_id, region);

-- Verify:
--   select region, count(*) from public.diary_entries group by region;
