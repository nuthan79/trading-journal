import { BRAND } from "@/lib/brand";

/**
 * What crawlers may read.
 *
 * Everything under the auth gate is disallowed, and not to hide it — those
 * routes are client-rendered behind a session, so a crawler fetching /holdings
 * receives an empty shell with no content and no way to get any. Google indexes
 * what it is given: a handful of near-identical blank pages under one domain
 * is the shape of a low-quality site, and it dilutes whatever the pages that DO
 * have content are trying to say.
 *
 * The marketing and legal pages are the ones with anything to read, so they are
 * the ones left open.
 *
 * `/reset` is excluded because it only works when opened from a recovery email
 * and shows an error otherwise — an indexed page that tells every visitor their
 * link is invalid is worse than no page.
 */
export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard", "/holdings", "/trades", "/performance",
          "/diary", "/review", "/stops", "/import",
          "/reset", "/api/",
        ],
      },
    ],
    ...(BRAND.domain ? { sitemap: `https://${BRAND.domain}/sitemap.xml` } : {}),
    ...(BRAND.domain ? { host: `https://${BRAND.domain}` } : {}),
  };
}
