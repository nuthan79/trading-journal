-- 024_diary_edited.sql
--
-- Diary entries become editable, and an edited entry says so.
--
-- WHY A TRIGGER, not a column the app sets. The app is the only thing writing
-- to this table today, so a client-set updated_at would work — right up until
-- the one save path that forgets it. The marker's entire value is that it
-- cannot be skipped: an entry that was rewritten and shows no sign of it is
-- worse than no marker at all, because the absence reads as a guarantee.
-- public.touch_updated_at() already exists for trades; this is the same job.
--
-- NULL MEANS NEVER EDITED, and that is deliberately not how trades do it.
-- trades.updated_at is `not null default now()`, so "unedited" there is the
-- row where updated_at still equals created_at — fine for a column nobody
-- reads. This one is rendered, so it gets the state that needs no comparison
-- to interpret.

alter table public.diary_entries
  add column if not exists updated_at timestamptz;

drop trigger if exists diary_entries_touch on public.diary_entries;

-- The WHEN clause skips no-op writes. The app sends the whole entry back on
-- every save — including edits where nothing actually changed, and including
-- the upsert used to detach a wrongly-attached chart — and an entry should not
-- be branded as edited by a write that left it identical. (trades_touch has no
-- such guard because nothing displays its result.)
create trigger diary_entries_touch
  before update on public.diary_entries
  for each row
  when (old.* is distinct from new.*)
  execute function public.touch_updated_at();
