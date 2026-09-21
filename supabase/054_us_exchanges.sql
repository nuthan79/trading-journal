-- ===================================================================
--  Migration 054 — the venues a trade may name
--
--  FOUND BY TRYING IT. `trades.exchange` has carried
--  `check (exchange in ('NSE','BSE'))` since the first schema, which
--  was correct for every day this app has existed and is now the one
--  thing standing between a user and their first US trade: the save
--  fails with 23514, a constraint violation, which surfaces as a form
--  that will not submit and says nothing useful.
--
--  Phase 5 shipped the whole US book — the switch, the symbols, the
--  quotes, the charges — and could not write a single row into it.
--  The lesson worth keeping: a feature is not done because every
--  screen renders. Save one and see.
--
--  THE SAME CHECK IS ON price_bars (041), where it would stop the
--  daily history that breakeven marks and the excursion columns are
--  built from — a silent failure rather than a visible one, since
--  bars are fetched in the background.
--
--  `screens` (047) keeps its Indian check on purpose: a Chartink scan
--  is an Indian product and there is no US equivalent wired up.
--
--  Purely additive — it only widens what is allowed. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.trades drop constraint if exists trades_exchange_check;
alter table public.trades
  add constraint trades_exchange_check
  check (exchange in ('NSE', 'BSE', 'NASDAQ', 'NYSE', 'AMEX', 'ARCA', 'BATS', 'IEXG'));

alter table public.price_bars drop constraint if exists price_bars_exchange_check;
alter table public.price_bars
  add constraint price_bars_exchange_check
  check (exchange in ('NSE', 'BSE', 'NASDAQ', 'NYSE', 'AMEX', 'ARCA', 'BATS', 'IEXG'));

comment on column public.trades.exchange is
  'The venue: NSE or BSE in India, NASDAQ/NYSE/AMEX and the ETF venues in the '
  'US. Kept in step with REGIONS[].exchanges in src/lib/regions.js — a venue '
  'the app can offer and the database refuses is a form that will not submit.';

-- Verify:
--   select distinct exchange from public.trades;
