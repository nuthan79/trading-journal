-- ===================================================================
--  Migration 040 — how a trade felt, at both ends of it
--
--  WHY NOT THE DIARY, WHICH ALREADY HAS EMOTIONS.
--  `diary_entries.emotions` is a text[] tagged on a DAY, optionally
--  pointing at a trade. That answers "how was Tuesday". It cannot
--  answer "how did I feel taking this, and how did I feel closing
--  it" — which is the only question that pairs a feeling with an
--  outcome. A day holds several trades and one mood; a trade holds
--  two moments. Different shapes, so a different place.
--
--  The diary keeps its column and its multi-select. Nothing here
--  changes it.
--
--  WHY SINGLE VALUES AND NOT ARRAYS.
--  Every figure this feeds — ribbon widths on the entry→outcome→exit
--  flow, "10 of 22 trades entered calm" — only adds up when a trade
--  counts once. With arrays the percentages double-count and each one
--  needs a footnote explaining why the column does not sum. Mixed
--  feelings are real, and the honest place for them is the diary,
--  which is built for exactly that.
--
--  WHY TWO VOCABULARIES.
--  FOMO is not a thing you can feel when closing, and regret is not
--  available when opening. One shared list would leave half of each
--  column permanently empty and make the two ends look identical when
--  the whole point is the journey between them. The lists live in
--  src/lib/constants.js — this column deliberately does NOT constrain
--  them, see below.
--
--  NO CHECK CONSTRAINT ON THE VALUES, ON PURPOSE.
--  `pattern`, `exit_reason` and `mistakes` are all free text against
--  lists held in constants.js, and this follows them. A check
--  constraint would mean every future word needs a migration, and
--  worse, retiring a word would make existing rows violate the table.
--  023_retire_power_play.sql is the precedent for how a word gets
--  retired here: move the rows, then drop it from the list.
--
--  Purely additive, nullable, no default. NULL means "not recorded",
--  which is the truthful state for every trade that already exists and
--  for anything imported from a broker file — a CSV has never known
--  how anybody felt. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.trades
  add column if not exists entry_emotion text,
  add column if not exists exit_emotion  text;

comment on column public.trades.entry_emotion is
  'How the trader felt taking the position. One value from ENTRY_EMOTIONS in '
  'src/lib/constants.js. NULL means not recorded — never inferred, and never '
  'set by an importer, since a broker file cannot know it.';
comment on column public.trades.exit_emotion is
  'How the trader felt closing the position. One value from EXIT_EMOTIONS in '
  'src/lib/constants.js. NULL means not recorded.';

-- -------------------------------------------------------------------
--  Indexes
--
--  Partial, because the interesting rows are the recorded ones and on
--  a young journal most rows are NULL. Indexing the NULLs would be
--  most of the table for no gain.
-- -------------------------------------------------------------------
create index if not exists trades_entry_emotion_idx
  on public.trades (user_id, entry_emotion)
  where entry_emotion is not null;

create index if not exists trades_exit_emotion_idx
  on public.trades (user_id, exit_emotion)
  where exit_emotion is not null;

-- -------------------------------------------------------------------
--  Verify — expect two rows, both 'text', both nullable ('YES')
-- -------------------------------------------------------------------
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'trades'
  and column_name in ('entry_emotion', 'exit_emotion')
order by column_name;
