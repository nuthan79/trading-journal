/**
 * A ceiling on how often one caller can hit a route.
 *
 * WHAT THIS ACTUALLY PROTECTS. `apiAuth.js` closed the quote routes to
 * strangers, which stopped an outsider spending the deployment's Yahoo quota.
 * It did nothing about a signed-in user doing the same — a refresh loop, a
 * stuck retry, or somebody curious with a token — and the damage is shared:
 * Yahoo rate-limits by IP, so one caller getting this deployment throttled
 * leaves everybody else with no marks. `/api/contact` is the other shape of
 * the problem, being open by necessity and ending in somebody's inbox.
 *
 * IN MEMORY, AND HONEST ABOUT WHAT THAT MEANS. Serverless instances are
 * short-lived and there can be several, so this is a limit per instance rather
 * than a global one. It stops the thing that actually happens — a client in a
 * tight loop, which lands on one warm instance and is cut off — and would not
 * stop a determined attacker spreading requests across instances. At this
 * app's traffic there is usually one warm instance, so the two coincide; that
 * stops being true if it grows.
 *
 * The alternative is a counter in Postgres, correct across instances at the
 * cost of a round trip on every quote. Worth doing when the traffic justifies
 * it, and over-built before then — the same reasoning as the cache in
 * quotes.js, which is a courtesy to the upstream rather than a real cache.
 *
 * NOT A SECURITY BOUNDARY. RLS is what stops one user reading another's rows.
 * This is about cost and fairness, and is allowed to be approximate.
 */

/** key → array of hit timestamps, oldest first. */
const hits = new Map();

/**
 * Stops the map growing without bound on a long-lived instance.
 *
 * Swept on write rather than on a timer: a serverless instance can be frozen
 * between requests, so an interval may never fire, and one that did would keep
 * the instance alive for no reason.
 */
const SWEEP_EVERY = 500;
let writes = 0;

function sweep(now) {
  for (const [k, list] of hits) {
    // The longest window any caller uses. Anything older cannot matter to any
    // of them, so a single cutoff is enough and avoids storing per-key windows.
    if (!list.length || now - list[list.length - 1] > 60 * 60 * 1000) hits.delete(k);
  }
}

/**
 * Record a hit and say whether it is allowed.
 *
 * A sliding window rather than a fixed one, because a fixed window lets twice
 * the limit through across a boundary — sixty at 11:59:59 and sixty more at
 * 12:00:00 — which is exactly the burst that gets an IP throttled upstream.
 *
 * Returns `{ ok, remaining, retryAfter }`, retryAfter in whole seconds, for
 * the header of the same name.
 */
export function rateLimit(key, { limit, windowMs }) {
  const now = Date.now();

  if (++writes % SWEEP_EVERY === 0) sweep(now);

  const list = hits.get(key) || [];
  // Drop everything that has fallen out of the window.
  const live = list.filter((t) => now - t < windowMs);

  if (live.length >= limit) {
    hits.set(key, live);
    const oldest = live[0];
    return {
      ok: false,
      remaining: 0,
      // When the oldest hit leaves the window, one slot frees up. Rounded up,
      // and floored at one, so a client told to wait never retries instantly.
      retryAfter: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }

  live.push(now);
  hits.set(key, live);
  return { ok: true, remaining: limit - live.length, retryAfter: 0 };
}

/**
 * The caller's address, for routes with no signed-in user to key on.
 *
 * `x-forwarded-for` is a list when proxies chain; the FIRST entry is the
 * client and the rest are the proxies it passed through. Taking the last would
 * key every visitor to the same edge node and rate-limit the whole internet
 * together the moment one person was busy.
 *
 * Spoofable in general, which matters less than it sounds here: this is a cost
 * control, not an authentication check, and the route it guards ends in an
 * inbox rather than in the database.
 */
export function callerIp(req) {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const first = fwd.split(",")[0].trim();
  return first || req.headers.get("x-real-ip") || "unknown";
}

/**
 * The 429, with the header that tells a client when to come back.
 *
 * `Retry-After` is worth setting rather than leaving a bare status: a
 * well-behaved client obeys it, and the badly-behaved one this exists for
 * would otherwise retry immediately and stay blocked forever — which looks to
 * its user like the app is broken rather than like they are going too fast.
 */
export function tooMany(retryAfter, message) {
  return new Response(
    JSON.stringify({ error: message || "Too many requests — try again shortly." }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "Retry-After": String(retryAfter),
        "Cache-Control": "no-store",
      },
    }
  );
}
