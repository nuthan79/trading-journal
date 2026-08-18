import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/quotes";
import { userFromRequest } from "@/lib/apiAuth";
import { rateLimit, tooMany } from "@/lib/rateLimit";

/**
 * Generous, because the app itself is the busiest caller.
 *
 * Opening Holdings marks every open position in one request, and Refresh
 * Prices does it again on demand; a person clicking impatiently is normal use
 * and must not be told off for it. This is set to catch a loop, not a hurry.
 */
const LIMIT = { limit: 40, windowMs: 60_000 };

/**
 * GET /api/quotes?s=RELIANCE:NSE,TATAMOTORS:NSE
 *
 * This route exists because the browser cannot call Yahoo directly — CORS
 * blocks it. Running the fetch server-side also keeps any future broker API
 * key out of the client bundle.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req) {
  // Signed-in callers only. Left open, this hands anyone the deployment's
  // Yahoo quota, and an outsider's traffic getting this IP rate-limited is
  // what would leave paying users with no CMP.
  const userId = await userFromRequest(req);
  if (!userId) {
    return NextResponse.json({ quotes: [], error: "Sign in first." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  /**
   * Keyed on the user, not the IP. Two people behind one office NAT are two
   * callers and should not share a budget; the same person on a phone and a
   * laptop is one caller and should.
   *
   * After the auth check, so an unauthenticated flood is refused by the
   * cheaper test and never occupies a slot belonging to a real user.
   */
  const gate = rateLimit(`quotes:${userId}`, LIMIT);
  if (!gate.ok) {
    return tooMany(gate.retryAfter,
      "Too many price refreshes. Prices are cached for a minute anyway, so " +
      "waiting costs you nothing.");
  }

  const raw = req.nextUrl.searchParams.get("s") || "";
  const items = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [symbol, exchange] = p.split(":");
      return { symbol: symbol.toUpperCase(), exchange: (exchange || "NSE").toUpperCase() };
    })
    .slice(0, 60); // keep the upstream request sane

  if (!items.length) {
    return NextResponse.json({ error: "Pass ?s=SYMBOL:EXCHANGE,…" }, { status: 400 });
  }

  try {
    const quotes = await getQuotes(items);
    return NextResponse.json(
      { quotes, at: new Date().toISOString() },
      { headers: { "Cache-Control": "private, max-age=30" } }
    );
  } catch (err) {
    // Fail soft: the journal is fully usable without prices.
    return NextResponse.json(
      { quotes: [], error: err.message || "Quote source unavailable" },
      { status: 200 }
    );
  }
}
