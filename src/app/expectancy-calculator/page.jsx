import Link from "next/link";
import ExpectancyCalculator from "@/components/ExpectancyCalculator";
import { BRAND } from "@/lib/brand";
import Wordmark from "@/components/Wordmark";

/**
 * The one calculator worth publishing.
 *
 * WHY NOT A BROKERAGE CALCULATOR. Every broker ships one on their own domain
 * with an authority score we cannot approach, so ours would compete for a term
 * we cannot win and answer a question already answered everywhere. This one has
 * the opposite shape: it is barely served in the Indian market, it answers the
 * question traders most need answered — is this system actually profitable —
 * and answering it *requires* the R framing the rest of this app is built on.
 * Somebody who works out here that 60% winners at 0.5R loses money has been
 * taught why an R-based journal exists, which no amount of landing page copy
 * achieves.
 *
 * SERVER COMPONENT, CLIENT ISLAND. The prose below is in the HTML whether or
 * not a crawler runs JavaScript, which matters because the prose is what ranks;
 * the calculator hydrates on top of it.
 *
 * THE PAGE MAKES A PROMISE THE APP KEEPS. A stranger types six numbers here
 * because they are guessing at them. The whole upgrade is that a journal knows
 * those six numbers — which is why the same component takes a `prefill` prop
 * and why the last section says so plainly rather than pitching.
 */

const url = BRAND.domain ? `https://${BRAND.domain}/expectancy-calculator` : undefined;

const TITLE = "Trading expectancy calculator — is your system actually profitable?";
const DESC =
  "Enter your win rate and average win/loss in R to get expectancy per trade, " +
  "the break-even win rate you need, profit factor, and what it compounds to " +
  "over ten years. Free, no sign-up, works in your browser.";

export const metadata = {
  title: TITLE,
  description: DESC,
  keywords: [
    "trading expectancy calculator", "risk reward calculator",
    "breakeven win rate", "profit factor calculator", "R multiple calculator",
    "win rate vs risk reward", "trading system profitability",
    "position sizing calculator India", "compounding calculator trading",
  ],
  ...(url ? { alternates: { canonical: url } } : {}),
  openGraph: {
    title: "Trading expectancy calculator",
    description:
      "Win rate alone tells you nothing. Find the break-even win rate your " +
      "reward:risk actually requires — and what your edge compounds to.",
    type: "website",
    ...(url ? { url } : {}),
  },
};

/**
 * Questions answered on the page, not teased.
 *
 * These are the searches this page can realistically win — each one is a real
 * question with a short, checkable answer, which is what a featured snippet is
 * made of.
 */
const FAQ = [
  {
    q: "What is expectancy in trading?",
    a: "Expectancy is the average amount a single trade returns over many trades, " +
       "measured in R — your profit or loss divided by what you risked. It is " +
       "(win rate × average win) minus (loss rate × average loss). Positive " +
       "expectancy means the system makes money given enough trades; negative " +
       "means it loses money no matter how well you manage position size.",
  },
  {
    q: "What is a good win rate for swing trading?",
    a: "There is no such thing on its own. A win rate is only meaningful next to " +
       "reward:risk. At 3:1 you break even at 25%, so 40% is a strong edge. At " +
       "0.5:1 you break even at 67%, so the same 40% is a fast way to lose money. " +
       "Most profitable breakout swing traders sit between 35% and 50% with " +
       "winners well above 2R.",
  },
  {
    q: "How do I calculate my break-even win rate?",
    a: "Divide your average loss by the sum of your average win and average loss. " +
       "At 2R average wins and 1R average losses that is 1 ÷ 3 = 33.3%. Win more " +
       "often than that and the system is profitable; win less often and it is not.",
  },
  {
    q: "What is a good profit factor?",
    a: "Profit factor is gross profit divided by gross loss. Anything above 1.0 " +
       "makes money. Above 1.5 is a solid system, and above 2.0 is excellent — " +
       "though a very high profit factor on a small number of trades usually " +
       "means the sample is too small rather than the system is exceptional.",
  },
  {
    q: "Why is the ten-year projection lower than expectancy × trades suggests?",
    a: "Because growth compounds multiplicatively and losses are taken on a " +
       "smaller account than the wins that preceded them. A +1R and a −1R at 2% " +
       "risk leave you slightly below where you started, not level. This " +
       "calculator uses the expected log return so the curve matches what an " +
       "account actually does; most projections skip this and overstate the " +
       "result, sometimes by a lot.",
  },
  {
    q: "Does this work for Indian markets?",
    a: "R is currency-neutral, so the expectancy and break-even maths apply " +
       "anywhere. The projection is shown in rupees. It excludes brokerage, STT, " +
       "stamp duty, DP charges and capital gains tax, all of which come off a " +
       "real result — so treat the figure as a ceiling.",
  },
];

export default function ExpectancyPage() {
  return (
    <div className="legal sp ec-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "FAQPage",
            mainEntity: FAQ.map(({ q, a }) => ({
              "@type": "Question", name: q,
              acceptedAnswer: { "@type": "Answer", text: a },
            })),
          },
          {
            "@type": "WebApplication",
            name: "Trading expectancy calculator",
            applicationCategory: "FinanceApplication",
            operatingSystem: "Any",
            description: DESC,
            ...(url ? { url } : {}),
            offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
          },
        ],
      }) }} />

      <div className="legal-top">
        <Link className="legal-back" href="/" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          ← <Wordmark size={15} />
        </Link>
      </div>

      <h1 className="sp-h1">Is your trading system actually profitable?</h1>
      <p className="sp-lede">
        Win rate alone cannot tell you — 60% winners loses money at the wrong
        reward:risk, and 35% winners makes a fortune at the right one. Enter your
        numbers to get expectancy per trade, the win rate you actually need to break
        even, and what the edge compounds to. Free, and nothing you type leaves your
        browser.
      </p>

      <ExpectancyCalculator />

      {/* Prose below the tool, not above it. Somebody arriving from a search
          wants the calculator immediately; the explanation is what keeps them
          on the page afterwards and what the crawler reads. */}
      <h2 className="sp-faqhead">Why win rate is the wrong thing to optimise</h2>
      <p className="sp-p">
        Almost every trader can tell you their win rate and almost none can tell you
        their break-even win rate, which is the number that decides whether the first
        one is good news. They are trivially related: if your winners average twice
        what your losers cost, you break even at 33% and everything above that is
        profit. If your winners average half what your losers cost, you need 67% just
        to stand still — and nobody sustains 67%.
      </p>
      <p className="sp-p">
        This is why cutting losses matters more than picking winners. Letting an
        average loss drift from 1R to 1.5R — one moved stop, occasionally — raises
        the break-even win rate at 2R winners from 33% to 43%. Ten points of win rate,
        surrendered without taking a single extra trade. The grid above shows exactly
        where that moves you.
      </p>

      <h2 className="sp-faqhead">Measured in R, which is the point</h2>
      <p className="sp-p">
        R is profit or loss divided by the amount risked on that trade. A ₹8,000 win
        on a ₹4,000 risk is +2R; a ₹40,000 win on a ₹40,000 risk is +1R. In rupees the
        second looks five times better and in R the first one plainly is — which is
        the entire reason this calculator asks for averages in R rather than in money.
        If that framing is new, <Link href="/learn/what-is-an-r-multiple">start here</Link>.
      </p>

      <h2 className="sp-faqhead">Common questions</h2>
      <div className="sp-faq">
        {FAQ.map(({ q, a }) => (
          <details key={q} className="sp-q">
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>

      {/* The honest funnel: this page's weakness is its own pitch. Every number
          above was typed from memory, and memory is generous about win rates. */}
      <h2 className="sp-faqhead">The numbers you just typed were guesses</h2>
      <p className="sp-p">
        That is the real limit of any calculator like this. Almost nobody's remembered
        win rate survives contact with their actual trade history, and average loss is
        the one people are most wrong about — because the trades where a stop got moved
        are exactly the ones that do not come to mind.
      </p>
      <p className="sp-p">
        {BRAND.name} is a journal that computes these six numbers from your real
        closed trades and puts them into this same screen, so the expectancy you see
        is measured rather than estimated. Import a broker tax P&amp;L statement and
        the history is there in a minute.
      </p>
      {/* A button rather than a sentence with a link in it. This is the page a
          stranger lands on, so it is the one place on the site where the next
          step has to be impossible to miss — and .art-cta already frames one
          the same way at the foot of an article. */}
      <div className="art-cta">
        <Link className="mk-cta" href="/dashboard">Start your journal — it&apos;s free</Link>
        <p className="ec-ctanote">
          No card. Or <Link href="/support">read how importing works</Link> first.
        </p>
      </div>

      <p className="sp-foot">
        <Link href="/">Home</Link>
        {" · "}<Link href="/learn">Guides</Link>
        {" · "}<Link href="/support">Help</Link>
        {" · "}<Link href="/privacy">Privacy</Link>
        {" · "}<Link href="/terms">Terms</Link>
      </p>
    </div>
  );
}
