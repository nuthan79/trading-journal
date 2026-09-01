-- ===================================================================
--  044 — Volume on the daily bars
--
--  041 stored o/h/l/c because MFE/MAE only ever asked how far price
--  travelled. A chart asks a second question the price alone cannot
--  answer: whether anybody was there. A breakout on a quarter of average
--  volume and one on four times it look identical in candles.
--
--  Nullable, because every bar already stored predates this column and
--  backfilling would mean re-fetching history that is otherwise complete.
--  A bar with no volume simply draws no volume bar; the cache keeps
--  filling in as new sessions arrive.
--
--  Safe to re-run.
-- ===================================================================

alter table public.price_bars add column if not exists v numeric;

comment on column public.price_bars.v is
  'Session volume in shares. Null on bars stored before 044 — the price '
  'columns are complete, only this one backfills over time.';
