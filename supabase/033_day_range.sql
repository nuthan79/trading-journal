-- ===================================================================
--  Migration 033 — where a price sits inside its own day
--
--  Two more numbers from the quote fetch that already runs. Yahoo
--  returns regularMarketDayHigh and regularMarketDayLow in the same
--  `meta` object as the price and the previous close, so this costs no
--  extra request — the same shape as 032.
--
--  WHAT IT IS FOR. Closing near the high of the day means demand held
--  into the close; giving back the day's gain and closing near the low
--  means supply met it. On a breakout that is a real read on whether
--  the setup is working, and it is the thing you would otherwise open a
--  chart to see.
--
--  Deliberately NOT shown on every row. Only holdings sitting in the
--  top or bottom fifth of their day get a mark, so most rows say
--  nothing and the two that matter stand out. A column showing the same
--  reading for all eight would be eight numbers to compare instead of a
--  signal.
--
--  THE SAME INVARIANT AS 032. Both are written in the same update as
--  last_price, and both are nulled when a fetch returns without them,
--  so the range and the price it is measured against always come from
--  one response. A price compared to yesterday's range would place a
--  holding at the top of a day it never traded in.
--
--  AND A LIMIT WORTH KNOWING. These are only as fresh as the last
--  Refresh, so before the first fetch of a session the flag describes
--  the previous session. That is the same caveat the Today figure
--  carries and it is stated in the tooltip rather than implied.
--
--  Purely additive. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.trades
  add column if not exists day_high numeric,
  add column if not exists day_low  numeric;

comment on column public.trades.day_high is
  'Session high from the same quote fetch as last_price. Written together with '
  'it and nulled when absent, so a price is never placed inside a range from a '
  'different day.';
comment on column public.trades.day_low is
  'Session low, from the same fetch as day_high and last_price.';
