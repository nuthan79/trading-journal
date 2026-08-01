import Script from "next/script";

/**
 * The page-analytics script, or nothing at all.
 *
 * `user_events` can only see people who signed in. The first question the free
 * launch has to answer — how many showed interest — is mostly about people who
 * never did: they landed, read the page, and left without an account. Those
 * visitors have no user id, so they need counting somewhere else.
 *
 * Not tied to a vendor, because the shape is the same for all the
 * privacy-friendly ones: a script URL and one data attribute naming the site.
 * Plausible wants `data-domain`, Umami wants `data-website-id`; whichever is
 * set is what gets sent.
 *
 *   NEXT_PUBLIC_ANALYTICS_SRC        https://plausible.io/js/script.js
 *   NEXT_PUBLIC_ANALYTICS_DOMAIN     yourdomain.com
 *   NEXT_PUBLIC_ANALYTICS_WEBSITE_ID (Umami's alternative to the above)
 *
 * With none of them set this renders nothing, which is what happens on a
 * developer's machine and in any deployment that has not chosen a provider.
 * Nothing to disable, nothing to strip before a build.
 *
 * Deliberately none of these carry cookies or fingerprint a visitor, so there
 * is no consent banner to add and nothing here that needs a lawful basis
 * beyond a legitimate interest in counting.
 */
export default function Analytics() {
  const src = process.env.NEXT_PUBLIC_ANALYTICS_SRC;
  if (!src) return null;

  const domain = process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN;
  const websiteId = process.env.NEXT_PUBLIC_ANALYTICS_WEBSITE_ID;

  return (
    <Script
      src={src}
      strategy="afterInteractive"
      defer
      {...(domain ? { "data-domain": domain } : {})}
      {...(websiteId ? { "data-website-id": websiteId } : {})}
    />
  );
}
