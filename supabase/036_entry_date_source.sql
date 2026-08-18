-- ===================================================================
--  Migration 036 — where the entry date came from
--
--  Importing a holdings file finally lets somebody arrive with the
--  positions they already hold. The file has the symbol, the quantity
--  and the average cost, and it does NOT have the date they bought —
--  no broker's holdings export does. Dhan's has no date either; Kite's
--  web CSV has nine columns and not one of them is a date.
--
--  `trades.entry_date` is `not null`, so the import must write
--  something. That something is a guess, and this column is what stops
--  the guess being mistaken for a measurement.
--
--  THE SAME SHAPE AS stop_source (011), on purpose. That column solved
--  this exact problem for the stop loss: an imported trade has no stop,
--  one gets assumed at a fixed percentage, and analysis.js then REFUSES
--  to compute discipline statistics from it — see the filters at
--  analysis.js:73 and :145. A tag that only tinted a cell would have
--  been decoration; a tag the calculations consult is a safeguard.
--
--  WHY A WRONG DATE IS NOT COSMETIC HERE. Dates are load-bearing in this
--  app in a way they are not in a plain ledger:
--
--    - edge.js buckets HOLDING PERIOD as an edge dimension, so a
--      two-year hold dated today reads as a zero-day trade and lands in
--      the wrong quantile band
--    - calc.js runs XIRR, CAGR, equityCurve() and Indian-FY periodizing
--      off entry_date, so a position bought in 2023 and dated today puts
--      its whole cost basis in the current financial year
--
--  None of those fail loudly. They return a number, and the number is
--  wrong, which is the failure mode this project keeps relearning: a
--  plausible wrong figure is worse than a blank one.
--
--  VALUES. 'recorded' — a real date, typed by the user or read from a
--  file that carried one. 'assumed' — the importer had to put something
--  in the column. NULL means the same as 'recorded' and is what every
--  existing row gets, because every date already in the table was either
--  typed by hand or came from a tax P&L, which does state buy dates.
--
--  Purely additive. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.trades
  add column if not exists entry_date_source text
    check (entry_date_source in ('recorded', 'assumed'));

comment on column public.trades.entry_date_source is
  'Where entry_date came from. ''assumed'' means an import had to invent it '
  'because the file carried no purchase date — holdings exports never do. '
  'Date-dependent analysis (holding period, XIRR, CAGR, equity curve, period '
  'breakdowns) must exclude these rather than treat them as measurements, the '
  'same way stop_source = ''assumed'' is excluded from R statistics. NULL '
  'means recorded.';

-- Existing rows are all genuine: typed by hand, or from a tax P&L, which
-- states its buy dates. Marked explicitly so that "unmarked" stays
-- meaningful as a category for anything written from here on.
update public.trades
   set entry_date_source = 'recorded'
 where entry_date_source is null;

-- Partial: the assumed rows are the ones the review queue has to find, and
-- they are the small minority. Indexing the whole column to locate them
-- would be paying for the rows we never look up.
create index if not exists trades_entry_date_source_idx
  on public.trades (user_id, entry_date_source)
  where entry_date_source = 'assumed';

-- ===================================================================
--  Check it landed. Expect assumed = 0 before the first holdings
--  import, and unmarked = 0 always.
-- ===================================================================
-- select count(*) filter (where entry_date_source = 'recorded') as recorded,
--        count(*) filter (where entry_date_source = 'assumed')  as assumed,
--        count(*) filter (where entry_date_source is null)      as unmarked
--   from public.trades;
