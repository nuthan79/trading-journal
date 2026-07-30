import { NextResponse } from "next/server";
import { fetchIndexHistory, classifyRegime, INDEX_TICKERS } from "@/lib/market";
import { userFromRequest } from "@/lib/apiAuth";

/**
 * GET /api/market?index=NIFTY500&range=3y
 *
 * Daily closes with moving averages and a regime label per day. Cached at the
 * edge for an hour — daily bars don't change intraday, and the review only
 * needs which side of the 50/200 the index was on.
 */

export const runtime = "nodejs";

export async function GET(req) {
  if (!(await userFromRequest(req))) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const p = req.nextUrl.searchParams;
  const name = (p.get("index") || "NIFTY500").toUpperCase();
  const ticker = INDEX_TICKERS[name] || name;
  const range = p.get("range") || "3y";

  try {
    const history = await fetchIndexHistory(ticker, range);
    const classified = classifyRegime(history);
    const last = classified[classified.length - 1];

    return NextResponse.json(
      {
        index: name,
        ticker,
        days: classified.length,
        current: last ? { date: last.date, close: last.close, regime: last.regime } : null,
        history: classified,
      },
      { headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400" } }
    );
  } catch (err) {
    return NextResponse.json({ error: err.message, history: [] }, { status: 200 });
  }
}
