/** @type {import('next').NextConfig} */

/**
 * The four screens that moved under /analysis.
 *
 * Permanent, because they are never coming back — a 308 tells a browser and a
 * crawler to stop asking. They are cheap to keep forever and the cost of not
 * having them is a dead link in somebody's bookmarks with no clue what
 * happened, which is the kind of breakage nobody reports and everybody
 * remembers.
 *
 * /stops in particular is linked from prose inside the app — the Edge tab and
 * the Mindset tab both point at it — but it did not move. Only these four did.
 */
const MOVED_TO_ANALYSIS = ["performance", "edge", "review", "mindset"];

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
        Bare /analysis lands on the first sub-tab.
        Handled here rather than by a redirect() inside a page, because the
        (app) layout is a client component that withholds `children` until the
        session resolves — so a server redirect in that subtree never runs. The
        nav points straight at the sub-page; this is only for typed URLs and
        bookmarks. Not permanent: which screen opens first is a product
        decision that may well change.
      */
      { source: "/analysis", destination: "/analysis/performance", permanent: false },
    ];
  },
};
