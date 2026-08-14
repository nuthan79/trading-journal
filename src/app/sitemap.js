import { BRAND } from "@/lib/brand";
import { ARTICLES } from "@/lib/articles";

/**
 * The pages worth indexing, which is only the ones with content.
 *
 * Deliberately short. A sitemap listing every route the app happens to have
 * would submit a dozen empty client-rendered shells for indexing and invite
 * exactly the judgement we do not want — that most of this domain is thin.
 * Four real pages beats sixteen where twelve say nothing.
 *
 * Priorities are relative to each other and nothing else. The landing page is
 * what should rank; the legal pages exist to be found by someone looking for
 * them, and by Google's OAuth review, not to compete for traffic.
 *
 * `lastModified` is the build date rather than a hardcoded one, so redeploying
 * after an edit tells crawlers something changed instead of insisting nothing
 * has since the day this was written.
 */
export default function sitemap() {
  if (!BRAND.domain) return [];
  const base = `https://${BRAND.domain}`;
  const now = new Date();

  /**
   * `/support` sits second because it is the page most likely to be FOUND
   * rather than navigated to. The landing page competes for "trading journal";
   * these answers compete for the questions somebody types before they know a
   * journal is what they want.
   */
  return [
    { url: `${base}/`,        lastModified: now, changeFrequency: "weekly",  priority: 1 },
    { url: `${base}/support`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/learn`,   lastModified: now, changeFrequency: "monthly", priority: 0.7 },

    /**
     * Articles, derived from the manifest rather than listed here.
     *
     * The first one WAS listed here by hand, which meant writing a second and
     * forgetting this file would publish a page no search engine was ever told
     * about — silent, and nobody checks a sitemap. One list, three consumers.
     *
     * They rank above the legal pages because they are what somebody who has
     * never heard of this app can actually find.
     */
    ...ARTICLES.map((a) => ({
      url: `${base}/learn/${a.slug}`,
      lastModified: a.published ? new Date(a.published) : now,
      changeFrequency: "monthly",
      priority: 0.8,
    })),
    { url: `${base}/contact`, lastModified: now, changeFrequency: "yearly",  priority: 0.4 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
    { url: `${base}/terms`,   lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
  ];
}
