-- ===================================================================
--  012f — CLEANUP.  Run this LAST, and only when you are satisfied.
--
--  Drops the backup taken by 012a. After this there is nothing to
--  restore from, so leave it a few days and look at your numbers first.
--
--  Supabase → SQL Editor → New query → paste all of this → Run.
-- ===================================================================

drop table if exists backup.exits_012;
drop table if exists backup.trades_012;
drop schema if exists backup;
