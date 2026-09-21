import { NextResponse } from "next/server";
import { getQuotes, fxRate, splitsFor } from "@/lib/quotes";
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

  /**
   * ?fx=USDINR asks for the exchange rate instead of quotes — the same seam,
   * the same rate limit, the same auth. A separate route would be a second
   * place for the upstream to be named.
   */
  const fx = (req.nextUrl.searchParams.get("fx") || "").toUpperCase();
  if (/^[A-Z]{6}$/.test(fx)) {
    const rate = await fxRate(fx.slice(0, 3), fx.slice(3));
    return NextResponse.json({ pair: fx, rate, at: new Date().toISOString() },
      { headers: { "Cache-Control": "public, max-age=600" } });
  }

  /**
   * ?splits=SYMBOL:EXCHANGE,… asks what corporate actions a stock has had.
   * Same route, same auth, same rate limit — and one request whatever the
   * list, because the check is per book rather than per symbol.
   */
  const splitList = (req.nextUrl.searchParams.get("splits") || "").trim();
  if (splitList) {
    const want = splitList.split(",").map((p) => p.trim()).filter(Boolean).slice(0, 60)
      .map((p) => { const [symbol, exchange] = p.split(":");
                    return { symbol: String(symbol).toUpperCase(),
                             exchange: String(exchange || "NSE").toUpperCase() }; });
    const out = {};
    /* Small batches: sixty symbols at once is sixty upstream requests, and
       the source throttles a burst before it refuses a steady stream. */
    for (let i = 0; i < want.length; i += 6) {
      const batch = want.slice(i, i + 6);
      const got = await Promise.all(batch.map((it) => splitsFor(it).catch(() => [])));
      batch.forEach((it, j) => { if (got[j]?.length) out[`${it.symbol}:${it.exchange}`] = got[j]; });
    }
    return NextResponse.json({ splits: out },
      { headers: { "Cache-Control": "public, max-age=21600" } });
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
