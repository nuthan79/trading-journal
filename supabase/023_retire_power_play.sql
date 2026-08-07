-- ===================================================================
--  023 — "Power Play" leaves the pattern list, its trades go to "Other"
--
--  WHY THIS IS NEEDED AT ALL
--
--  `trades.pattern` is free text with no CHECK constraint, so removing
--  a label from PATTERNS in constants.js does not remove it from the
--  data. Trades keep the old string and it becomes an orphan: the
--  dropdown no longer offers it, so opening one of those trades and
--  saving silently blanks the field, while the edge table goes on
--  showing "Power Play" as its own row that nothing can be moved out
--  of. Better to move them deliberately, once, and know the number.
--
--  "Other" rather than a guess. Nobody can say now which of the
--  remaining patterns each of those trades actually was, and picking
--  one would invent history in a column used to judge which setups pay.
--
--  Safe to re-run: the second pass finds nothing and reports zero.
-- ===================================================================


-- -------------------------------------------------------------------
--  PART 1 — how many, and whose. READS ONLY.
--
--  If this returns no rows, nothing was ever tagged Power Play and you
--  can skip PART 2 entirely.
-- -------------------------------------------------------------------
select
  left(user_id::text, 8)        as account,
  count(*)                      as trades,
  min(entry_date)               as earliest,
  max(entry_date)               as latest,
  count(*) filter (where status = 'closed') as closed
from public.trades
where pattern = 'Power Play'
group by 1
order by trades desc;


-- -------------------------------------------------------------------
--  PART 1b — name them, before deciding what they become. READS ONLY.
--
--  PART 1 found 8, all closed, all in 4742b877 — the account trades are
--  entered into by hand. So a person chose that label eight times; this
--  is not import noise.
--
--  That is worth a minute before running PART 2. "Other" is the right
--  answer for a bulk of unknowable rows, and the wrong one for eight
--  trades you can still recognise by name and date — especially now
--  that "High Tight Flag" and "Breakout Entry" exist, either of which
--  may be what you actually meant. Retagging eight trades in the app
--  keeps them in the edge table as something; "Other" retires them.
-- -------------------------------------------------------------------
-- select symbol, entry_date, exit_date, quantity, entry_price,
--        round(((exit_price - entry_price) / entry_price * 100)::numeric, 1) as pct,
--        notes, thesis
--   from public.trades
--  where pattern = 'Power Play'
--  order by entry_date;


-- -------------------------------------------------------------------
--  PART 2 — the move. Uncomment and run.
--
--  Only if you would rather not retag them by hand. See PART 1b.
--
--  Touches nothing but the pattern column, and only on rows that
--  actually say 'Power Play'. Every other field — entry, stop, exits,
--  charges, notes, mistakes — is left exactly as it is.
--
--  EXPECT: one row per trade moved, showing what it now reads. No rows
--  means there was nothing to move.
-- -------------------------------------------------------------------
-- update public.trades
--    set pattern    = 'Other',
--        updated_at = now()
--  where pattern = 'Power Play'
--  returning left(user_id::text, 8) as account, symbol, entry_date, pattern;


-- -------------------------------------------------------------------
--  PART 3 — verify. READS ONLY. Must come back 0.
-- -------------------------------------------------------------------
-- select count(*) as power_play_left
--   from public.trades
--  where pattern = 'Power Play';


-- -------------------------------------------------------------------
--  While you are here: anything else in the column that the dropdown
--  no longer offers. READS ONLY.
--
--  Patterns typed before a label was renamed, or imported from a file,
--  show up here. Each one is its own row in the edge table and cannot
--  be corrected through the form, for the same reason Power Play could
--  not have been.
-- -------------------------------------------------------------------
-- select pattern, count(*) as trades
--   from public.trades
--  where pattern is not null
--    and pattern <> ''
--    and pattern not in (
--      'VCP', 'Cup & Handle', 'Flat Base', 'Double Bottom',
--      'High Tight Flag', 'Ascending Base', 'All Time High',
--      'Breakout Entry', 'Pullback Entry', 'Other'
--    )
--  group by pattern
--  order by trades desc;
