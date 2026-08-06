import { NextResponse } from "next/server";
import { getIndexHistory, INDICES } from "@/lib/quotes";
import { userFromRequest } from "@/lib/apiAuth";

/**
 * GET /api/index-history?index=nifty500&from=2025-02-01&to=2026-08-06
 *
 * Daily closes for a broad index, behind the same server-side proxy as
 * /api/quotes and for the same reason — the browser cannot call Yahoo across
 * origins.
 *
 * The response is identical for every user, so unlike quotes this one is
 * cached at the edge as well as in the process. `s-maxage` of an hour with a
 * long stale window means a cold instance is the only thing that ever reaches
 * Yahoo, and a slow upstream serves the previous copy rather than a spinner.
 */

export const runtime = "nodejs";

export async function GET(req) {
  if (!(await userFromRequest(req))) {
    return NextResponse.json(
      { points: [], error: "Sign in first." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const q = req.nextUrl.searchParams;
  const index = q.get("index") || "nifty500";
  if (!INDICES.some((i) => i.id === index)) {
    return NextResponse.json(
      { points: [], error: `Unknown index. Try: ${INDICES.map((i) => i.id).join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const data = await getIndexHistory({
      index,
      from: q.get("from") || undefined,
      to: q.get("to") || undefined,
    });
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (err) {
    // Fail soft: the deployment chart reads fine with no index behind it.
    return NextResponse.json(
      { points: [], error: err?.message || "Index source unavailable" },
      { status: 200 }
    );
  }
}
