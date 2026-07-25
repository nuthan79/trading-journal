import { NextResponse } from "next/server";

/**
 * POST /api/review
 *
 * Turns computed findings into a prioritised written review.
 *
 * The model never sees raw trades and is never asked to calculate anything —
 * it receives findings that were already computed deterministically in
 * src/lib/analysis.js and its only job is to weigh, order and explain them.
 * That division is deliberate: it's what stops the review inventing plausible
 * statistics, which is the failure mode that would make the whole page useless.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `You are reviewing a swing trader's own journal data.

The trader runs a long-only breakout system on Indian equities (NSE/BSE) in the
O'Neil / Minervini tradition: buying pivot breakouts out of bases, stops below
the base, position size derived from stop distance. Results are measured in R —
profit divided by the risk taken on that trade.

You will receive a JSON payload of FINDINGS that have already been computed
arithmetically from the trader's closed trades, plus summary statistics.

Rules, in order of importance:

1. Never state a number that is not present in the payload. Do not compute,
   estimate, extrapolate or round into a new figure. If you want to make a point
   that needs a number you don't have, make the point qualitatively instead.
2. Do not invent findings. Everything you raise must trace to a supplied finding.
3. Respect the sample size. If "provisional" is true, say plainly that these are
   early signals and could still be variance.
4. Prioritise ruthlessly. Two or three things matter; the rest is noise. Lead
   with whatever is costing the most, measured in R.
5. Distinguish process from outcome. A losing trade taken correctly is not a
   mistake. A winning trade taken against the rules is still a problem.
6. Be direct and specific. No motivational filler, no "keep up the good work",
   no hedging every sentence into mush. Write like an experienced trader talking
   to a colleague who wants the truth.

Structure your response as JSON, no markdown fences:

{
  "verdict": "2-3 sentences. The honest overall read.",
  "priorities": [
    { "title": "short imperative", "why": "2-3 sentences citing the supplied numbers", "action": "one concrete change, stated as a rule" }
  ],
  "working": "1-2 sentences on what is genuinely working and should not be disturbed. If nothing is, say so.",
  "next": "One specific thing to measure or watch over the next 20 trades."
}

Give at most three priorities. Fewer is better if fewer matter.`;

export async function POST(req) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "No ANTHROPIC_API_KEY set. The computed findings still work without this." },
      { status: 200 }
    );
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request body" }, { status: 400 });
  }

  if (!payload?.findings?.length) {
    return NextResponse.json({ error: "No findings to review yet" }, { status: 200 });
  }

  // Strip anything the model doesn't need. Keeps the prompt small and keeps
  // trade-level detail out of the request entirely.
  const slim = {
    sample: payload.sample,
    provisional: payload.provisional,
    stats: payload.stats || null,
    findings: payload.findings.map((f) => ({
      id: f.id,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      evidence: f.evidence,
    })),
  };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1600,
        system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(slim, null, 2) }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Model API ${res.status}: ${text.slice(0, 300)}` },
        { status: 200 }
      );
    }

    const data = await res.json();
    const raw = (data.content || [])
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();

    let review;
    try {
      review = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ""));
    } catch {
      // If it didn't come back as clean JSON, hand over the prose rather than failing
      review = { verdict: raw, priorities: [], working: "", next: "" };
    }

    return NextResponse.json({ review, generatedAt: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 200 });
  }
}
