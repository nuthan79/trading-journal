/**
 * Resolves a pasted TradingView link to a directly-embeddable image URL.
 *
 * Only /x/{id}/ "snapshot" links map to a static image — TradingView renders
 * those from a fixed S3 path keyed by the snapshot id's first character.
 * /chart/{id}/ links are live layout links (the chart re-renders client-side
 * behind a login wall) and have no equivalent static image, so they're
 * rejected with a message pointing at the right share action instead.
 */
export function resolveTradingViewChart(input) {
  const raw = (input || "").trim();
  if (!raw) return { ok: false, error: "Paste a TradingView chart link first." };

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }

  const host = parsed.hostname.replace(/^www\./, "");
  if (host !== "tradingview.com") {
    return { ok: false, error: "That's not a tradingview.com link." };
  }

  if (/^\/chart\//.test(parsed.pathname)) {
    return {
      ok: false,
      error:
        "That's a live chart layout link, not a snapshot — on the chart, use the camera icon → \"Copy image link\" to get a tradingview.com/x/… link, then paste that.",
    };
  }

  const m = parsed.pathname.match(/^\/x\/([A-Za-z0-9]+)\/?$/);
  if (!m) {
    return { ok: false, error: "Couldn't find a snapshot in that link — expecting tradingview.com/x/…" };
  }

  const id = m[1];
  const bucket = id[0].toLowerCase();
  return { ok: true, url: `https://s3.tradingview.com/snapshots/${bucket}/${id}.png` };
}
