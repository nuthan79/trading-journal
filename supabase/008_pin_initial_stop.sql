-- ===================================================================
--  Migration 008 — keep initial_stop_loss pinned, for good
--
--  007 added initial_stop_loss and backfilled the rows that existed
--  then. What it didn't do was make anything *keep* filling it, and
--  no client write path did either — TradeForm never sent the column.
--  So every trade logged through the form since 007 carries a null,
--  and derivePosition() falls back to stop_loss when it's missing.
--
--  The effect is quiet and wrong: 1R is supposed to be fixed at entry,
--  but for those rows it silently re-bases to wherever the stop has
--  been trailed to. Move a stop up and the trade's whole R history
--  shifts under it. Move a stop to entry and 1R becomes zero, so every
--  R on that trade divides by nothing.
--
--  Two parts: repair the existing nulls, then make the database itself
--  responsible for the invariant so no future write path can miss it —
--  the app, the Zerodha importer, StopFill, or a hand-written query.
--
--  Purely additive. No column dropped. Nulls that should stay null do.
--  Safe to re-run.
--
--  Run in Supabase → SQL Editor → New query → Run.
-- ===================================================================

-- -------------------------------------------------------------------
--  1. Repair.
--
--  Sound only because no stop has been trailed yet, so stop_loss still
--  holds the stop each position was opened with. If a stop HAD been
--  moved, this would pin 1R to the trailed value rather than the entry
--  one — wrong, and unrecoverable from the row alone. Check before
--  running (expect 0):
--
--    select count(*) from public.trades
--     where initial_stop_loss is not null
--       and stop_loss is distinct from initial_stop_loss;
--
--  Imported trades awaiting a stop stay null on both columns: there is
--  no known stop, and inventing one would park every loser at −1R by
--  construction. Part 2 pins theirs the moment StopFill supplies it.
-- -------------------------------------------------------------------
update public.trades
   set initial_stop_loss = stop_loss
 where initial_stop_loss is null
   and stop_loss is not null;

-- -------------------------------------------------------------------
--  2. The invariant, enforced where it can't be forgotten.
--
--  First stop a trade is given becomes its 1R, permanently. Once set,
--  nothing here touches it again — trailing a stop only ever writes
--  stop_loss, so R stays measured against the risk actually taken.
-- -------------------------------------------------------------------
create or replace function public.pin_initial_stop()
returns trigger language plpgsql as $$
begin
  if new.initial_stop_loss is null then
    new.initial_stop_loss := new.stop_loss;   -- null stays null
  end if;
  return new;
end;
$$;

drop trigger if exists trades_pin_initial_stop on public.trades;
create trigger trades_pin_initial_stop
  before insert or update on public.trades
  for each row execute function public.pin_initial_stop();

-- -------------------------------------------------------------------
--  3. Verify.
--
--  needs_a_stop  — imported rows still awaiting one. Both columns null;
--                  this is the 'need a stop' count in the app's header.
--  pinned        — has a stop, and 1R is recorded against it.
--  UNPINNED      — must be 0. A stop with no 1R behind it is the bug.
--  trailed       — stop moved since entry. 0 today; grows as you trail,
--                  and each one is a position whose risk is now smaller
--                  than the 1R it is still measured against. Expected.
-- -------------------------------------------------------------------
select count(*) filter (where stop_loss is null
                          and initial_stop_loss is null)       as needs_a_stop,
       count(*) filter (where initial_stop_loss is not null)   as pinned,
       count(*) filter (where stop_loss is not null
                          and initial_stop_loss is null)       as unpinned,
       count(*) filter (where stop_loss is distinct from initial_stop_loss
                          and initial_stop_loss is not null)   as trailed,
       count(*)                                                as total
  from public.trades;
