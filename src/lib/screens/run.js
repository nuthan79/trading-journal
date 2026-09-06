/**
 * What a screen run IS, decided before anything is fetched or stored.
 *
 * The scan source and the database are both seams; this file is neither. It
 * answers the questions that decide whether the screen tells the truth:
 *
 *   which trading session do these results describe,
 *   should this run happen at all,
 *   and what does it mean when nothing comes back.
 *
 * THE DISTINCTION THE WHOLE FEATURE RESTS ON. "Nothing passed the scan today"
 * is a finding a trader can act on — the market is offering nothing, sit out.
 * "The scan has not run yet" and "the scan failed" are not findings at all,
 * and all three arrive as an empty list. Conflated, the screen tells somebody
 * the market is quiet on a day it never looked.
 *
 * So a run always records a status, even when it stores no rows.
 */

/** India trades 09:15–15:30 IST. Everything here is computed in IST. */
export const IST_OFFSET_MIN = 330;
export const MARKET_OPEN_MIN = 9 * 60 + 15;
export const MARKET_CLOSE_MIN = 15 * 60 + 30;

/**
 * The IST wall clock for an instant, as plain parts.
 *
 * Built by shifting the epoch rather than by formatting, because
 * `toLocaleString("en-IN")` depends on the ICU data present in whatever
 * runtime this ends up on — and a scheduled job runs on a server whose zone
 * is nobody's choice. The one thing that must never vary is which day a run
 * belongs to.
 */
export function istParts(at = new Date()) {
  const shifted = new Date(at.getTime() + IST_OFFSET_MIN * 60000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    dow: shifted.getUTCDay(),               // 0 Sun … 6 Sat
  };
}

export const istDate = (at = new Date()) => {
  const { y, m, d } = istParts(at);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/**
 * Which session a run describes.
 *
 * The trading day in IST, always — not the server's date, and not the date
 * the cron fired in UTC. An end-of-day job at 16:15 IST is 10:45 UTC on the
 * same date, but the same job pushed an hour later on a day when the clocks
 * move elsewhere must still file under the session it followed.
 *
 * Before the open, a run belongs to no session yet: there is nothing to
 * report about a day that has not started, and dating it today would
 * overwrite yesterday's results with an empty set at 06:00.
 */
export function sessionFor(at = new Date(), { holidays = [] } = {}) {
  const p = istParts(at);
  const day = istDate(at);
  const weekend = p.dow === 0 || p.dow === 6;
  const holiday = holidays.includes(day);

  if (weekend) return { as_of: day, tradable: false, reason: "weekend" };
  if (holiday) return { as_of: day, tradable: false, reason: "holiday" };
  if (p.minutes < MARKET_OPEN_MIN) {
    return { as_of: day, tradable: false, reason: "before the open" };
  }
  return {
    as_of: day,
    tradable: true,
    open: p.minutes >= MARKET_OPEN_MIN && p.minutes <= MARKET_CLOSE_MIN,
    minutes: p.minutes,
  };
}

/**
 * Should this screen run now?
 *
 * An end-of-day scan run at noon would store a half-formed session as the
 * day's result and then be overwritten at 16:15 — but anybody who looked in
 * between would have read a partial day as final. So the eod cadence refuses
 * until the close, and says why.
 *
 * `force` exists for running one by hand while proving it out, and is the
 * only way past these. It is recorded on the run so a result gathered at an
 * odd hour is never mistaken later for a scheduled one.
 */
export function shouldRun(screen, at = new Date(), { holidays = [], force = false } = {}) {
  const session = sessionFor(at, { holidays });

  if (!screen?.clause) {
    return { run: false, status: "skipped", reason: "no clause set for this screen", session };
  }
  if (!screen.active && !force) {
    return { run: false, status: "skipped", reason: "screen is not active", session };
  }
  if (!session.tradable && !force) {
    return { run: false, status: "skipped", reason: session.reason, session };
  }
  if (force) return { run: true, forced: true, session };

  if (screen.cadence === "eod" && session.minutes < MARKET_CLOSE_MIN) {
    return {
      run: false, status: "skipped",
      reason: "the session has not closed yet", session,
    };
  }
  if (screen.cadence === "intraday" && !session.open) {
    return { run: false, status: "skipped", reason: "outside market hours", session };
  }
  return { run: true, session };
}

/**
 * A scan's answer, turned into a run.
 *
 * Takes what a source returned and produces exactly what goes in the two
 * tables. No fetching, no writing — so every branch here is testable, which
 * matters because the branches are the meaning.
 *
 * `rows` is whatever the source parsed out: `{ symbol, exchange?, close?,
 * volume?, chgPct?, ...rest }`. Anything it does not recognise is kept in
 * `extra` rather than dropped, so a scan that starts reporting a new column
 * does not need a migration to stop losing it.
 */
export function buildRun({ slug, as_of, rows, ms, error, forced = false }) {
  if (error) {
    return {
      run: { slug, as_of, status: "failed", count: 0, ms: ms ?? null,
             error: String(error).slice(0, 500) },
      results: [],
    };
  }

  const seen = new Set();
  const results = [];
  for (const r of rows || []) {
    const symbol = String(r?.symbol ?? "").trim().toUpperCase();
    if (!symbol) continue;
    const exchange = String(r?.exchange ?? "NSE").trim().toUpperCase() === "BSE" ? "BSE" : "NSE";
    /* A scan reporting the same listing twice is the source's business, not
       ours — but the table's key would reject the second and take the whole
       insert down with it. First occurrence wins, in the order given. */
    const key = `${symbol}|${exchange}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { symbol: _s, exchange: _e, close, volume, chgPct, ...rest } = r;
    results.push({
      symbol, exchange,
      close: num(close), volume: num(volume), chg_pct: num(chgPct),
      extra: Object.keys(rest).length ? rest : null,
      rank: results.length + 1,
    });
  }

  return {
    run: {
      slug, as_of,
      /* Zero matches is a RESULT, not an absence — and it is stored as its
         own status so the screen can say "nothing passed" in those words
         rather than showing the blank it would show for a run that never
         happened. */
      status: results.length ? "ok" : "empty",
      count: results.length,
      ms: ms ?? null,
      error: null,
      forced,
    },
    results,
  };
}

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[₹,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * How a screen describes its own freshness.
 *
 * Intraday results carry a clock because a fifteen-minute-old list presented
 * as live is worse than no list; an end-of-day scan carries only its session,
 * because the time it ran is not information.
 */
export function describeRun(run, { cadence = "eod", now = new Date() } = {}) {
  if (!run) return { tone: "none", text: "This screen has not run yet." };

  if (run.status === "failed") {
    return { tone: "failed", text: `The ${run.as_of} scan did not complete.`, detail: run.error };
  }
  if (run.status === "skipped") {
    return { tone: "skipped", text: `No scan on ${run.as_of} — ${run.error || "not a trading day"}.` };
  }
  if (run.status === "empty") {
    return { tone: "empty", text: `Nothing passed on ${run.as_of}.` };
  }

  if (cadence === "intraday") {
    const mins = Math.max(0, Math.round((now - new Date(run.ran_at)) / 60000));
    return {
      tone: "ok",
      text: `${run.count} match${run.count === 1 ? "" : "es"}`,
      detail: mins < 1 ? "just now" : `as of ${mins} min ago`,
    };
  }
  return {
    tone: "ok",
    text: `${run.count} match${run.count === 1 ? "" : "es"}`,
    detail: `close of ${run.as_of}`,
  };
}
