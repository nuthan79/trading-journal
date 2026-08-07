/**
 * TradingView snapshot links, resolved to an image.
 *
 * A snapshot — the thing you get from the camera button, or Alt+S — is a
 * frozen PNG of the chart as it looked, and TradingView serves it from a
 * public S3 bucket at a predictable path. So attaching a chart is a matter of
 * working out that path from the short link, not of uploading anything.
 *
 * WHY LINKS RATHER THAN FILES. A pasted link costs no storage, survives no
 * matter how many charts get attached, and keeps the annotations you drew.
 * `chartUrl()` in db.js already passes an http URL through untouched instead
 * of asking Supabase Storage to sign a path it does not own, so a resolved
 * snapshot needs nothing else to render.
 *
 * WHAT IT CANNOT DO. A chart LAYOUT link — tradingview.com/chart/xxxx — is a
 * pointer to an interactive workspace, not an image, and it is what the Share
 * button offers first. There is no way to turn one into a picture from the
 * browser, so it is reported as its own case rather than failing vaguely: the
 * fix is one different menu item, and saying so is more useful than "invalid
 * link".
 *
 * THE LONG-TERM RISK, worth writing down. These images live on TradingView's
 * infrastructure, not yours. For a journal kept for years that is a dependency
 * on someone else's retention policy. The durable version fetches the PNG
 * server-side and copies it into the charts bucket — the browser can display
 * the S3 image but cannot read its bytes, so it has to happen on the server.
 * Until that exists, a snapshot is a link to somebody else's file.
 */

export function resolveTradingViewChart(raw) {
  const url = (raw || "").trim();
  if (!url) return { status: "empty" };

  // Already the direct image.
  const s3 = url.match(
    /^https?:\/\/s3\.tradingview\.com\/snapshots\/[a-z0-9]\/[a-zA-Z0-9]+\.png/i
  );
  if (s3) return { status: "ok", src: url.split("?")[0] };

  // The short snapshot link. The S3 subfolder is the first character of the
  // id, lowercased — that is the whole trick.
  const snap = url.match(/tradingview\.com\/x\/([a-zA-Z0-9]+)/);
  if (snap) {
    const id = snap[1];
    return {
      status: "ok",
      id,
      src: `https://s3.tradingview.com/snapshots/${id.charAt(0).toLowerCase()}/${id}.png`,
    };
  }

  if (/tradingview\.com\/chart\//.test(url)) return { status: "layout" };

  return { status: "unknown" };
}

/** What to tell someone whose paste did not resolve. */
export const RESOLVE_HELP = {
  layout:
    "That's a chart layout link, which points at the live workspace rather than a picture. " +
    "Use the camera icon on the toolbar (or Alt+S) and copy the snapshot link it gives you.",
  unknown:
    "That doesn't look like a TradingView snapshot. The link should look like " +
    "tradingview.com/x/AbCd1234 — the camera icon on the chart toolbar makes one.",
};
