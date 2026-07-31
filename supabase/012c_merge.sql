-- ===================================================================
--  012c — THE MERGE.  Run this THIRD.  THIS ONE CHANGES YOUR DATA.
--
--  Do not run it until 012a_backup.sql has printed two non-zero counts
--  and 012b_preview.sql has shown you a list you are happy with.
--
--  Folds each split position back into one trade with its sells as
--  tranches — which is what the importer produces today. Net P&L and
--  charges come out identical to the rupee. Trade count falls, and R
--  is restated against the whole position rather than each fragment.
--
--  Scoped to ONE account — see WHICH ACCOUNT below. It will not touch
--  the other account that has split positions.
--
--  WHY THIS IS ONE DO BLOCK
--
--  The first version used `begin; … commit;` around several statements
--  and a temporary table to carry the plan between them. That failed
--  with `relation "target" does not exist`: the SQL Editor does not
--  guarantee consecutive statements land on the same connection, and a
--  temp table lives and dies with its session. Real tables survived it
--  — 012a's did — which is the tell.
--
--  The same doubt applies to `begin`/`commit`: a transaction opened on
--  one connection and committed on another is not a transaction. For
--  something that deletes rows, "probably atomic" is not good enough.
--
--  A DO block is a single statement. It cannot be split across
--  connections, and it either completes or rolls back entirely. The
--  plan goes in a real table so it survives as a record of what was
--  folded into what.
--
--  Supabase → SQL Editor → New query → paste all of this → Run.
--
--  EXPECT: one row — positions_merged 29, rows_removed 30, and
--          sells_now_on_survivors matching the tranches that moved.
--
--  A SECOND RUN IS REFUSED, not repeated. Zero merged reads like a
--  failure and means the same thing as success once the account is
--  already clean, so the file will not let you get that answer twice
--  without saying so. 012_state.sql tells you which state you are in.
-- ===================================================================

do $$
declare
  -- -----------------------------------------------------------------
  --  WHICH ACCOUNT.  Edit these eight characters to repair a different
  --  one; 012_scope_check.sql lists them. 3af0f255 is the account
  --  measured through the app — 29 split positions, 59 trades.
  --
  --  The other account holding split positions (fa6d145f, 91 trades)
  --  is untouched until you come back and change this line.
  -- -----------------------------------------------------------------
  v_prefix constant text := '3af0f255';

  v_user uuid;
  v_n    int;
begin
  -- Nothing destructive happens without something to undo it with.
  if to_regclass('backup.trades_012') is null then
    raise exception
      'no backup found — run 012a_backup.sql first, then 012b_preview.sql';
  end if;

  -- Refuses to go on unless the prefix names exactly one account. None
  -- would merge nothing; two would quietly widen the blast radius,
  -- which is the whole reason this is scoped at all.
  select count(distinct user_id) into v_n
    from public.trades
   where left(user_id::text, 8) = v_prefix;

  if v_n <> 1 then
    raise exception 'expected exactly one account for prefix %, matched %',
      v_prefix, v_n;
  end if;

  select distinct user_id into v_user
    from public.trades
   where left(user_id::text, 8) = v_prefix;

  -- ---------------------------------------------------------------
  --  The plan: which row survives, which rows fold into it.
  --  A real table, not a temporary one — see the header.
  -- ---------------------------------------------------------------
  --
  --  Refuses to overwrite a plan that already has rows in it. Running
  --  this file twice is otherwise harmless — the second pass finds no
  --  split positions and merges nothing — but it rebuilds the plan
  --  empty on its way there, destroying the only record of which row
  --  absorbed which. That record is what makes the merge auditable
  --  afterwards, so a re-run has to be deliberate.
  if to_regclass('backup.merge_plan_012') is not null
     and (select count(*) from backup.merge_plan_012) > 0 then
    raise exception
      '012c has already run — its plan is in backup.merge_plan_012 (% rows). '
      'Drop that table first if you really mean to run it again.',
      (select count(*) from backup.merge_plan_012);
  end if;

  drop table if exists backup.merge_plan_012;

  create table backup.merge_plan_012 as
  with grp as (
    select user_id, symbol, entry_date, side
      from public.trades
     where user_id = v_user
     group by user_id, symbol, entry_date, side
    having count(*) > 1
  ),
  eligible as (
    select t.* from public.trades t
      join grp g using (user_id, symbol, entry_date, side)
  ),
  safe as (
    select user_id, symbol, entry_date, side
      from eligible
     group by user_id, symbol, entry_date, side
    having bool_and(status = 'closed')
       and bool_and(imported is true)
       and bool_and(coalesce(notes, '') = '')
       and bool_and(coalesce(pattern, '') = '')
       and bool_and(coalesce(thesis, '') = '')
       and bool_and(coalesce(array_length(mistakes, 1), 0) = 0)
  ),
  rows_in_play as (
    select e.* from eligible e join safe s using (user_id, symbol, entry_date, side)
  ),
  -- The oldest row survives, so the position keeps the identity it has
  -- had longest. id breaks a tie on identical timestamps.
  ranked as (
    select id, user_id, symbol, entry_date, side,
           row_number() over (partition by user_id, symbol, entry_date, side
                              order by created_at, id) as rn
      from rows_in_play
  )
  select
    first_value(r.id) over (partition by r.user_id, r.symbol, r.entry_date, r.side
                            order by r.rn)              as keep_id,
    r.id                                                as row_id,
    r.rn                                                as rn
  from ranked r;

  alter table backup.merge_plan_012 enable row level security;

  -- 1. Every sell moves onto the surviving position. Nothing is
  --    deleted: the tranches are the record of what actually happened.
  update public.trade_exits x
     set trade_id = p.keep_id
    from backup.merge_plan_012 p
   where x.trade_id = p.row_id
     and p.rn > 1;

  -- 2. The survivor takes on the whole position. Entry price is
  --    weighted by quantity, which is what the importer does with two
  --    fills on one day inside a single file.
  update public.trades t
     set quantity          = totals.qty,
         entry_price       = round(totals.entry, 2),
         charges           = round(totals.charges, 2),
         -- Left alone where there was no stop to take a percentage
         -- from, rather than overwritten with a null. A trade with no
         -- stop keeps having no stop; it does not lose one it had.
         initial_stop_loss = case when totals.frac is not null
                                  then round(totals.entry * (1 - totals.frac), 2)
                                  else t.initial_stop_loss end,
         stop_loss         = case when totals.frac is not null
                                  then round(totals.entry * (1 - totals.frac), 2)
                                  else t.stop_loss end,
         updated_at        = now()
    from (
      select p.keep_id,
             sum(t2.quantity)                                          as qty,
             sum(t2.quantity * t2.entry_price)
               / nullif(sum(t2.quantity), 0)                           as entry,
             sum(t2.charges)                                           as charges,
             -- The stop is re-derived at the percentage the surviving
             -- row already sat at, so an assumed 18% stays an assumed
             -- 18% of the new entry rather than a number left over
             -- from one fragment.
             max(case when t2.id = p.keep_id
                       and t2.entry_price > 0
                       and t2.initial_stop_loss > 0
                      then (t2.entry_price - t2.initial_stop_loss) / t2.entry_price
                 end)                                                  as frac
        from backup.merge_plan_012 p
        join public.trades t2 on t2.id = p.row_id
       group by p.keep_id
    ) totals
   where t.id = totals.keep_id;

  -- 3. The legacy single-exit columns summarise the tranches, so they
  --    are restated from them: last sell out, average price in.
  --    schema.sql requires both on a closed trade. Runs after step 1,
  --    so it sees the sells that have just moved across.
  update public.trades t
     set exit_date  = agg.last_out,
         exit_price = round(agg.avg_price, 2)
    from (
      select x.trade_id,
             max(x.exit_date)                                        as last_out,
             sum(x.quantity * x.price) / nullif(sum(x.quantity), 0)  as avg_price
        from public.trade_exits x
       where x.trade_id in (select keep_id from backup.merge_plan_012)
       group by x.trade_id
    ) agg
   where t.id = agg.trade_id;

  -- 4. The absorbed rows go. Their sells moved in step 1, so the
  --    cascade on trade_exits has nothing left to take with it.
  delete from public.trades t
   using backup.merge_plan_012 p
   where t.id = p.row_id
     and p.rn > 1;
end $$;


-- The plan table is left behind on purpose: it is the record of which
-- row absorbed which, and 012e restores against it.
select
  count(*) filter (where rn = 1)  as positions_merged,
  count(*) filter (where rn > 1)  as rows_removed,
  (select count(*) from public.trade_exits x
    join backup.merge_plan_012 p on p.keep_id = x.trade_id) as sells_now_on_survivors
from backup.merge_plan_012;
