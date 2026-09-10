-- ===================================================================
--  Migration 048 — the best price this position has been seen at
--
--  WHAT WENT WRONG WITHOUT IT. The breakeven flag on Holdings asks
--  "has this run far enough that the stop can come up to entry". It
--  was answered from the LIVE mark, so a position that ran past 1.5R
--  and slipped back lost its prompt — unacknowledged, unrecorded, and
--  with nothing left to say it had ever been earned.
--
--  The obvious repair was to read `became_free_on`, which records the
--  first close at or past 1.5R. That is a real fact and it is not
--  enough: it comes from `price_bars` via the measure pass, which is
--  optional, runs weekly for open positions, and on a journal that has
--  never measured is null everywhere. The flag stayed dark on exactly
--  the trade that prompted the fix.
--
--  So the app remembers what it has already seen. Every quote refresh
--  already writes `last_price`, `day_high` and `day_low` onto the
--  trade; the high water mark costs one more column and no extra
--  request.
--
--  A PRICE, NOT AN R, AND DELIBERATELY. Stored as R it would freeze
--  the stop that was in place when it was written, and a trader who
--  later widens or tightens a stop would carry a peak measured against
--  a risk they no longer run. As a price it is a fact about the market
--  and R is recomputed against whatever stop the trade holds now.
--
--  DIRECTION AWARE. For a long this is the highest price seen, for a
--  short the lowest. The writer picks the side; nothing here can, so
--  the column is documented rather than constrained.
--
--  It only ever knows what the app has WATCHED. A position that peaked
--  before this column existed seeds at the next refresh's price, which
--  understates it — the measure pass backfills that history from bars
--  through `mfe_r`, and the flag reads both.
--
--  Purely additive, nullable, no default. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.trades
  add column if not exists peak_mark numeric;

comment on column public.trades.peak_mark is
  'Best price this position has been observed at since it was opened — the '
  'highest for a long, the lowest for a short — taken from the quote and the '
  'session high or low on every refresh. A PRICE, not an R, so moving the stop '
  'recomputes what it is worth instead of freezing an old risk. Null until the '
  'first refresh after 048; mfe_r carries the same fact for measured trades.';

-- -------------------------------------------------------------------
--  Check
-- -------------------------------------------------------------------
select count(*)                                          as open_positions,
       count(peak_mark)                                  as with_a_peak,
       count(*) filter (where mfe_r is not null)         as measured
  from public.trades
 where status <> 'closed';
