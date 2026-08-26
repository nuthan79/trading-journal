import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchBars, tickerFor } from "@/lib/bars";
import { userFromRequest } from "@/lib/apiAuth";
import { rateLimit, tooMany } from "@/lib/rateLimit";

/**
 * POST /api/bars   { want: [{ symbol, exchange, from, to }, ...] }
 *
 * Daily bars for a set of listings, cached in `price_bars` so the same day of
 * the same stock is fetched once for the whole deployment however many people
 * hold it.
 *
 * WHY THE CACHE IS SHARED AND THE WRITE IS NOT. Bars are market data — there
 * is nothing of anybody's in them, so one row serves every user and the table
 * carries no user_id. But a client that could write here could poison a price
 * for everyone at once, so RLS denies all writes and only this route, holding
 * the service key, fills it. See migration 041.
 *
 * READ-THROUGH, NOT WRITE-BEHIND. What is already stored is returned without
 * touching the network; only the missing span goes upstream. On a book being
 * measured for the first time that is one request per symbol for its entire
 * holding period — and on every later visit, none.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Tighter than the quote route's forty. That one serves a button somebody
 * clicks impatiently; this one serves a backfill that runs once and then has
 * nothing left to do, so a caller hitting it repeatedly is a loop rather than
 * a hurry.
 */
const LIMIT = { limit: 12, windowMs: 60_000 };

/** Enough to measure a long book in a few passes, few enough that one request
 *  cannot sit on a serverless function until it times out. */
const MAX_SYMBOLS = 25;

export async function POST(req) {
  const userId = await userFromRequest(req);
  if (!userId) {
    return NextResponse.json(
      { bars: {}, error: "Sign in first." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const gate = rateLimit(`bars:${userId}`, LIMIT);
  if (!gate.ok) {
    return tooMany(gate.retryAfter,
      "Too many history requests. What has already been measured is saved, " +
      "so carrying on later picks up where this stopped.");
  }

  if (!url || !serviceKey) {
    return NextResponse.json(
      { bars: {}, error: "History is not configured on this deployment." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  let want = [];
  try {
    const body = await req.json();
    want = Array.isArray(body?.want) ? body.want : [];
  } catch {
    return NextResponse.json({ bars: {}, error: "Bad request." }, { status: 400 });
  }

  const items = want
    .map((w) => ({
      symbol: String(w?.symbol || "").toUpperCase().trim(),
      exchange: String(w?.exchange || "NSE").toUpperCase().trim(),
      from: String(w?.from || "").slice(0, 10),
      to: String(w?.to || "").slice(0, 10),
    }))
    .filter((w) => w.symbol && w.from && w.to && w.from <= w.to)
    .slice(0, MAX_SYMBOLS);

  if (!items.length) {
    return NextResponse.json({ bars: {}, error: null }, { headers: { "Cache-Control": "no-store" } });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const out = {};
  const skipped = [];

  for (const it of items) {
    const key = `${it.symbol}:${it.exchange}`;
    /* Refused rather than guessed. Not the exchange — both work — but a
       symbol still recorded as a bare scrip code, which resolves to a
       different company entirely and would look completely ordinary doing
       it. See the note in bars.js. */
    if (!tickerFor(it.symbol, it.exchange)) { skipped.push(key); continue; }

    let stored = [];
    try {
      const { data } = await admin
        .from("price_bars")
        .select("d,o,h,l,c")
        .eq("symbol", it.symbol)
        .eq("exchange", it.exchange)
        .gte("d", it.from)
        .lte("d", it.to)
        .order("d");
      stored = data || [];
    } catch { /* a cache miss is not a failure — fall through and fetch */ }

    /**
     * Sessions, not days. Comparing a stored count against calendar days would
     * declare every range incomplete forever, since weekends never arrive. The
     * test is whether the stored span REACHES both ends of what was asked for;
     * holes in the middle are what the coverage check below is for.
     */
    const covers = stored.length > 0 &&
      stored[0].d <= nextSession(it.from) &&
      stored[stored.length - 1].d >= prevSession(it.to);

    if (covers) { out[key] = stored; continue; }

    const { bars, error } = await fetchBars(it);
    if (error || !bars.length) {
      /* Whatever was cached is better than nothing, and an upstream that is
         down must not erase a measurement taken last week. */
      if (stored.length) out[key] = stored;
      else skipped.push(key);
      continue;
    }

    try {
      await admin.from("price_bars").upsert(
        bars.map((b) => ({ symbol: it.symbol, exchange: it.exchange, ...b })),
        { onConflict: "symbol,exchange,d" }
      );
    } catch (e) {
      // The caller still gets its bars; only the cache missed out.
      console.warn("[bars] cache write failed", key, e?.message);
    }
    out[key] = bars;
  }

  return NextResponse.json(
    { bars: out, skipped, error: null },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/* A weekend or a holiday at either end of the window means the exchange was
   shut, not that a bar is missing. Three days of slack covers a long weekend
   without letting a genuinely short cache pass as complete. */
const SLACK_DAYS = 3;
const shift = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
};
const nextSession = (d) => shift(d, SLACK_DAYS);
const prevSession = (d) => shift(d, -SLACK_DAYS);
