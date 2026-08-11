-- ===================================================================
--  026 — the three launch questions
--
--  NOT A MIGRATION. Nothing here creates or changes anything; it is the
--  set of read-only queries that turn 016's user_events into the three
--  numbers the free launch exists to produce. The app has been
--  collecting the events for a while and nothing has ever read them
--  back, which is the same as not collecting them.
--
--  Run any section on its own in the SQL editor. It runs as the service
--  role, so it sees every user's rows rather than your own.
--
--  A NOTE ON QUESTION ONE. "How many showed interest" mostly means
--  people who never signed up, and they have no user_id, so nothing
--  below can see them. That number lives in the page analytics script
--  (NEXT_PUBLIC_ANALYTICS_*). What follows starts at the point somebody
--  made an account.
-- ===================================================================


-- -------------------------------------------------------------------
--  1. Signups, and how far each one actually got
--
--  A signup that never logged a trade is not a user, it is a visitor
--  who filled in a form — and counting them together is the easiest way
--  to believe a launch went better than it did. `trades` is what tells
--  the two apart.
-- -------------------------------------------------------------------
select
  date_trunc('week', u.created_at)::date         as signup_week,
  count(*)                                       as signups,
  count(*) filter (where p.onboarded_at is not null) as onboarded,
  count(*) filter (where t.trades > 0)           as logged_a_trade,
  count(*) filter (where t.trades >= 5)          as logged_five
from auth.users u
left join public.profiles p on p.id = u.id
left join lateral (
  select count(*) as trades from public.trades where user_id = u.id
) t on true
group by 1
order by 1 desc;


-- -------------------------------------------------------------------
--  2. Is anyone using it regularly
--
--  Active days per user per week, off the 'opened' event — which fires
--  once per browser session, not per page load, so this counts visits
--  rather than clicks. Someone at 3+ days a week is using this the way
--  a journal is meant to be used; someone at 1 is remembering it exists.
-- -------------------------------------------------------------------
select
  date_trunc('week', created_at)::date                    as week,
  count(distinct user_id)                                 as people,
  count(distinct (user_id, created_at::date))             as user_days,
  round(
    count(distinct (user_id, created_at::date))::numeric
      / nullif(count(distinct user_id), 0), 1)            as avg_days_each
from public.user_events
where event = 'opened'
group by 1
order by 1 desc;


-- -------------------------------------------------------------------
--  3. THE ONE THAT DECIDES IT — are they still here after 30 days
--
--  By signup cohort, because a blended retention number across a
--  growing user base drifts with the growth rate and not with the
--  product. `still_active_d30` counts people who did anything at all on
--  or after their thirtieth day, so it is not distorted by somebody who
--  used it hard for a fortnight and left.
--
--  Cohorts younger than 30 days show as null rather than 0: they have
--  not had the chance yet, and reading them as zero is the fastest way
--  to conclude a launch failed while it is still running.
-- -------------------------------------------------------------------
with cohorts as (
  select
    u.id,
    date_trunc('week', u.created_at)::date as cohort_week,
    u.created_at
  from auth.users u
),
activity as (
  select
    c.id,
    c.cohort_week,
    c.created_at,
    max(e.created_at) as last_seen
  from cohorts c
  left join public.user_events e on e.user_id = c.id
  group by 1, 2, 3
)
select
  cohort_week,
  count(*) as signed_up,
  case
    when now() < min(created_at) + interval '30 days' then null
    else count(*) filter (where last_seen >= created_at + interval '30 days')
  end as still_active_d30,
  case
    when now() < min(created_at) + interval '30 days' then null
    else round(
      100.0 * count(*) filter (where last_seen >= created_at + interval '30 days')
        / nullif(count(*), 0), 1)
  end as d30_pct
from activity
group by 1
order by 1 desc;


-- -------------------------------------------------------------------
--  4. What they actually do once they are in
--
--  Not one of the three questions, but the one that explains the
--  answers. If 'imported' barely appears, the importer is the thing
--  keeping people out; if 'review_opened' never does, the analysis
--  nobody asked for is not the reason they stay.
-- -------------------------------------------------------------------
select
  event,
  count(*)                as times,
  count(distinct user_id) as people
from public.user_events
group by 1
order by people desc, times desc;


-- -------------------------------------------------------------------
--  5. Is it breaking in front of anyone (needs 025)
-- -------------------------------------------------------------------
select
  message,
  path,
  count(*)                as times,
  count(distinct user_id) as people,
  max(created_at)         as last_seen
from public.client_errors
group by 1, 2
order by people desc, times desc
limit 50;
