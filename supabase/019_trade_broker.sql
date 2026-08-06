-- ===================================================================
--  Migration 019 — which broker a trade came from
--
--  WHAT THIS PREVENTS
--
--  `reconcile` matches an incoming position against the journal on
--  symbol and entry date, and nothing else. That was right while
--  Zerodha was the only source: it is exactly what lets a re-imported
--  overlapping period find its own position instead of inserting a
--  second copy of it.
--
--  It becomes wrong the moment a second broker exists. Buy the same
--  stock on the same day through two brokers — routine for anyone
--  running two accounts, not a coincidence — and importing the second
--  file finds the first broker's trade and either:
--
--    · skips the new position entirely as a duplicate, so the journal
--      quietly holds one trade where there were two; or
--    · attaches the second broker's sells to the first broker's trade
--      and grows the quantity to cover them, blending two real
--      positions into one that never existed, with an entry price and
--      an R measured against a size never held.
--
--  Both were reproduced against the real reconcile before this was
--  written. Neither announces itself: the numbers stay plausible.
--
--  THE RULE THIS ENABLES
--
--  Two KNOWN and DIFFERENT brokers never match. An UNKNOWN broker
--  matches either way, which is what keeps a hand-entered trade
--  completable by a later import instead of being duplicated by it.
--
--  Purely additive, nullable. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.trades
  add column if not exists broker text;

comment on column public.trades.broker is
  'Adapter id of the import this trade came from — "zerodha", "dhan". '
  'Null for a trade entered by hand, and null matches any broker so a '
  'later import can complete it rather than duplicate it.';

-- Matching reads symbol, entry date and now this, per user.
create index if not exists trades_user_broker_idx
  on public.trades (user_id, broker, symbol, entry_date);

-- -------------------------------------------------------------------
--  Backfill.
--
--  Every imported trade in existence came from the Zerodha adapter,
--  because it is the only one there has ever been. Hand-entered rows
--  stay null on purpose — that is not a missing value, it is the
--  absence of a broker, and it is what makes them completable.
-- -------------------------------------------------------------------
update public.trades
   set broker = 'zerodha'
 where imported is true
   and broker is null;

-- -------------------------------------------------------------------
--  Check
-- -------------------------------------------------------------------
select coalesce(broker, '(entered by hand)') as broker,
       count(*)                              as trades
  from public.trades
 group by 1
 order by 2 desc;
