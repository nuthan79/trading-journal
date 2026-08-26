-- ===================================================================
--  Migration 041 — daily bars, and what each trade reached
--
--  WHY
--
--  The journal knew three prices per trade: entry, the last one
--  fetched, and exit. Nothing about the road between them. So it
--  could say what a trade RETURNED and nothing about what it
--  OFFERED, and the most useful question a swing journal can ask —
--  how much of what your trades gave you did you actually take —
--  had no data behind it.
--
--  The 1.5R flag on Holdings shows the shape of the gap. It reads
--  the last price fetched, so a stock that ran to 2R on a Tuesday
--  nobody opened the app is a thing that never happened.
--
--  TWO TABLES' WORTH OF IDEA, ONE OF THEM SHARED
--
--  price_bars is market data, not user data. One row per symbol per
--  day serves every user holding that stock, so a hundred people in
--  RELIANCE cost one row a day between them rather than a hundred.
--  That is also why it carries no user_id and needs no policy per
--  person: there is nothing in it that belongs to anybody.
--
--  Reads are open to any signed-in user. Writes are closed to
--  everyone — the service role bypasses RLS and is the only thing
--  that fills this table, from /api/bars. A client that could write
--  here could poison a price for every other user.
--
--  Purely additive. Safe to re-run.
--
--  Supabase -> SQL Editor -> New query -> Run.
-- ===================================================================

create table if not exists public.price_bars (
  symbol    text not null,
  exchange  text not null default 'NSE' check (exchange in ('NSE','BSE')),
  d         date not null,
  o         numeric,
  h         numeric,
  l         numeric,
  c         numeric not null,
  primary key (symbol, exchange, d)
);

comment on table public.price_bars is
  'Daily OHLC per listing, shared across all users. Market data only — no '
  'user_id, no policy per person. Written solely by the service role via '
  '/api/bars; readable by any signed-in user.';

alter table public.price_bars enable row level security;

-- Readable by everyone signed in. No insert/update/delete policy exists
-- on purpose, so RLS denies all writes; the service role bypasses it.
drop policy if exists "price_bars readable" on public.price_bars;
create policy "price_bars readable"
  on public.price_bars for select
  to authenticated
  using (true);

create index if not exists price_bars_lookup_idx
  on public.price_bars (symbol, exchange, d);

-- -------------------------------------------------------------------
--  What each trade reached, measured from those bars.
--
--  Cached on the trade rather than recomputed: once a position is
--  closed these never change, and Review would otherwise need every
--  bar for every trade in the browser — seventy thousand rows on a
--  long book.
--
--  ALL MEASURED ON THE DAILY CLOSE. A stock that touched 3R at 11am
--  and closed at 1.2R did not hand anybody a 3R decision, and a
--  screen that says "you gave up 3R" over it is describing an
--  opportunity that was never on offer.
-- -------------------------------------------------------------------
alter table public.trades
  add column if not exists mfe_r            numeric,
  add column if not exists mae_r            numeric,
  add column if not exists mfe_days         integer,
  add column if not exists became_free_on   date,
  add column if not exists is_power         boolean,
  add column if not exists gapped_breakeven boolean,
  add column if not exists path_to          date;

comment on column public.trades.mfe_r is
  'Best daily CLOSE while held, in R. Entry day excluded — that bar contains '
  'the move before the position existed.';
comment on column public.trades.mae_r is
  'Worst daily close while held, in R.';
comment on column public.trades.mfe_days is
  'Trading sessions from entry to that best close, counted as BARS, so '
  'weekends and exchange holidays need no calendar here.';
comment on column public.trades.became_free_on is
  'First session that closed at or past 1.5R — when the stop could have gone '
  'to breakeven. Null if it never did.';
comment on column public.trades.is_power is
  'Closed at or past 3R within 5 sessions of entry.';
comment on column public.trades.gapped_breakeven is
  'True if the first session to close below entry after the trade was free '
  'also OPENED below it, having closed above the day before — price jumped '
  'the level rather than trading through it. NULL means undecidable, and '
  'never reads as false: false is the value that accuses somebody.';
comment on column public.trades.path_to is
  'Last bar date these figures account for. On an open position this is how '
  'stale they are; on a closed one it should equal the exit date.';

-- -------------------------------------------------------------------
--  Check
-- -------------------------------------------------------------------
select
  (select count(*) from public.price_bars)                        as bars_cached,
  (select count(*) from public.trades where mfe_r is not null)    as trades_measured,
  (select count(*) from public.trades where status = 'closed')    as trades_closed;
