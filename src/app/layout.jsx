import "./globals.css";
import "./tables.css";
import Analytics from "@/components/Analytics";
import { BRAND } from "@/lib/brand";

/**
 * Most of the first traffic will arrive from a pasted link — a WhatsApp group,
 * a tweet, a forum reply — so the card that unfurls there is the landing page
 * for a good share of visitors before the real one loads. openGraph is what
 * fills it in.
 */
export const metadata = {
  // Without this, Next resolves openGraph URLs against localhost and warns at
  // build time — and a shared link unfurls with a preview pointing nowhere.
  ...(BRAND.domain ? { metadataBase: new URL(`https://${BRAND.domain}`) } : {}),
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description: BRAND.blurb,
  applicationName: BRAND.name,
  openGraph: {
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.blurb,
    siteName: BRAND.name,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.blurb,
    // Without these the preview card carries no byline, so a shared link looks
    // like it came from nowhere and gives nobody an account to follow.
    ...(BRAND.xHandle ? { site: BRAND.xHandle, creator: BRAND.xHandle } : {}),
  },
};

/**
 * The URL fragment, kept before anything can take it away.
 *
 * A recovery link arrives as `/reset#access_token=…&type=recovery`. The
 * supabase client has detectSessionInUrl on, so the moment db.js loads it
 * consumes that fragment, signs the visitor in, and strips it from the address
 * bar with replaceState. By the time the reset page's own code runs, the
 * evidence that this was a RECOVERY rather than an ordinary sign-in is gone —
 * and /reset then tells someone who followed a valid link that they are
 * "already signed in, so there's nothing to recover here", which is true and
 * useless, because they still cannot set the password they came to set.
 *
 * Reading it inside a module cannot be made reliable: db.js sits in an earlier
 * chunk, so it can run — and finish — before the page module is evaluated.
 * An inline script in the document is the only place that is guaranteed to go
 * first, because it executes before any bundle is fetched.
 *
 * Deliberately not the whole URL. Only the fragment, only in memory, never
 * logged and never sent anywhere — it carries an access token.
 */
const CAPTURE_HASH =
  "window.__lrHash=location.hash?location.hash.slice(1):'';";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: CAPTURE_HASH }} />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
