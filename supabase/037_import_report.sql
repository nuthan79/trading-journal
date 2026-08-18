-- ===================================================================
--  Migration 037 — what the import decided, kept
--
--  THE PROBLEM THIS SOLVES IS NOT A MISSING FEATURE, IT IS A MISSING
--  MOMENT. Everything an import knows about what it skipped and why is
--  said once, on the screen, immediately after the file is read — and
--  that is precisely when nobody is reading. People confirm the import
--  and go and look at their trades.
--
--  The question arrives later, and in a different form: "I hold PTC,
--  why isn't it here?" By then the explanation is gone. `import_batches`
--  has kept only counts — filename, how many trades, what date range —
--  which answers how much arrived and never which, nor what didn't.
--
--  So the report is stored beside the batch that produced it.
--
--  WHY jsonb RATHER THAN COLUMNS. The shape genuinely differs per file
--  kind: a tax P&L skips F&O sections and rejects rows with impossible
--  prices, a holdings file reports quantity disagreements, a tradebook
--  reports positions it cannot date because it only covers part of the
--  history. Columns would be a union of six mostly-null fields, and
--  every new adapter would want another one.
--
--  WHAT GOES IN IT, and the size rule. Per-symbol outcomes, so the
--  history can answer a question about one stock rather than making
--  somebody read a whole import. Capped in the writer — a thousand-trade
--  file must not put a megabyte of JSON in a row that is read every
--  time the Import page opens.
--
--    { kind, imported: ["SYM", …],
--      issues: [{ s: "SYM", o: "duplicate", why: "…" }],
--      sections: [{ section, rows }], warnings: [ … ], truncated: 0 }
--
--  `o` is the outcome and is the thing worth being consistent about:
--  duplicate, conflict, rejected, short, absent, dated, unreadable.
--
--  Purely additive, and null on every existing batch — those imports
--  happened before anything was recorded and nothing can reconstruct
--  them. The screen shows counts alone for those, as it always did.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

alter table public.import_batches
  add column if not exists report jsonb;

comment on column public.import_batches.report is
  'What the import decided, per symbol — so "why isn''t PTC here?" is '
  'answerable weeks later rather than only on the screen nobody reads at the '
  'time. Shape: { kind, imported[], issues[{s,o,why}], sections[], warnings[], '
  'truncated }. NULL on batches created before 037.';

-- ===================================================================
--  Check it landed. Expect with_report to grow from the next import on;
--  older rows staying null is correct, not a fault.
-- ===================================================================
-- select count(*)                                  as batches,
--        count(*) filter (where report is not null) as with_report
--   from public.import_batches;
