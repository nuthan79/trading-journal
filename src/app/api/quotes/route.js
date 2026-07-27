import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/quotes";

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
  const raw = req.nextUrl.searchParams.get("s") || "";
  const items = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      // SYMBOL:EXCHANGE, or SYMBOL:EXCHANGE:BSECODE where the caller has it
      const [symbol, exchange, code] = p.split(":");
      return {
        symbol: symbol.toUpperCase(),
        exchange: (exchange || "NSE").toUpperCase(),
        code: code || null,
      };
    })
    .slice(0, 60); // keep the upstream request sane

  if (!items.length) {
    return NextResponse.json({ error: "Pass ?s=SYMBOL:EXCHANGE,…" }, { status: 400 });
  }

  try {
    const quotes = await getQuotes(items);
    return NextResponse.json(
      { quotes, at: new Date().toISOString() },
      { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=300" } }
    );
  } catch (err) {
    // Fail soft: the journal is fully usable without prices.
    return NextResponse.json(
      { quotes: [], error: err.message || "Quote source unavailable" },
      { status: 200 }
    );
  }
}
