-- ===================================================================
--  Migration 009 — let an import complete a position instead of
--                  duplicating it
--
--  THE BUG
--
--  Dedupe matches on the whole of symbol|entry_date|exit_date|quantity
--  and importTrades only ever inserts. Two consequences, both wrong:
--
--  1. A position entered by hand while it was open carries no exit
--     date, so its key is SYM|2026-06-17||900. When it later shows up
--     sold in a Tax P&L file the importer builds SYM|2026-06-17|
--     2026-09-15|900. Different keys, so the file inserts a second
--     trade and the hand-entered one sits open forever, holding the
--     stop and the thesis, inflating open risk.
--
--  2. Worse. Import a period in July: TATASTEEL, 300 sold on the 13th,
--     key ...|2026-07-13|300. Import the same financial year again in
--     October, by which time the rest has gone: the importer now groups
--     the position as 900 with two tranches and builds
--     ...|2026-10-20|900. No match, so it inserts a second trade that
--     also contains the 13 July sell. That sell is now counted twice
--     and the P&L is silently wrong.
--
--  Re-importing an IDENTICAL file was always caught. It is the grown
--  period that slips through, which is exactly the normal workflow.
--
--  THE FIX
--
--  Match on symbol + entry_date alone to find the position already in
--  the journal, then attach only the sells it doesn't have. The client
--  does the matching; this migration provides the two things it can't:
--  a way to tag attached sells to the batch that brought them, and an
--  undo that knows about them.
--
--  Purely additive. Nothing dropped, no value overwritten. Safe to
--  re-run.
--
--  Run in Supabase → SQL Editor → New query → Run.
-- ===================================================================

-- -------------------------------------------------------------------
--  1. Which batch brought a sell.
--
--  Null for every sell recorded by hand, and for the tranches written
--  by imports before this migration — those came in with their trade
--  and are removed with it, so undo already covered them.
-- -------------------------------------------------------------------
alter table public.trade_exits
  add column if not exists import_batch uuid
    references public.import_batches on delete set null;

create index if not exists trade_exits_batch_idx
  on public.trade_exits (import_batch)
  where import_batch is not null;

-- -------------------------------------------------------------------
--  2. Undo, taught about attached sells.
--
--  Order matters. Delete the attached sells first, while their trades
--  still exist, so the sync trigger recomputes status, exit_date and
--  exit_price on each one — a position completed by an import has to
--  go back to being open, not stay closed with its sells removed.
--
--  Sells that arrived with an imported trade need no handling here:
--  deleting the trade cascades to them.
--
--  The count returned still means trades removed, not rows touched.
-- -------------------------------------------------------------------
create or replace function public.undo_import(p_batch uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare removed integer;
begin
  delete from public.trade_exits
   where user_id = auth.uid() and import_batch = p_batch;

  delete from public.trades
   where user_id = auth.uid() and import_batch = p_batch;
  get diagnostics removed = row_count;

  delete from public.import_batches
   where user_id = auth.uid() and id = p_batch;

  return removed;
end $$;

grant execute on function public.undo_import(uuid) to authenticated;

-- -------------------------------------------------------------------
--  3. Verify.
--
--  has_column   — must be 1.
--  tagged_exits — 0 today; grows as imports complete open positions.
--  Both counts are the whole table, not one user: the SQL editor runs
--  as the service role and sees past RLS.
-- -------------------------------------------------------------------
select (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'trade_exits'
           and column_name = 'import_batch')                    as has_column,
       (select count(*) from public.trade_exits
         where import_batch is not null)                        as tagged_exits,
       (select count(*) from public.trade_exits)                as total_exits;
