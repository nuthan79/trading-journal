import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/quotes";
import { userFromRequest } from "@/lib/apiAuth";

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
  if (!(await userFromRequest(req))) {
    return NextResponse.json({ quotes: [], error: "Sign in first." }, { status: 401, headers: { "Cache-Control": "no-store" } });
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
