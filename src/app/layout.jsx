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
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
