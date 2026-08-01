-- ===================================================================
--  015 repair — stops the breakeven button overwrote with the entry
--
--  WHAT HAPPENED
--
--  The flag at 1.5R used to be a button. Clicking it wrote the entry
--  price into stop_loss and kept the real stop in initial_stop_loss, so
--  the open-risk dial could stop counting the position. That was the
--  second half of the two-stop model, now removed: the flag is a
--  reminder to raise the stop at the broker and writes nothing.
--
--  The rows clicked before that change still hold entry as their stop.
--  Under one stop that means a stop width of 0.0%, a 1R of zero, an
--  open risk of zero and no unrealised R at all — the column simply
--  reads "—", because there is no risk to divide by.
--
--  Nothing was lost. The real stop is sitting in initial_stop_loss,
--  which is exactly where that button put it, so this is a restore and
--  not a reconstruction.
--
--  HOW IT FINDS THEM
--
--  stop_loss equal to entry_price to the paisa, AND an initial_stop_loss
--  that differs. A stop deliberately typed at the entry price would
--  match the first half; it would not match the second, because the
--  form writes both columns the same.
--
--  Supabase → SQL Editor → New query → paste PART 1 → Run.
-- ===================================================================


-- -------------------------------------------------------------------
--  PART 1 — what would change. Reads only.
--
--  EXPECT: the positions carrying the green flag. On the account this
--  was written for: KTKBANK, DIVISLAB, KMEW.
--
--  `stop_now` is the entry price, `stop_would_become` is what you
--  actually set. If any row looks like a stop you genuinely wanted at
--  entry, note its id and exclude it in PART 2.
-- -------------------------------------------------------------------
select
  id,
  symbol,
  status,
  entry_date,
  entry_price,
  stop_loss                                      as stop_now,
  initial_stop_loss                              as stop_would_become,
  round(((entry_price - initial_stop_loss) / entry_price * 100)::numeric, 2)
                                                 as sl_pct_would_become
from public.trades
where stop_loss = entry_price
  and initial_stop_loss is not null
  and initial_stop_loss <> stop_loss
order by status, symbol;


-- -------------------------------------------------------------------
--  PART 2 — restore. Run when PART 1 looks right.
--
--  Puts the real stop back and keeps both columns equal, which is what
--  every writer in the app now does.
--
--  To spare a row, add its id to the `and id <> '...'` line.
--
--  EXPECT: one row back per position restored.
-- -------------------------------------------------------------------
update public.trades
   set stop_loss  = initial_stop_loss,
       updated_at = now()
 where stop_loss = entry_price
   and initial_stop_loss is not null
   and initial_stop_loss <> stop_loss
   -- and id <> 'PASTE-AN-ID-TO-SKIP-IT'
 returning symbol, entry_date, entry_price,
           stop_loss as stop_restored,
           round(((entry_price - stop_loss) / entry_price * 100)::numeric, 2)
             as sl_pct_now;


-- -------------------------------------------------------------------
--  Afterwards — should return no rows.
-- -------------------------------------------------------------------
-- select symbol, entry_price, stop_loss, initial_stop_loss
--   from public.trades
--  where stop_loss = entry_price
--    and initial_stop_loss is not null
--    and initial_stop_loss <> stop_loss;
