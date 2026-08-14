import Link from "next/link";
import ContactForm from "@/components/ContactForm";
import { BRAND } from "@/lib/brand";

/**
 * Ask for help — and the best content on this domain.
 *
 * MOVED OUT OF THE AUTH GROUP. It used to live under (app), wrapped by the
 * client layout that gates on a session, so a crawler fetching /support
 * received the words "Starting up". These are the questions people type into a
 * search box before they know this app exists — how charges are worked out,
 * which brokers can be imported, why a trade is missing from the statistics —
 * and none of them were readable.
 *
 * WHY <details> RATHER THAN AN ACCORDION IN STATE. The old version rendered
 * each answer only when its question was open: `{open === i && <p>{f.a}</p>}`.
 * Prerendered, that HTML held five questions and not one answer — half the
 * value of the page missing for the sake of a plus sign.
 *
 * `<details>` collapses natively, keeps every answer in the markup whether open
 * or not, needs no JavaScript, and is keyboard-accessible without anybody
 * writing aria attributes. It is also why this page is now a server component:
 * nothing here needs a hook.
 *
 * The form is still a client island — it has to be, it posts — and that costs
 * nothing, because a client component inside a server page does not make the
 * page's own HTML disappear.
 */

const url = BRAND.domain ? `https://${BRAND.domain}/support` : undefined;

export const metadata = {
  title: `Help & common questions — ${BRAND.name}`,
  description:
    "How charges are calculated for Indian equity trades, which brokers can be " +
    "imported, why a trade might be missing from your statistics, and how to " +
    "reach us.",
  ...(url ? { alternates: { canonical: url } } : {}),
  openGraph: {
    title: `Help & common questions — ${BRAND.name}`,
    description: "Charges, broker imports, missing trades, and how to get hold of us.",
    type: "article",
    ...(url ? { url } : {}),
  },
};

/**
 * The questions this app actually generates.
 *
 * A generic FAQ is worse than none: it answers nothing and signals that nobody
 * has been asked anything yet. Each of these came from something that was
 * genuinely confusing.
 */
const FAQ = [
  {
    q: "Why is a trade missing from my statistics?",
    a: "Almost always a missing stop. Without one there is no 1R, and anything " +
       "measured in R has nothing to divide by — so the trade sits in the sheet " +
       "but not in expectancy, the R distribution or the drawdown. The Stops page " +
       "lists every one still waiting.",
  },
  {
    q: "Which brokers can I import from?",
    a: "Zerodha, Groww and Dhan. Drop the file in and it works out which one it is — " +
       "there is nothing to choose. Others are added as real export files turn up: " +
       "each broker's report has its own columns and sections, and an adapter written " +
       "from a guess produces numbers that look right and are not. Send yours through " +
       "the form above and it can be added properly.",
  },
  {
    q: "Why don't my charges match my contract note exactly?",
    a: "It depends where they came from. Zerodha and Dhan state a figure per trade, " +
       "and an imported one is kept exactly as the broker gave it. Everywhere else — " +
       "trades you log yourself, and Groww files, which only total charges for the " +
       "whole period — they are computed from the statutory rates and the broker " +
       "settings in Setup, so a different brokerage plan will differ. Any trade's " +
       "figure can be overridden by typing it, and an overridden figure is never " +
       "recalculated.",
  },
  {
    q: "What happened to the sample data?",
    a: "It disappears the moment you log a trade of your own, and does not come " +
       "back. None of it was ever saved — it was generated in your browser so the " +
       "charts had something to show, and it never counted towards your figures.",
  },
  {
    q: "Is my data used for anything else?",
    a: "No. It is not sold, not shared, and not used to train anything. You can take " +
       "the whole lot as one file from My profile, or delete the account outright.",
  },
];

export default function SupportPage() {
  return (
    <div className="legal sp">
      {/* Server-rendered, so it does not depend on a crawler executing scripts.
          Every answer below is in the markup, which is what makes this markup
          worth writing at all. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: FAQ.map(({ q, a }) => ({
          "@type": "Question", name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      }) }} />

      <div className="legal-top">
        <span className="disp" style={{ fontSize: 16 }}>{BRAND.name}</span>
        <Link className="legal-back" href="/">← Back</Link>
      </div>

      <h1 className="disp sp-h1">Ask, or tell us what&rsquo;s wrong.</h1>
      <p className="sp-lede">
        {BRAND.name} is built and run by one person, so replies take a day or two —
        but they do come. If something is broken, saying what you were doing when it
        happened is worth more than anything else you can write.
      </p>

      <ContactForm />

      {/* h2, because the h1 above is the page. A second h1 would leave a
          crawler with two claims about what this page is. */}
      <h2 className="sp-faqhead">Common questions</h2>
      <div className="sp-faq">
        {FAQ.map(({ q, a }) => (
          <details key={q} className="sp-q">
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>

      <p className="sp-foot">
        <Link href="/dashboard">Open your journal</Link>
        {" · "}<Link href="/privacy">Privacy</Link>
        {" · "}<Link href="/terms">Terms</Link>
      </p>
    </div>
  );
}
