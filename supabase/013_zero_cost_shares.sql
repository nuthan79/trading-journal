-- ===================================================================
--  Migration 013 — shares that cost nothing
--
--  WHAT THIS IS FIXING
--
--  Bonus shares, splits and allotments arrive at zero cost, and the
--  Zerodha Tax P&L reports that honestly as a buy value of 0. The
--  importer treated a zero buy value as a broken row and held it back,
--  which left one honest option — edit the file — and produced trades
--  whose entry price was a made-up number divided by the quantity. Three
--  shares carrying a fabricated buy value of 10 became an entry price of
--  3.33, a risk of nearly nothing, and an R of five thousand.
--
--  A free share is not a broken purchase. It is a different kind of
--  thing: no decision, no risk, no R — but the money it makes on the way
--  out is real and belongs in the P&L.
--
--  So `acquisition` says which it is, and entry_price is allowed to be
--  zero only when the row admits to being free. Anything else still has
--  to have a positive price, because a zero there really is broken.
--
--  Purely additive. Existing rows become 'purchase', which is what they
--  all are. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

-- -------------------------------------------------------------------
--  1. How the shares were acquired.
-- -------------------------------------------------------------------
alter table public.trades
  add column if not exists acquisition text not null default 'purchase';

alter table public.trades drop constraint if exists trades_acquisition_check;
alter table public.trades
  add constraint trades_acquisition_check
  check (acquisition in ('purchase', 'bonus'));

comment on column public.trades.acquisition is
  'purchase = bought, and carries risk. bonus = arrived free (bonus issue, '
  'split, allotment): its P&L is real, its R is undefined and every R '
  'figure in the app leaves it out.';

-- -------------------------------------------------------------------
--  2. Entry price may be zero, but only when the row says it was free.
--
--     The original CHECK (entry_price > 0) is right for a purchase and
--     wrong for a bonus issue. Replacing it rather than dropping it
--     keeps a zero from slipping in as a typo on an ordinary trade.
-- -------------------------------------------------------------------
alter table public.trades drop constraint if exists trades_entry_price_check;
alter table public.trades drop constraint if exists entry_price_positive_unless_free;
alter table public.trades
  add constraint entry_price_positive_unless_free
  check (entry_price > 0 or (acquisition = 'bonus' and entry_price = 0));

-- -------------------------------------------------------------------
--  3. A free share has no stop, and must never be given one.
--
--     An assumed stop is a percentage below the entry price. Below zero
--     is zero, so the risk is zero and every R divides by it. The bulk
--     fill and the "needs a stop" count both skip these rows in code;
--     this stops anything else putting one there.
-- -------------------------------------------------------------------
alter table public.trades drop constraint if exists no_stop_on_free_shares;
alter table public.trades
  add constraint no_stop_on_free_shares
  check (acquisition <> 'bonus'
         or (stop_loss is null and initial_stop_loss is null));

-- -------------------------------------------------------------------
--  Check
-- -------------------------------------------------------------------
select acquisition, count(*) as trades
  from public.trades
 group by acquisition
 order by acquisition;
