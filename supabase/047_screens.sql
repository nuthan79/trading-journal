-- ===================================================================
--  Migration 047 — screens, their runs, and what each run found
--
--  Three scans, the same for every user, run on a schedule and read by
--  everyone: volume dry-up and contraction after the close, bullsnort
--  through the session. So the whole thing is one run and many
--  readers — nobody's browser talks to the scan source, and the source
--  sees one request per run however many users there are.
--
--  Shaped after price_bars (041), which is the same kind of data: no
--  user_id, no policy per person, readable by anyone signed in and
--  written solely by the service role. A screen result is a fact about
--  the market, not about a person.
--
--  THE CLAUSES ARE NOT IN THE REPOSITORY, and that is the point of
--  keeping them here rather than in code. This journal's repo is
--  public; the scan definitions are the thing paying customers are
--  paying for. They go in this table, inserted by hand, and the code
--  only ever refers to a screen by its slug.
--
--  A RUN IS RECORDED EVEN WHEN IT FINDS NOTHING, and that is the whole
--  reason screen_runs exists separately from screen_results.
--
--  "No stocks passed the volume dry-up scan today" is a tradeable
--  fact. "The scan did not run" and "the scan failed at 16:15" are
--  not, and an empty result table cannot tell the three apart. Every
--  one of them would render as an empty list and read as the first.
--  The same distinction Holdings already draws between a position with
--  no stop and a position at no risk — and it went wrong there first.
--
--  status  ok       ran, results stored (possibly zero of them)
--          empty    ran, nothing matched — said explicitly
--          skipped  not a trading day
--          failed   the source did not answer, or answered wrongly
--
--  as_of is the TRADING DAY the results describe, which is not always
--  the day the job ran: an intraday scan at 09:20 and the end-of-day
--  scan at 16:15 both describe the same session, and a job that runs
--  after midnight UTC still belongs to the Indian trading day it
--  followed. Everything the UI shows is keyed on this, never on
--  ran_at.
--
--  Purely additive. Safe to re-run.
--
--  Supabase → SQL Editor → New query → Run.
-- ===================================================================

-- -------------------------------------------------------------------
--  The definitions
-- -------------------------------------------------------------------
create table if not exists public.screens (
  slug        text primary key,
  name        text not null,
  description text,
  -- The scan itself. Deliberately absent from this migration: run it,
  -- then insert your clauses separately so they never enter a public
  -- repository or a file anybody can read.
  clause      text,
  -- eod | intraday. Decides when the scheduler runs it and how the
  -- screen describes its own freshness.
  cadence     text not null default 'eod' check (cadence in ('eod', 'intraday')),
  -- Off by default. A screen with no clause yet must not be scheduled,
  -- and a screen being reworked should stop running without being
  -- deleted along with its history.
  active      boolean not null default false,
  sort        smallint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.screens is
  'Screen definitions, shared by every user. The clause column holds the '
  'scan itself and is deliberately not in the repository, which is public — '
  'insert it by hand. Written only by the service role.';

-- -------------------------------------------------------------------
--  One row per attempt, successful or not
-- -------------------------------------------------------------------
create table if not exists public.screen_runs (
  id        uuid primary key default gen_random_uuid(),
  slug      text not null references public.screens (slug) on delete cascade,

  -- The trading session these results describe. See the note above:
  -- never the wall clock the job happened to fire on.
  as_of     date not null,
  ran_at    timestamptz not null default now(),

  status    text not null check (status in ('ok', 'empty', 'skipped', 'failed')),
  -- Denormalised so a list of runs needs no join, and so a run that
  -- found nothing still says so with a number rather than an absence.
  count     integer not null default 0,
  ms        integer,
  -- Why it failed, in words, for the screen to show and for you to
  -- read six weeks later. Null on a run that worked.
  error     text,

  created_at timestamptz not null default now()
);

comment on column public.screen_runs.status is
  'ok = ran and found results. empty = ran and nothing matched, which is a '
  'finding. skipped = not a trading day. failed = the source did not answer. '
  'An empty screen_results table cannot distinguish these, and all four would '
  'otherwise render as "nothing passed today".';

create index if not exists screen_runs_latest_idx
  on public.screen_runs (slug, as_of desc, ran_at desc);

-- -------------------------------------------------------------------
--  What it found
-- -------------------------------------------------------------------
create table if not exists public.screen_results (
  run_id   uuid not null references public.screen_runs (id) on delete cascade,
  symbol   text not null,
  exchange text not null default 'NSE' check (exchange in ('NSE','BSE')),

  -- What the scan reported alongside the symbol. Kept because it is
  -- what the source measured at the moment it matched, and
  -- recomputing it later from bars would answer a different question.
  close    numeric,
  volume   numeric,
  chg_pct  numeric,
  -- Anything else the scan returns, unparsed. A screen that starts
  -- reporting a new column should not need a migration to keep it.
  extra    jsonb,

  rank     smallint,
  primary key (run_id, symbol, exchange)
);

comment on table public.screen_results is
  'Symbols matched by one run. Deleted with its run: results without the run '
  'that produced them have no as_of and no status, so they cannot be read.';

create index if not exists screen_results_symbol_idx
  on public.screen_results (symbol, exchange);

-- -------------------------------------------------------------------
--  Row level security — read for anyone signed in, writes to nobody
-- -------------------------------------------------------------------
--  Same shape as price_bars: a select policy and no others, so RLS
--  denies every write and the service role bypasses it. The scheduled
--  job is the only writer.
--
--  NOT gated on plan here. Entitlement is a product decision that
--  belongs where the screen is served, not in a policy — and putting
--  it here would mean a lapsed subscriber's own saved watchlist
--  silently stopped loading, which non-negotiable #7 forbids.
-- -------------------------------------------------------------------
alter table public.screens        enable row level security;
alter table public.screen_runs    enable row level security;
alter table public.screen_results enable row level security;

drop policy if exists "screens readable" on public.screens;
create policy "screens readable"
  on public.screens for select to authenticated using (true);

drop policy if exists "screen_runs readable" on public.screen_runs;
create policy "screen_runs readable"
  on public.screen_runs for select to authenticated using (true);

drop policy if exists "screen_results readable" on public.screen_results;
create policy "screen_results readable"
  on public.screen_results for select to authenticated using (true);

-- -------------------------------------------------------------------
--  The three screens, without their clauses
-- -------------------------------------------------------------------
--  Inactive on purpose. Add the clause and flip active to true when
--  the scan has been proved by hand — see the insert below the check.
-- -------------------------------------------------------------------
insert into public.screens (slug, name, description, cadence, sort)
values
  ('volume-dryup',  'Volume dry-up',  'Quiet volume after a move — the pause before continuation.', 'eod', 10),
  ('contraction',   'Contraction',    'Range tightening into a base.',                              'eod', 20),
  ('bullsnort',     'Bullsnort',      'Intraday strength, refreshed through the session.',          'intraday', 30)
on conflict (slug) do nothing;

-- -------------------------------------------------------------------
--  Check
-- -------------------------------------------------------------------
select s.slug, s.cadence, s.active,
       (s.clause is not null) as has_clause,
       count(r.id)            as runs
  from public.screens s
  left join public.screen_runs r on r.slug = s.slug
 group by s.slug, s.cadence, s.active, s.clause
 order by s.sort;
