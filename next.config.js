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

module.exports = {
  reactStrictMode: true,
  async redirects() {
    return [
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
