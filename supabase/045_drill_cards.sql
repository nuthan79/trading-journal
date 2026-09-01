-- ===================================================================
--  045 — What the chart drill remembers about each card
--
--  One row per (user, trade), not one per answer. The drill needs to
--  know three things to order a deck — how often this card has been
--  called wrong, when it was last seen, and how many times — and none
--  of those need the individual answers kept. A log would grow without
--  limit for a feature that only ever reads the aggregate.
--
--  `wrong` is what drives spaced repetition: a card called wrong comes
--  back sooner, which is the whole mechanic of a flashcard.
--
--  Deliberately NOT storing the session score. The confusion matrix is
--  computed from the trades themselves, which already carry the
--  outcome — storing it too would create a second copy that could
--  disagree with the book after a trade is edited.
--
--  Safe to re-run.
-- ===================================================================

create table if not exists public.drill_cards (
  user_id    uuid not null references auth.users on delete cascade,
  -- Cascades: a deleted trade takes its drill history with it rather
  -- than leaving a row that can never be dealt again.
  trade_id   uuid not null references public.trades on delete cascade,

  seen       integer not null default 0,
  wrong      integer not null default 0,
  last_seen  timestamptz,
  updated_at timestamptz not null default now(),

  primary key (user_id, trade_id)
);

create index if not exists drill_cards_user_idx
  on public.drill_cards (user_id, last_seen);

alter table public.drill_cards enable row level security;

drop policy if exists own_rows on public.drill_cards;
create policy own_rows on public.drill_cards for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists drill_cards_touch on public.drill_cards;
create trigger drill_cards_touch before update on public.drill_cards
  for each row execute function public.touch_updated_at();
