/**
 * The admin report — every figure worked out here, from plain rows.
 *
 * SEPARATE FROM THE FETCHING ON PURPOSE. Everything in this file is a pure
 * function of rows and a clock, so the probes can hand it a fixed book and a
 * fixed instant and check the arithmetic. The server does the talking to
 * Supabase and nothing else.
 *
 * NOTHING HERE IS PART OF THE APP. It is never imported from src/, never
 * built, never deployed — a probe pins that. It reads with the service role
 * key, which bypasses every row-level policy, and the only copy of that key
 * lives in .env.local on this machine.
 *
 * DAYS ARE IST DAYS. "How many signed in today" asked at 1am means the day
 * that just started in the user's own calendar, not UTC's.
 */

const IST_OFFSET_MIN = 330;

/**
 * "Active right now" — anything at all in this many minutes.
 *
 * There is no heartbeat in the app and there should not be one: `opened`
 * fires once per browser session, and a ping every minute would turn a table
 * of real actions into a table of pings. So this is the honest reading —
 * somebody who DID something recently — and the page says so in those words
 * rather than claiming to know who is looking at a screen.
 */
export const LIVE_MINUTES = 30;

/** The IST calendar day of an instant, as YYYY-MM-DD. */
export function istDay(when) {
  const t = when instanceof Date ? when : new Date(when);
  if (!Number.isFinite(t.getTime())) return null;
  const shifted = new Date(t.getTime() + IST_OFFSET_MIN * 60000);
  return shifted.toISOString().slice(0, 10);
}

/** N IST days back from `now`, as a day string. */
export function istDayBack(now, n) {
  const t = new Date(now).getTime() + IST_OFFSET_MIN * 60000 - n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

const countBy = (rows, when, day) => rows.filter((r) => istDay(r[when]) === day).length;
const since = (rows, when, from) => rows.filter((r) => istDay(r[when]) >= from);

/**
 * One column of the day board: what happened on a given IST day.
 *
 * "Signed in" counts PEOPLE, not visits — the `opened` event fires once per
 * browser session, so counting rows would make one person with three tabs
 * look like three users.
 */
function daySlice(day, { users, events, trades, diary }) {
  const opened = new Set(events.filter((e) => e.event === "opened" && istDay(e.created_at) === day)
    .map((e) => e.user_id));
  return {
    day,
    signups: countBy(users, "created_at", day),
    activeUsers: opened.size,
    trades: countBy(trades, "created_at", day),
    diary: countBy(diary, "created_at", day),
    imports: events.filter((e) => e.event === "imported" && istDay(e.created_at) === day).length,
  };
}

/**
 * Everyone, with what they have done — the list the whole thing is for.
 *
 * ACTIVE DAYS, NOT VISITS. Somebody who opens the app on twenty separate days
 * is the person worth writing to; somebody who opened it forty times in one
 * afternoon and never came back is not, and visit counts cannot tell them
 * apart.
 */
/**
 * Your own accounts, out of the figures.
 *
 * Five test logins against twenty real ones moves every number that matters —
 * retention, the day board, who counts as loyal — and they move it in the
 * flattering direction, which is the worst kind of wrong. Matched on email,
 * case-insensitively, and the list lives in .env.local rather than here: this
 * repo is public and those addresses are yours.
 */
export function excluding(data, emails = []) {
  const drop = new Set(emails.map((e) => String(e).trim().toLowerCase()).filter(Boolean));
  if (!drop.size) return { data, excluded: 0 };
  const users = data.users.filter((u) => !drop.has(String(u.email || "").toLowerCase()));
  const keep = new Set(users.map((u) => u.id));
  const mine = (rows) => (rows || []).filter((r) => keep.has(r.user_id));
  return {
    data: {
      users,
      profiles: (data.profiles || []).filter((p) => keep.has(p.id)),
      events: mine(data.events),
      trades: mine(data.trades),
      diary: mine(data.diary),
    },
    excluded: data.users.length - users.length,
  };
}

export function people(data, now = Date.now()) {
  const { users, profiles = [], events, trades, diary, access = [] } = data;
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const from30 = istDayBack(now, 29);

  return users.map((u) => {
    const mine = events.filter((e) => e.user_id === u.id);
    const opens = mine.filter((e) => e.event === "opened");
    const days = new Set(opens.map((e) => istDay(e.created_at)));
    const days30 = new Set([...days].filter((d) => d >= from30));
    const myTrades = trades.filter((t) => t.user_id === u.id);
    const p = byId.get(u.id) || {};

    /* Last seen is the latest thing they did, whatever it was: an event, or a
       sign-in Supabase recorded without the app firing anything. */
    const stamps = [u.last_sign_in_at, ...mine.map((e) => e.created_at)]
      .filter(Boolean).map((s) => new Date(s).getTime()).filter(Number.isFinite);
    const lastSeen = stamps.length ? new Date(Math.max(...stamps)).toISOString() : null;

    return {
      id: u.id,
      email: u.email || "—",
      name: p.journal_name || "—",
      signedUp: u.created_at,
      onboarded: !!p.onboarded_at,
      lastSeen,
      /* Clamped at zero: a clock a few minutes ahead of this one would
         otherwise report somebody as last seen −1 days ago. */
      daysSinceSeen: lastSeen
        ? Math.max(0, Math.floor((now - new Date(lastSeen).getTime()) / 86400000)) : null,
      activeDays: days.size,
      activeDays30: days30.size,
      trades: myTrades.length,
      diary: diary.filter((d) => d.user_id === u.id).length,
      imports: mine.filter((e) => e.event === "imported").length,
      /* Which paid markets are open to them, and until when. India is free
         and never appears here — a row is a market that was sold. */
      markets: access.filter((a) => a.user_id === u.id)
        .filter((a) => !a.expires_at || new Date(a.expires_at).getTime() > now)
        .map((a) => `${a.region}${a.expires_at ? ` to ${String(a.expires_at).slice(0, 10)}` : ""}`),
      lapsed: access.filter((a) => a.user_id === u.id)
        .filter((a) => a.expires_at && new Date(a.expires_at).getTime() <= now)
        .map((a) => a.region),
      optedOut: !!p.analytics_opt_out,
    };
  }).sort((a, b) => b.activeDays30 - a.activeDays30
                 || b.trades - a.trades
                 || String(a.email).localeCompare(String(b.email)));
}

/** Active on at least this many separate days in the last 30 — worth thanking. */
export const LOYAL_DAYS = 5;
/** Nothing at all for this many days, after having started — worth a nudge. */
export const QUIET_DAYS = 14;

export function buildReport(raw, now = Date.now(), { exclude = [] } = {}) {
  const { data, excluded } = excluding(raw, exclude);
  const { users, events, trades, diary } = data;
  const today = istDay(now);
  const list = people(data, now);

  const days = [];
  for (let i = 0; i < 14; i++) days.push(daySlice(istDayBack(now, i), data));

  const from7 = istDayBack(now, 6);
  const from30 = istDayBack(now, 29);
  const activeIn = (from) => new Set(
    events.filter((e) => e.event === "opened" && istDay(e.created_at) >= from).map((e) => e.user_id)
  ).size;

  /* Of the people who signed up 30 or more days ago, how many have opened it
     in the last week. The launch question, asked the only honest way: a
     percentage over a cohort old enough to have answered it. */
  const eligible = users.filter((u) => istDay(u.created_at) <= from30);
  const retained = eligible.filter((u) => list.find((p) => p.id === u.id)?.daysSinceSeen <= 7).length;

  /* Who has done something in the last half hour — the closest thing to
     "who is in there now" that the data can honestly answer. */
    const liveFrom = now - LIVE_MINUTES * 60000;
  const stamped = [
    ...events.map((e) => ({ user_id: e.user_id, at: e.created_at })),
    ...trades.map((t) => ({ user_id: t.user_id, at: t.created_at })),
    ...diary.map((d) => ({ user_id: d.user_id, at: d.created_at })),
  ].filter((x) => new Date(x.at).getTime() >= liveFrom);
  const liveIds = new Set(stamped.map((x) => x.user_id));
  const live = list.filter((p) => liveIds.has(p.id)).map((p) => ({
    ...p,
    minutesAgo: Math.max(0, Math.round(
      (now - Math.max(...stamped.filter((x) => x.user_id === p.id)
        .map((x) => new Date(x.at).getTime()))) / 60000)),
  })).sort((a, b) => a.minutesAgo - b.minutesAgo);

  return {
    generatedAt: new Date(now).toISOString(),
    /* Sold access at a glance: who holds it, and whose has run out. */
    paid: list.filter((p) => p.markets.length),
    lapsedAccess: list.filter((p) => p.lapsed.length && !p.markets.length),
    excluded,
    liveMinutes: LIVE_MINUTES,
    live,
    today: days[0],
    yesterday: days[1],
    days,
    totals: {
      users: users.length,
      onboarded: list.filter((p) => p.onboarded).length,
      withTrades: list.filter((p) => p.trades > 0).length,
      trades: trades.length,
      diary: diary.length,
      active7: activeIn(from7),
      active30: activeIn(from30),
      signups7: since(users, "created_at", from7).length,
      signups30: since(users, "created_at", from30).length,
    },
    retention: {
      cohort: eligible.length,
      retained,
      pct: eligible.length ? (retained / eligible.length) * 100 : NaN,
    },
    loyal: list.filter((p) => p.activeDays30 >= LOYAL_DAYS),
    quiet: list.filter((p) => p.trades > 0 && p.daysSinceSeen != null && p.daysSinceSeen >= QUIET_DAYS),
    neverStarted: list.filter((p) => p.trades === 0),
    people: list,
  };
}
