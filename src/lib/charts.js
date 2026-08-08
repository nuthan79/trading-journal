/**
 * Resolves a pasted TradingView link to a directly-embeddable image URL.
 *
 * THE ONE PLACE THAT KNOWS THIS. There were briefly two — this, and a second
 * copy lifted out of an old prototype when the trade form and the position
 * panel gained their own attach fields. Two resolvers for one external format
 * is a slow-motion bug: TradingView changes something, one of them gets fixed,
 * and the other keeps failing in whichever screen nobody was testing.
 *
 * WHAT RESOLVES
 *
 * Only /x/{id}/ "snapshot" links map to a static image — TradingView renders
 * those from a fixed S3 path keyed by the snapshot id's first character,
 * lowercased. That derivation is the whole trick.
 *
 * An already-resolved s3.tradingview.com URL passes straight back out. The app
 * stores resolved URLs itself, so somebody copying one out of their own
 * journal and pasting it back in should not be told it is invalid.
 *
 * A protocol-less paste is accepted too. "tradingview.com/x/AbCd" is what
 * lands in the clipboard often enough, and rejecting it teaches nothing.
 *
 * WHAT DOES NOT, AND WHY IT SAYS SO SPECIFICALLY
 *
 * /chart/{id}/ links are live layout links — the chart re-renders client-side
 * behind a login wall and there is no equivalent static image. It is also what
 * the Share button offers first, so most people hit it before they hit a
 * snapshot. The message names the menu item that works rather than saying the
 * link is bad.
 *
 * THE LONG-TERM RISK, worth writing down. These images live on TradingView's
 * infrastructure. For a journal kept for years that is a dependency on someone
 * else's retention policy, and if they expire or block hotlinking every chart
 * in every journal breaks at once. The durable version fetches the PNG
 * server-side and copies it into the charts bucket — the browser can display
 * the S3 image but cannot read its bytes, so it has to happen on the server.
 * Until that exists, a snapshot is a link to somebody else's file.
 */

const SNAPSHOT_HOST = "s3.tradingview.com";

export function resolveTradingViewChart(input) {
  const raw = (input || "").trim();
  // `empty` is separate from an error: a blank field on a form has nothing
  // wrong with it, and callers that render a hint under an untouched input
  // need to tell "not filled in yet" from "filled in wrongly".
  if (!raw) return { ok: false, empty: true, error: "Paste a TradingView chart link first." };

  let parsed;
  try {
    // A bare "tradingview.com/x/…" is a normal thing to paste and parses only
    // once it has a scheme.
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }

  const host = parsed.hostname.replace(/^www\./, "");

  // Already resolved — hand it back rather than call it invalid.
  if (host === SNAPSHOT_HOST) {
    if (/^\/snapshots\/[a-z0-9]\/[A-Za-z0-9]+\.png$/i.test(parsed.pathname)) {
      return { ok: true, url: `${parsed.origin}${parsed.pathname}` };
    }
    return { ok: false, error: "That TradingView image link doesn't point at a snapshot." };
  }

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
  return { ok: true, url: `https://${SNAPSHOT_HOST}/snapshots/${id[0].toLowerCase()}/${id}.png` };
}
