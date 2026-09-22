-- ===================================================================
--  Migration 057 — a saved view belongs to one book
--
--  "MTF trades since April" offered in a US book is a view that can
--  only ever match nothing: the market has no margin funding and none
--  of those trades are in that book. The menu filled up with views
--  belonging somewhere else, which is the same leak the columns had.
--
--  ONE NAME PER USER BECOMES ONE NAME PER USER PER BOOK. The unique
--  index exists so that saving over a name REPLACES that view rather
--  than leaving two identical entries with no way to tell them apart.
--  That rule still holds inside a book — and across books it must not,
--  or "Winners" could be saved in India and never in the US.
--
--  'IN' for every existing row, which is what they are: every view in
--  this database was built on Indian trades.
--
--  Purely additive apart from the index, which is replaced by a wider
--  one. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.saved_filters
  add column if not exists region text not null default 'IN';

alter table public.saved_filters drop constraint if exists saved_filters_region_known;
alter table public.saved_filters
  add constraint saved_filters_region_known check (region in ('IN', 'US'));

comment on column public.saved_filters.region is
  'The book this view belongs to. A view is built from one market''s trades '
  'and is only offered there.';

-- The name rule, now per book.
drop index if exists public.saved_filters_user_name_idx;
create unique index if not exists saved_filters_user_region_name_idx
  on public.saved_filters (user_id, region, lower(name));

-- Verify:
--   select region, count(*) from public.saved_filters group by region;
