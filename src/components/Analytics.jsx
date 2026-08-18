"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

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
 *   NEXT_PUBLIC_ANALYTICS_SRC        https://cloud.umami.is/script.js
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
 *
 * ── AUTOMATIC TRACKING IS OFF, AND THAT IS NOW THE POINT OF THIS FILE ──
 *
 * Sign-in uses Supabase's implicit flow, so a session comes back as a URL
 * fragment: `/dashboard#access_token=eyJ…`. The tracker's automatic pageview
 * fires on load with whatever the address bar holds at that instant, which
 * meant real access tokens were being sent to and stored by a third-party
 * analytics service. They were found sitting in its Pages report, readable by
 * anyone holding a public share link.
 *
 * The tokens are short-lived and no refresh token was among them, so the
 * exposure was bounded — but it would have repeated on every single sign-in.
 *
 * So the pageview is sent by hand instead, built from `usePathname()`. The
 * router has no notion of a fragment and this never reads `window.location`,
 * so nothing secret can reach the URL that gets reported, whatever the address
 * bar happens to say. That is the property to preserve if this file is ever
 * changed: the reported URL comes from the router, never from `location`.
 *
 * THE QUERY STRING IS DROPPED TOO, for the same reason one notch weaker. The
 * other half of Supabase's auth surface puts `?code=…` and `?error=…` in the
 * query, and password-reset links have carried tokens there historically. No
 * report in this app is worth reading per-query anyway, so there is nothing to
 * weigh against it. (It also keeps `useSearchParams` out of the root layout,
 * which would otherwise opt every page — including the marketing pages that
 * exist to be crawled — out of static rendering.)
 *
 * AND THE TRACKER IS TOLD TO SCRUB THE URL ITSELF, which is belt and braces
 * only for pageviews but load-bearing for everything else. Umami builds every
 * payload from one base object holding a URL it captured at load — so the
 * custom events in `pageEvents.js` were carrying the token too, and those are
 * sent by calling the tracker directly, where there is no URL of ours to
 * substitute. `data-exclude-hash` strips the fragment where it is captured,
 * which closes that path and any other payload built the same way.
 */

export default function Analytics() {
  const src = process.env.NEXT_PUBLIC_ANALYTICS_SRC;
  const pathname = usePathname();

  /**
   * The tracker loads `afterInteractive`, which is after React has mounted —
   * so on a cold load the effect below runs before `window.umami` exists. Left
   * to itself that silently drops the first pageview of every visit, which is
   * the only one a bounced visitor ever generates and therefore the one that
   * matters most. Waiting for onLoad is what makes the manual call safe.
   */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ready || !pathname) return;
    // Defensive: the script could have loaded and failed to define this.
    if (typeof window.umami?.track !== "function") return;
    // Spread the tracker's own props so referrer, title, screen and language
    // survive; replace only the URL, which is the field that leaks.
    window.umami.track((props) => ({ ...props, url: pathname }));
  }, [ready, pathname]);

  if (!src) return null;

  const domain = process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN;
  const websiteId = process.env.NEXT_PUBLIC_ANALYTICS_WEBSITE_ID;

  return (
    <Script
      src={src}
      strategy="afterInteractive"
      defer
      data-auto-track="false"
      data-exclude-hash="true"
      data-exclude-search="true"
      onLoad={() => setReady(true)}
      {...(domain ? { "data-domain": domain } : {})}
      {...(websiteId ? { "data-website-id": websiteId } : {})}
    />
  );
}
