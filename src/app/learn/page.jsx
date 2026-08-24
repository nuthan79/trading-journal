import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { articlesNewestFirst } from "@/lib/articles";
import Wordmark from "@/components/Wordmark";

/**
 * The index for /learn.
 *
 * Written to be worth reading on its own rather than being a bare list of
 * links. An index page that says nothing is a page Google has no reason to
 * rank and a visitor has no reason to stay on — and this one has a real claim
 * to make: everything here is about Indian equity specifically, which is
 * where most trading writing quietly assumes American markets and leaves the
 * reader to work out which parts apply.
 *
 * A server component, like everything else outside the auth gate.
 */

const url = BRAND.domain ? `https://${BRAND.domain}/learn` : undefined;
const TITLE = "Guides for Indian swing traders";
const DESC =
  "Plain explanations of the things a trading journal is built on — R multiples, " +
  "expectancy, position sizing and what Indian equity trades actually cost.";

export const metadata = {
  title: `${TITLE} — ${BRAND.name}`,
  description: DESC,
  ...(url ? { alternates: { canonical: url } } : {}),
  openGraph: { title: TITLE, description: DESC, type: "website", ...(url ? { url } : {}) },
};

const fmt = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
};

export default function LearnIndex() {
  const posts = articlesNewestFirst();

  return (
    <div className="legal art">
      {/* Lets a crawler see this as a collection rather than as five unrelated
          pages that happen to share a path. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: TITLE,
        description: DESC,
        ...(url ? { url } : {}),
        hasPart: posts.map((p) => ({
          "@type": "Article",
          headline: p.title,
          description: p.description,
          datePublished: p.published,
          ...(BRAND.domain ? { url: `https://${BRAND.domain}/learn/${p.slug}` } : {}),
        })),
      }) }} />

      <div className="legal-top">
        <Wordmark size={16} />
        <Link className="legal-back" href="/">← Back</Link>
      </div>

      <h1 className="disp">{TITLE}</h1>
      <p className="legal-lede">
        Most writing about trading assumes American markets and leaves you to work
        out which half applies. These are about NSE and BSE specifically — the
        charges you actually pay, and the arithmetic that tells you whether a setup
        earns its place.
      </p>

      <div className="lrn-list">
        {posts.map((p) => (
          <Link key={p.slug} className="lrn-card" href={`/learn/${p.slug}`}>
            {/* h2, so the page has one h1 and a scannable list under it. */}
            <h2>{p.title}</h2>
            <p>{p.blurb}</p>
            <span className="lrn-meta">
              {fmt(p.published)} · {p.minutes} min read
            </span>
          </Link>
        ))}
      </div>

      {/* Said rather than implied. A one-item index looks abandoned unless it
          admits it is new, and saying so costs nothing. */}
      {posts.length < 3 && (
        <p className="lrn-note">
          More are being written — charges on Indian delivery trades, and how to read
          your broker&rsquo;s tax P&amp;L. If there is something you want explained,{" "}
          <Link href="/support">ask</Link>.
        </p>
      )}

      <p className="sp-foot">
        <Link href="/">Home</Link>{" · "}
        <Link href="/support">Common questions</Link>{" · "}
        <Link href="/dashboard">Open your journal</Link>
      </p>
    </div>
  );
}
