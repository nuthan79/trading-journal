/** @type {import('next').NextConfig} */

/**
 * The three screens that moved under /analysis.
 *
 * Permanent, because they are never coming back — a 308 tells a browser and a
 * crawler to stop asking. They cost nothing to keep forever, and the cost of
 * not having them is a dead link in somebody's bookmarks with no clue what
 * happened: the kind of breakage nobody reports and everybody remembers.
 *
 * Performance is NOT in this list. It briefly lived at /analysis/performance
 * and moved back to the top level, so it needs the opposite redirect — see
 * below. /stops did not move at all, though it is linked from prose inside two
 * of these screens.
 */
const MOVED_TO_ANALYSIS = ["edge", "review", "mindset"];

/**
 * The Vercel production alias, which was serving the whole app in parallel.
 *
 * `trading-journal.vercel.app` returned 200 on every route, so the app had two
 * live addresses. That costs twice:
 *
 *   SEARCH — two crawlable copies of every page. The canonical tags point at
 *   ledgerr.app and mitigate it, but a canonical is a hint. A redirect is not.
 *
 *   MEASUREMENT — the analytics script is attributed by website id, not by
 *   host, so a visit to the Vercel address lands in the same Umami site as a
 *   real one and quietly pollutes the launch numbers.
 *
 * EXACT HOST, NOT A PATTERN. Branch and commit previews are
 * `trading-journal-git-<branch>-<scope>.vercel.app` and
 * `trading-journal-<hash>.vercel.app`; none of them equal this string, so the
 * whole preview workflow is untouched. A wildcard here would redirect every
 * preview to production and make it impossible to look at a branch before
 * merging it — which is the failure mode to avoid, and the reason this is
 * written out in full rather than as a regex.
 */
const VERCEL_ALIAS = "trading-journal.vercel.app";
const CANONICAL_ORIGIN = "https://ledgerr.app";

module.exports = {
  reactStrictMode: true,
  async redirects() {
    return [
      /*
        FIRST IN THE LIST, deliberately. The path redirects below apply on any
        host, so if one of them matched first a visitor to the Vercel address
        would be sent to another path on the Vercel address and only then to
        the real domain — two hops and one of them pointless. Sending the host
        home first means the path rules run once, on the domain that keeps
        them.
      */
      {
        source: "/:path*",
        has: [{ type: "host", value: VERCEL_ALIAS }],
        destination: `${CANONICAL_ORIGIN}/:path*`,
        permanent: true,
      },

      ...MOVED_TO_ANALYSIS.map((slug) => ({
        source: `/${slug}`,
        destination: `/analysis/${slug}`,
        permanent: true,
      })),

      /*
        Performance, back where it started.

        It spent one deploy at /analysis/performance before Performance was
        pulled out of Analysis, so that URL is live and reachable from history
        and open tabs. Temporary rather than permanent: a 308 would be cached
        by browsers that saw it, and this address has now changed twice — it
        should not be nailed down by something a browser refuses to re-check.
      */
      { source: "/analysis/performance", destination: "/performance", permanent: false },

      /*
        Bare /analysis lands on the first sub-tab.
        Handled here rather than by a redirect() inside a page, because the
        (app) layout is a client component that withholds `children` until the
        session resolves — so a server redirect in that subtree never runs. The
        nav points straight at the sub-page; this is only for typed URLs and
        bookmarks. Not permanent: which screen opens first is a product
        decision that may well change.
      */
      { source: "/analysis", destination: "/analysis/edge", permanent: false },
    ];
  },
};
