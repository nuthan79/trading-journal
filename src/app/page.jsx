import Link from "next/link";
import { BRAND } from "@/lib/brand";
import SignedInLink from "@/components/SignedInLink";
import Wordmark from "@/components/Wordmark";

/**
 * The marketing page, and the only page on this domain a search engine can
 * actually read.
 *
 * WHY IT EXISTS SEPARATELY. `/` used to be the dashboard, inside the client
 * route group that gates on a session. That group renders "Starting up" until
 * the session resolves, so every crawl of ledgerr.app returned a title, a
 * description, and the words "Starting up". Nothing else. A page with no text
 * ranks for no text.
 *
 * So the product moved to /dashboard and this is a server component: no
 * hooks, no session, no client bundle. The HTML that leaves the server is the
 * finished page.
 *
 * ON WRITING FOR SEARCH WITHOUT WRITING FOR ROBOTS. The words below are the
 * words somebody would use — "VCP", "stage 2", "RS rank", "R multiple", "STT
 * and stamp duty", "Zerodha tax P&L". They are here because the app genuinely
 * records every one of them, and that is the only reason they should be here:
 * a page stuffed with terms it does not honour bounces every visitor it wins,
 * which search engines measure and act on.
 *
 * IT NAMES A SCHOOL RATHER THAN A CATEGORY, and that is the whole positioning.
 * "Trading journal" is a term Tradervue and Edgewonk have owned for a decade.
 * The people this fits are narrower and easier to reach: they already say VCP,
 * stage 2 and R, and nobody in India is writing for them. A page that speaks
 * their vocabulary is recognised in seconds by the few hundred who matter and
 * ignored by everyone else, which is the correct trade.
 *
 * WHAT THIS PAGE CANNOT DO is rank on its own. One page competes for one
 * subject. Traffic for a niche tool comes from answering the questions people
 * type before they know a tool exists — how charges are worked out, what an R
 * multiple is, how to read a tax P&L — and that is a writing job, not a
 * markup one.
 */

const url = BRAND.domain ? `https://${BRAND.domain}` : undefined;

export const metadata = {
  /**
   * Written for the search somebody in this school actually types.
   *
   * "Swing trading journal" is a term Tradervue and Edgewonk have owned for a
   * decade; there is no winning it from a standing start. "VCP", "stage
   * analysis" and "R multiple" alongside NSE/BSE describe a much smaller set
   * of people — who are precisely the ones this app fits, and whom nobody in
   * India is currently writing for.
   */
  title: `${BRAND.name} — VCP & breakout trade journal for NSE, measured in R`,
  description:
    "A trading journal for Indian breakout swing traders. Log the base pattern, " +
    "Weinstein stage and RS rank, see expectancy in R by setup, and import your " +
    "Zerodha, Groww or Dhan tax P&L with charges to the paisa.",
  keywords: [
    "VCP trading journal", "breakout trading journal India", "stage analysis journal",
    "R multiple journal", "swing trading journal India", "NSE trading journal",
    "trade journal with charges", "Zerodha tax P&L import", "position sizing NSE",
  ],
  ...(url ? { alternates: { canonical: url } } : {}),
  openGraph: {
    // The link preview is what gets seen when this is shared into a trading
    // group — so it leads with the words that group already uses.
    title: `${BRAND.name} — VCP & breakout trade journal for NSE, in R`,
    description:
      "Log the base pattern, stage and RS rank. See expectancy in R by setup, with " +
      "charges to the paisa and your broker's tax P&L imported in one file.",
    type: "website",
    ...(url ? { url } : {}),
  },
};

/**
 * Structured data, kept honest.
 *
 * Only claims that are true and checkable: what this is, who it is for, that
 * it costs nothing today. No invented ratings or review counts — Google
 * penalises those, and more to the point they would be a lie told to somebody
 * deciding whether to trust the thing with their trading record.
 */
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: BRAND.name,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  ...(url ? { url } : {}),
  description: BRAND.blurb,
  offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
  audience: {
    "@type": "Audience",
    audienceType:
      "Breakout swing traders on the Indian stock market (NSE and BSE) who " +
      "trade base patterns such as VCP and measure results in R",
  },
};

/** The questions people type, answered where a crawler can see them. Each one
 *  is a real answer rather than a hook — a page that promises and withholds is
 *  the thing everybody hates about search results. */
const FAQ = [
  {
    q: "What is an R multiple, and why measure trades in R?",
    a: "R is your profit or loss divided by the money you had at risk when you " +
       "entered — the distance from your entry to your stop, times your position " +
       "size. It makes trades comparable: a ₹8,000 win on a tight stop and a " +
       "₹40,000 win on a wide one might be the same 2R, or wildly different. " +
       "Measured in rupees you cannot tell which of your setups actually pays.",
  },
  {
    q: "Does it calculate Indian brokerage and taxes?",
    a: "Yes — STT, exchange transaction charges (which differ between NSE and " +
       "BSE), SEBI turnover fees, stamp duty on the buy leg, GST on brokerage " +
       "and fees, and DP charges on the sell. Brokerage follows your own plan, " +
       "whether that is zero-brokerage delivery, a flat fee per order or a " +
       "percentage. Any figure can be overridden by typing it, and an " +
       "overridden figure is never recalculated.",
  },
  {
    q: "Can I import my existing trades?",
    a: "Drop in the tax P&L or capital gains report from Zerodha, Groww or Dhan " +
       "and it works out which broker it came from by reading the file. Trades " +
       "are matched by ISIN rather than by name, re-importing an overlapping " +
       "period skips what is already there, and any import can be undone.",
  },
  {
    q: "Who is this actually for?",
    a: "Swing traders who work from base patterns and a stop set before entry — " +
       "VCPs, flat bases, cups, high tight flags — and who want to know which of " +
       "those setups pays rather than only what the month made. It records the " +
       "pattern, the Weinstein stage, the RS rank, the distance from the pivot and " +
       "the breakout volume, then cuts your own expectancy by each of them. If you " +
       "trade intraday, or hold for years without a stop, almost none of that will " +
       "be useful to you.",
  },
  {
    q: "What does it cost?",
    a: "Nothing at the moment. It is free while it is being built and there is " +
       "no card to enter. You can export everything you have logged as a single " +
       "file at any time, and delete your account and its data whenever you like.",
  },
];

export default function HomePage() {
  return (
    <main className="mk">
      {/* Server-rendered, so it is in the HTML rather than added by a script a
          crawler may or may not run. */}
      <script type="application/ld+json"
              dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: FAQ.map(({ q, a }) => ({
          "@type": "Question", name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      }) }} />

      <header className="mk-top">
        <Wordmark size={19} />
        <SignedInLink className="mk-signin" />
      </header>

      <section className="mk-hero">
        <p className="mk-eyebrow">NSE &amp; BSE · breakout swing trading</p>
        {/* One h1, and it says what the product is rather than being clever. */}
        <h1>Know which of your setups actually pay.</h1>
        {/**
          * NAMES THE SCHOOL, DELIBERATELY.
          *
          * This used to say "a trading journal for Indian swing traders", which
          * is true and competes for a term Tradervue and Edgewonk have owned
          * for years. It also failed the only test that matters in the first
          * ten seconds: somebody who trades VCPs off a stage-2 base could read
          * the whole page without once seeing a word that told them it was
          * built for them.
          *
          * The vocabulary below is not decoration — it is what the app actually
          * records: PATTERNS carries VCP, Cup & Handle, Flat Base, High Tight
          * Flag; STAGES carries Weinstein's four; there is an RS rank field and
          * everything is denominated in R. Saying so costs nothing and is the
          * difference between a visitor and a recognition.
          *
          * Kept readable by somebody who does NOT know the jargon: the first
          * sentence works on its own, and the terms arrive as examples rather
          * than as a password.
          */}
        <p className="mk-lead">
          A trading journal for Indian swing traders who work in <b>R</b> — profit or
          loss against what you risked — so a ₹8,000 win on a tight stop and a ₹40,000
          win on a wide one finally compare.
        </p>
        <p className="mk-lead">
          Built for the way breakout traders actually work: <b>VCPs</b>, flat bases and
          cup-and-handles, entries off <b>stage-2</b> advances, relative strength, and a
          stop you set before you enter. Log those and the journal will tell you which
          of them earns.
        </p>
        <Link className="mk-cta" href="/dashboard">Start your journal — it&apos;s free</Link>
        <p className="mk-note">No card. Export or delete everything whenever you like.</p>

        {/* The only image loaded eagerly — it is above the fold, and lazy
            loading something already in view just delays it. Width and height
            are set so the browser reserves the space before the file arrives;
            without them the text below jumps when it lands, which is a Core
            Web Vital and would cost the ranking these are meant to help. */}
        <figure className="shot">
          <img src="/shots/dashboard-summary.jpg" width={1800} height={511}
               alt="A journal summary reading: 40 closed trades over 7 months, expectancy +0.24R per trade at a 42.5% win rate, for +9.73R total. Below it, headline numbers in rupees and in R — net P&L, win rate, profit factor, payoff ratio, average win and loss, maximum drawdown." />
          <figcaption>
            The dashboard, on a sample book. Every figure in R alongside the rupee one.
          </figcaption>
        </figure>
      </section>

      <section className="mk-sec">
        <h2>Charges worked out to the paisa</h2>
        <p>
          STT, exchange transaction charges, SEBI fees, stamp duty, GST and DP charges,
          computed the way your broker computes them — and taken from the file itself
          when you import a report that states them. Your real P&amp;L is the one after
          costs, so that is the one the journal keeps.
        </p>
      </section>

      <section className="mk-sec">
        <h2>Bring the trades you have already made</h2>
        <p>
          Import a tax P&amp;L or capital gains report from <b>Zerodha</b>, <b>Groww</b>{" "}
          or <b>Dhan</b>. The file says which broker it is, trades are matched by ISIN
          rather than by company name, and anything already in your journal is skipped.
          Every import can be undone.
        </p>
      </section>

      <section className="mk-sec">
        <h2>It records what you actually look at</h2>
        {/* The recognition moment, and the reason this section exists. A
            generic journal asks for symbol, price and quantity. Naming the
            fields is how somebody who trades this way learns in one glance
            that they will not be forcing their process into a spreadsheet
            built for somebody else's. */}
        <p>
          The base pattern — <b>VCP</b>, cup and handle, flat base, double bottom, high
          tight flag, ascending base. The <b>Weinstein stage</b> it was in. Its{" "}
          <b>RS rank</b> on the day you bought. How far the entry sat from the pivot,
          and what the breakout volume was against its thirty-day average.
        </p>
        <p>
          None of that is decoration. Every one of them becomes a cut of your own
          record: expectancy by pattern, by stage, by how far you chased the pivot, by
          how tight the stop was. That is the difference between a list of trades and
          knowing which setup to take tomorrow.
        </p>
        <p>
          Alongside it: position sizing from your account size and risk percentage, an
          open-risk reading across every holding, and the R distribution once you have
          enough trades to mean anything. Your chart and your notes stay with the trade.
        </p>

        <figure className="shot">
          <img src="/shots/edge-by-pattern.jpg" width={1800} height={578} loading="lazy" decoding="async"
               alt="A table of base patterns ranked by expectancy: Flat Base +0.92R over 6 trades, Ascending Base +0.72R over 16, and at the bottom Pullback Entry at −0.84R and High Tight Flag at −0.59R. Rows with fewer than fifteen trades are faded as noise rather than signal." />
          <figcaption>
            The same trades cut by setup. Two patterns paying, three losing — which is the
            question the rupee column cannot answer.
          </figcaption>
        </figure>
      </section>

      <section className="mk-sec">
        <h2>Questions</h2>
        <dl className="mk-faq">
          {FAQ.map(({ q, a }) => (
            <div key={q}>
              <dt>{q}</dt>
              <dd>{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="mk-foot">
        <SignedInLink />
        {/* First among the content links because it is the only one a stranger
            has a reason to open before signing up for anything. */}
        <Link href="/expectancy-calculator">Expectancy calculator</Link>
        <Link href="/learn">Guides</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        {/* Between Terms and Contact on purpose: somebody heading for Contact
            is about to ask a question, and this is where most of the answers
            already are. It existed and was linked from nowhere. */}
        <Link href="/support">Help</Link>
        <Link href="/contact">Contact</Link>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          © {new Date().getFullYear()} <Wordmark size={13} showMark={false} />
        </span>
      </footer>
    </main>
  );
}
