-- ===================================================================
--  The three questions the free launch exists to answer
--
--  Reads only. Run any of these any time, in Supabase → SQL Editor.
--  They run as postgres, which sees every user's rows; the app itself
--  can only ever read its own.
--
--  BEFORE YOU READ ANY OF IT, fix the definition of "active", because
--  it is easy to move afterwards to suit the answer. Used here:
--
--      active in a week  =  at least one event that week
--
--  and the week is Monday-based. A swing-trading journal is not a daily
--  habit — nobody logs a swing trade every day — so daily active would
--  measure the wrong thing and flatter nobody. Weekly is the honest
--  grain for this app.
-- ===================================================================


-- -------------------------------------------------------------------
--  QUESTION 1 — how many showed interest
--
--  Signups per week, and how many of them got as far as finishing
--  setup. Visitors who never signed up are not in here at all: they
--  have no user id, and the page analytics script counts those.
--
--  READ: `signed_up` against `onboarded`. A wide gap means people are
--  arriving and giving up during setup, which is a first-run problem,
--  not an interest problem.
-- -------------------------------------------------------------------
select
  date_trunc('week', u.created_at)::date        as week,
  count(*)                                      as signed_up,
  count(*) filter (
    where exists (select 1 from public.user_events e
                   where e.user_id = u.id and e.event = 'onboarded')
  )                                             as onboarded,
  count(*) filter (
    where exists (select 1 from public.user_events e
                   where e.user_id = u.id and e.event = 'imported')
  )                                             as imported_something
from auth.users u
group by 1
order by 1 desc;


-- -------------------------------------------------------------------
--  QUESTION 2 — how many use it regularly
--
--  Weekly active users, and what they did. `active` counts anyone with
--  any event; the rest say whether they were recording, or reading.
--
--  READ: `reviewed` against `active`. Recording trades is bookkeeping
--  and any journal gets that. Coming back to read the review is the
--  thing this app is for, and the number most likely to predict
--  whether someone is still here in a month.
-- -------------------------------------------------------------------
select
  date_trunc('week', created_at)::date                     as week,
  count(distinct user_id)                                  as active,
  count(distinct user_id) filter (where event in ('trade_logged','trade_saved'))
                                                           as logged_a_trade,
  count(distinct user_id) filter (where event = 'diary_written')
                                                           as wrote_diary,
  count(distinct user_id) filter (where event = 'review_opened')
                                                           as reviewed,
  count(*)                                                 as events
from public.user_events
group by 1
order by 1 desc;


-- -------------------------------------------------------------------
--  QUESTION 3 — how many are still here after thirty days
--
--  One row per signup week. `retained_d30` counts people who did
--  something between their 8th and 30th day, which deliberately
--  excludes the first week: everyone is active in week one, and
--  counting it would turn a retention number into a signup number.
--
--  READ: only rows where `cohort` has had thirty days to run. A week
--  that started nine days ago cannot have a D30 figure and the one
--  shown for it means nothing — the `days_elapsed` column is there to
--  stop that being read by accident.
-- -------------------------------------------------------------------
with cohorts as (
  select u.id as user_id, date_trunc('week', u.created_at)::date as cohort,
         u.created_at as joined
    from auth.users u
),
activity as (
  select c.user_id, c.cohort, c.joined,
         max(e.created_at) as last_seen,
         count(distinct date_trunc('day', e.created_at))
           filter (where e.created_at >  c.joined + interval '7 days'
                     and e.created_at <= c.joined + interval '30 days')
           as active_days_8_to_30
    from cohorts c
    left join public.user_events e on e.user_id = c.user_id
   group by 1, 2, 3
)
select
  cohort,
  count(*)                                                   as signed_up,
  count(*) filter (where active_days_8_to_30 > 0)            as retained_d30,
  round(100.0 * count(*) filter (where active_days_8_to_30 > 0)
        / nullif(count(*), 0), 1)                            as retained_pct,
  round(avg(active_days_8_to_30) filter (where active_days_8_to_30 > 0), 1)
                                                             as avg_active_days_when_retained,
  min(extract(day from now() - cohort))::int                 as days_elapsed
from activity
group by 1
order by 1 desc;


-- -------------------------------------------------------------------
--  Where people stop
--
--  Not one of the three questions, but the one that tells you what to
--  fix. Each step is a strictly smaller group than the one above it.
-- -------------------------------------------------------------------
select 'signed up'            as step, count(*) as people from auth.users
union all
select 'finished setup',  count(distinct user_id) from public.user_events where event = 'onboarded'
union all
select 'imported a file', count(distinct user_id) from public.user_events where event = 'imported'
union all
select 'logged a trade',  count(distinct user_id) from public.user_events where event in ('trade_logged','trade_saved')
union all
select 'opened review',   count(distinct user_id) from public.user_events where event = 'review_opened'
union all
select 'came back a 2nd day', count(*) from (
  select user_id from public.user_events
   group by user_id having count(distinct date_trunc('day', created_at)) > 1
) z;
