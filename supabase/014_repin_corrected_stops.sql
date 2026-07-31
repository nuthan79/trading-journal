-- ===================================================================
--  014 repair — 1R still pinned to a stop the app invented
--
--  Correcting an assumed stop used to drop the "assumed" label without
--  moving initial_stop_loss, so R went on dividing by the number the
--  importer guessed. KTKBANK corrected from 258.26 to 269 on a 277.70
--  entry reported -0.28R where the truth was -0.61R, and showed a stop
--  width of 7% beside a stop 3.1% away.
--
--  The form no longer does this. Rows corrected before the fix are
--  still wrong, and cannot be repaired by re-saving them: they now say
--  `recorded`, so the app has no way to tell a correction it mishandled
--  from a stop that was legitimately trailed.
--
--  Which is why this asks rather than guesses. PART 1 lists the
--  candidates; you decide which were corrections. PART 2 repins only
--  the ids you name.
--
--  Supabase → SQL Editor → New query → paste PART 1 → Run.
-- ===================================================================


-- -------------------------------------------------------------------
--  PART 1 — candidates. Reads only.
--
--  Every trade whose 1R is pinned somewhere other than its current
--  stop. Two very different things live in this list:
--
--    · a stop you TRAILED — 1R should stay where it is, leave it alone
--    · a stop you CORRECTED — 1R should have followed, repin it
--
--  `1R_is` versus `stop_is` tells you which. A trailed long has a stop
--  ABOVE its pinned 1R and usually a profit; a correction can go either
--  way and will sit on an imported trade.
-- -------------------------------------------------------------------
select
  id,
  symbol,
  entry_date,
  entry_price,
  initial_stop_loss                                   as "1R_is",
  stop_loss                                           as stop_is,
  round(((entry_price - initial_stop_loss) / entry_price * 100)::numeric, 2)
                                                      as sl_pct_shown,
  round(((entry_price - stop_loss) / entry_price * 100)::numeric, 2)
                                                      as sl_pct_actual,
  imported,
  stop_source
from public.trades
where stop_loss is not null
  and initial_stop_loss is not null
  and stop_loss <> initial_stop_loss
order by symbol, entry_date;


-- -------------------------------------------------------------------
--  PART 2 — repin. EDIT THE ID LIST FIRST, then run.
--
--  Moves 1R onto the current stop for the trades you name, and only
--  those. Paste the ids from PART 1 that were corrections, not trails.
--  Running it with the list as it stands changes nothing.
-- -------------------------------------------------------------------
update public.trades
   set initial_stop_loss = stop_loss,
       updated_at        = now()
 where id in (
   -- '00000000-0000-0000-0000-000000000000',
   -- '11111111-1111-1111-1111-111111111111'
   null
 )
 returning symbol, entry_date, entry_price,
           initial_stop_loss as "1R_now",
           round(((entry_price - stop_loss) / entry_price * 100)::numeric, 2)
             as sl_pct_now;
