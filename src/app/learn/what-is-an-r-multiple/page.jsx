import Link from "next/link";
import { BRAND } from "@/lib/brand";

/**
 * The first article, and the one the whole product rests on.
 *
 * Written to answer the question rather than to advertise. Somebody typing
 * "what is an R multiple" wants the arithmetic and a worked example; if the
 * page gives them that, the link at the bottom is a reasonable next step, and
 * if it does not, no amount of linking will help.
 *
 * A server component, like /support and /privacy — the whole point is that a
 * crawler and a reader receive the same thing.
 *
 * ON THE TRAILING-STOP SECTION. Most writing on this asserts that 1R must be
 * pinned at entry so trailing cannot rebase it. This journal deliberately does
 * the opposite: one stop, which is the risk that was taken, changed only when
 * it was recorded wrong. The article says both honestly rather than presenting
 * a house decision as universal law — a page that quietly redefines a common
 * term to match its own product is the kind of thing that gets noticed.
 */

const url = BRAND.domain ? `https://${BRAND.domain}/learn/what-is-an-r-multiple` : undefined;
const TITLE = "What is an R multiple, and why rupees mislead you";
const DESC =
  "R is your profit or loss divided by what you risked. It is what makes a " +
  "₹8,000 win and a ₹40,000 win comparable — and usually shows the smaller one " +
  "was the better trade. With worked examples for Indian equity.";

export const metadata = {
  title: `${TITLE} — ${BRAND.name}`,
  description: DESC,
  keywords: [
    "R multiple", "what is R multiple trading", "risk multiple",
    "expectancy trading", "position sizing India", "1R",
  ],
  ...(url ? { alternates: { canonical: url } } : {}),
  openGraph: { title: TITLE, description: DESC, type: "article", ...(url ? { url } : {}) },
};

export default function RMultiplePage() {
  return (
    <article className="legal art">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Article",
        headline: TITLE,
        description: DESC,
        ...(url ? { mainEntityOfPage: url } : {}),
        author: { "@type": "Organization", name: BRAND.name },
        publisher: { "@type": "Organization", name: BRAND.name },
      }) }} />

      <div className="legal-top">
        <span className="disp" style={{ fontSize: 16 }}>{BRAND.name}</span>
        <Link className="legal-back" href="/">← Back</Link>
      </div>

      <h1 className="disp">{TITLE}</h1>
      <p className="legal-lede">
        You made ₹8,000 on one trade and ₹40,000 on another. Which was the better
        trade? Almost everyone answers the second one, and almost everyone is wrong
        about half the time — because the rupee figure leaves out the only thing that
        makes two trades comparable.
      </p>

      <h2>What R actually is</h2>
      <p>
        <b>R is one unit of risk.</b> Not the money you put in — the money you stood
        to lose if the trade went against you and your stop was hit.
      </p>
      <p>
        For one position it is the distance from your entry to your stop, multiplied
        by how many shares you hold:
      </p>
      <pre className="art-eq">
{`1R  =  (entry price − stop price) × quantity

R multiple  =  profit or loss ÷ 1R`}
      </pre>
      <p>
        A trade that makes twice what you risked is <b>+2R</b>. One that loses exactly
        what you planned to is <b>−1R</b>. One stopped out for slightly more than
        planned, because the price gapped through your stop, is −1.3R — and that
        overshoot is worth seeing, which a rupee figure hides.
      </p>

      <h2>The two trades, worked through</h2>
      <p>Take the pair from the opening, with real arithmetic.</p>

      <div className="art-two">
        <div>
          <h3>Trade A — the ₹8,000 win</h3>
          <ul>
            <li>Buy 200 shares at ₹620</li>
            <li>Stop at ₹600 — risking ₹20 a share</li>
            <li><b>1R = 20 × 200 = ₹4,000</b></li>
            <li>Sold at ₹660 → profit ₹8,000</li>
            <li><b>= +2R</b></li>
          </ul>
        </div>
        <div>
          <h3>Trade B — the ₹40,000 win</h3>
          <ul>
            <li>Buy 500 shares at ₹1,200</li>
            <li>Stop at ₹1,120 — risking ₹80 a share</li>
            <li><b>1R = 80 × 500 = ₹40,000</b></li>
            <li>Sold at ₹1,280 → profit ₹40,000</li>
            <li><b>= +1R</b></li>
          </ul>
        </div>
      </div>

      <p>
        Trade B made five times the money. Trade A was <b>twice the trade</b>. To earn
        that ₹40,000, B put ₹40,000 at risk — it returned exactly what it risked. A
        returned double.
      </p>
      <p>
        Now run each thirty times. Thirty of A, at the same win rate, compounds. Thirty
        of B breaks even before costs. The rupee column would have told you B was your
        best setup and to do more of it.
      </p>

      <h2>What R lets you see that rupees cannot</h2>
      <h3>Whether your system actually pays</h3>
      <p>
        Once every trade is in R you can average them, which you cannot honestly do
        with rupees across positions of different sizes. That average is your{" "}
        <b>expectancy</b> — what one trade is worth, before you know how it turns out:
      </p>
      <pre className="art-eq">
{`expectancy = (win rate × average win) − (loss rate × average loss)

50% wins at +2R, 50% losses at −1R
   = (0.50 × 2) − (0.50 × 1)
   = +0.5R per trade`}
      </pre>
      <p>
        Half your trades losing, and the system still pays half a unit of risk every
        time you take one. That is the number worth knowing, and it only exists in R.
      </p>

      <figure className="shot">
        <img src="/shots/performance-by-period.jpg" width={1800} height={535} loading="lazy" decoding="async"
             alt="Performance by financial year: FY26 with 17 trades at −0.11R expectancy and a 29% win rate, FY27 with 23 trades at +0.51R and 52%. Total R, net P&L, average risk and maximum drawdown for each." />
        <figcaption>
          Expectancy per financial year. The same account, one year losing and one
          paying — visible because both are in R.
        </figcaption>
      </figure>

      <h3>Which setups deserve your money</h3>
      <p>
        Sort your trades by pattern, or by how far price was extended when you entered,
        or by how long you held. In rupees the answer is dominated by whichever trades
        happened to be large. In R, a flat base and a pullback compare directly even if
        one was a ₹50,000 position and the other ₹5 lakh.
      </p>

      <h3>How big the next position should be</h3>
      <p>
        R makes sizing arithmetic instead of instinct. Decide what one loss may cost —
        say 0.5% of a ₹20 lakh account, so ₹10,000 — and the quantity falls out:
      </p>
      <pre className="art-eq">
{`quantity = risk budget ÷ (entry − stop)
         = 10,000 ÷ (620 − 600)
         = 500 shares`}
      </pre>
      <p>
        A wider stop buys fewer shares. That is the mechanism that stops a volatile
        stock quietly becoming your largest position.
      </p>

      <h2>Three things that trip people up</h2>

      <h3>1. Costs are part of the answer</h3>
      <p>
        An R computed on gross profit flatters every trade. In Indian equity the round
        trip carries STT on both legs of a delivery trade, exchange transaction charges
        (which differ between NSE and BSE), the SEBI turnover fee, stamp duty on the buy,
        GST on brokerage and fees, and a DP charge on every sell. On a small position
        those can be a meaningful slice of a 1R move.
      </p>
      <p>
        <b>Measure R on what actually reached your account.</b> A setup that looks
        marginally profitable gross is often losing net, and that is exactly the setup
        worth catching.
      </p>

      <h3>2. Selling in parts does not change the trade</h3>
      <p>
        Sell a third at +3R and the rest later, and the position is still one decision
        with one risk. 1R was fixed when you entered; it does not shrink because you
        took some off. Recording each tranche as its own trade triples your trade count
        and gives each fragment its own R against a position you only sized once.
      </p>

      <h3>3. Moving your stop up</h3>
      <p>
        Here the honest answer is that there are two schools, and you should pick
        deliberately.
      </p>
      <p>
        Most writing says <b>pin 1R at entry</b>: you sized the position against that
        risk, so raising your stop later should not retroactively change what the trade
        risked.
      </p>
      <p>
        The other view — the one {BRAND.name} takes — is that a trade has{" "}
        <b>one stop</b>: the risk you actually took. Trailing happens at your broker,
        where it belongs, and the number in the journal changes only when it was
        recorded wrong. That keeps a mistyped stop from permanently distorting every R
        that follows, at the cost of showing more open risk than a protected position
        really carries.
      </p>
      <p>
        Either is defensible. Holding both at once is not, and that is the mistake to
        avoid: two stops in one record means every R figure depends on which one a
        given screen happened to read.
      </p>

      <h2>Where to start</h2>
      <p>
        You need three numbers per trade — entry, stop, quantity — and the discipline to
        record the stop <i>before</i> you know how it ended. That last part is the whole
        difficulty: a stop invented afterwards is a story, and it makes every R downstream
        fiction.
      </p>
      <p>
        Roughly twenty trades in, expectancy starts to mean something. Before that you
        are reading noise.
      </p>

      <div className="art-cta">
        <p>
          <b>{BRAND.name}</b> measures every trade in R, works Indian charges out to the
          paisa, and imports the trades you have already made from your broker&rsquo;s tax
          P&amp;L.
        </p>
        <Link className="mk-cta" href="/dashboard">Start your journal — it&apos;s free</Link>
      </div>

      <p className="sp-foot">
        <Link href="/">Home</Link>{" · "}
        <Link href="/support">Common questions</Link>{" · "}
        <Link href="/privacy">Privacy</Link>
      </p>
    </article>
  );
}
