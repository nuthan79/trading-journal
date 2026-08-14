import { BRAND } from "@/lib/brand";

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
   * `/support` is missing on purpose, for now.
   *
   * It has the best content on the site — real answers about charges, brokers
   * and imports, the sort of thing people actually search — and it sits inside
   * the auth group, so a crawler fetching it receives the words "Starting up"
   * and nothing else. Submitting it would advertise an empty page.
   *
   * Moving it out of that group is worth doing precisely because of what is in
   * it. Until then it does not belong here.
   */
  return [
    { url: `${base}/`,        lastModified: now, changeFrequency: "weekly",  priority: 1 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: "yearly",  priority: 0.4 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
    { url: `${base}/terms`,   lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
  ];
}
