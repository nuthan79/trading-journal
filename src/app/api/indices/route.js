import { NextResponse } from "next/server";
import { fetchIndexHistory, indexSnapshot, INDEX_TICKERS, STRIP_INDICES } from "@/lib/market";
import { userFromRequest } from "@/lib/apiAuth";
import { rateLimit, tooMany } from "@/lib/rateLimit";

/**
 * GET /api/indices?book=IN
 *
 * The market strip under the header: each of the book's indices, its level,
 * the day's change and its distance from the 20/50/200-day averages. One call
 * for all of them, so the strip costs one request a refresh, and cached at the
 * edge for five minutes — every visitor in that window shares one set of
 * upstream fetches, four calls to Yahoo however many people are reading.
 *
 * An index that fails comes back as null rather than failing the strip: three
 * readings and a dash beat no strip at all.
 */

export const runtime = "nodejs";
const LIMIT = { limit: 30, windowMs: 60_000 };

export async function GET(req) {
  const userId = await userFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const gate = rateLimit(`indices:${userId}`, LIMIT);
  if (!gate.ok) return tooMany(gate.retryAfter, "Too many requests for index data.");

  const book = (req.nextUrl.searchParams.get("book") || "IN").toUpperCase();
  const list = STRIP_INDICES[book] || STRIP_INDICES.IN;

  const items = await Promise.all(list.map(async ([key, name]) => {
    try {
      const snap = indexSnapshot(await fetchIndexHistory(INDEX_TICKERS[key], "1y"));
      return snap ? { key, name, ...snap } : { key, name, error: "no data" };
    } catch (err) {
      return { key, name, error: err.message };
    }
  }));

  return NextResponse.json(
    { book, at: new Date().toISOString(), items },
    { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" } },
  );
}
