import Link from "next/link";
import ContactForm from "@/components/ContactForm";
import Wordmark from "@/components/Wordmark";
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
    a: "It disappears the moment you log a trade of your own. None of it was ever " +
       "saved — it was generated in your browser so the charts had something to " +
       "show, and it never counted towards your figures. If you want it back to " +
       "keep exploring, My profile → Sample data switches it on again; your own " +
       "trades are hidden from view while it is showing and come straight back " +
       "when you turn it off. Nothing of yours is deleted either way.",
  },
  {
    q: "I imported a file and a stock I hold is missing. Where did it go?",
    a: "The import history on the Import page keeps a record of every file and what " +
       "it decided, and you can search it by symbol — type the stock's name and it " +
       "will tell you which import saw it and what happened. The usual answers: it " +
       "was already in your journal so it was not added twice; the quantity in the " +
       "file disagreed with what you hold, so nothing was changed rather than " +
       "guessed at; or it is a free holding from a bonus or demerger, which a tax " +
       "P&L lists but cannot record as a trade because there is no sale.",
  },
  {
    q: "My tax P&L will not import — it says it is not a report you can read.",
    a: "Most often it is the wrong Zerodha report. Console offers a P&L Statement " +
       "and a Tax P&L, and the first is the more obvious download — but it " +
       "summarises by scrip and has no per-trade dates, so there is nothing to " +
       "build a trade from. The one to use is Console → Reports → Tax P&L, which " +
       "has a Tradewise Exits sheet. The app will tell you if that is what " +
       "happened.",
  },
  {
    q: "Can I import the same file twice by mistake?",
    a: "You can drop it in as often as you like. Closed trades are matched on the " +
       "position rather than the row, so re-importing an overlapping year skips " +
       "what is already there; holdings are matched by symbol. If a file adds " +
       "nothing you will be told so before anything is written, and every import " +
       "can be undone from the import history afterwards.",
  },
  {
    q: "Why are my imported trades showing a stop I never set?",
    a: "Because a tax P&L does not record stops, and without one a trade has no 1R " +
       "— which means no R, no expectancy, and a journal that looks broken. So an " +
       "import offers to assume one a fixed percentage below entry, and every trade " +
       "it does that to is marked assumed. Those are excluded from the discipline " +
       "statistics, and the Stops page lists them for replacing with what you " +
       "actually used. You can also turn the assumption off at import and leave " +
       "them empty.",
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
        {/* The component, not the string. This strip was copied from
            LegalShell, which renders <Wordmark>, but the name arrived here as
            bare text in a .disp span — so support was the one public page
            showing no mark and no brass on the RR, which is most of what the
            lockup is for. */}
        <Wordmark size={16} />
        <Link className="legal-back" href="/">← Back</Link>
      </div>

      <h1 className="disp sp-h1">Ask, or tell us what&rsquo;s wrong.</h1>
      <p className="sp-lede">
        {BRAND.name} is built and run by one person, so replies take a day or two —
        but they do come. If something is broken, saying what you were doing when it
        happened is worth more than anything else you can write.
      </p>

      <ContactForm />

      {/**
        * The guide, above the questions.
        *
        * Written for the person with years of trades already made, because that
        * is the hardest first hour this app has and the one most likely to end
        * in giving up. It is also the half nobody can guess: logging a trade is
        * self-explanatory, and knowing that three different broker files do
        * three different jobs is not.
        *
        * Plain prose in the markup rather than an accordion, so it is readable
        * by somebody who arrived from a search engine having never heard of
        * this app — which is most of the traffic this page can win.
        */}
      <h2 className="sp-faqhead">Bringing trades you have already made</h2>
      <p className="sp-p">
        Your broker exports three different files, and they do three different
        jobs. Most people need the first two; the third is optional and fills in
        a gap the others leave.
      </p>

      <div className="sp-table-wrap">
        <table className="sp-table">
          <thead>
            <tr><th>File</th><th>What it brings</th><th>Where it comes from</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><b>Tax P&amp;L</b><br /><span className="sp-dim">capital gains report</span></td>
              <td>Every trade you have <b>closed</b>, with the real charges your
                  broker actually took.</td>
              <td>Zerodha: Console → Reports → Tax P&amp;L.<br />
                  Groww and Dhan: the capital gains report.</td>
            </tr>
            <tr>
              <td><b>Holdings</b></td>
              <td>Everything you are <b>still holding</b>, with quantity and average
                  cost. No broker&rsquo;s holdings file records the date you bought,
                  so those arrive marked <i>assumed</i>.</td>
              <td>Zerodha: Console → Holdings, or the download arrow on Kite&rsquo;s
                  Holdings tab.</td>
            </tr>
            <tr>
              <td><b>Tradebook</b><br /><span className="sp-dim">optional</span></td>
              <td><b>Nothing new.</b> It is read only to fill in the purchase dates
                  your holdings arrived without.</td>
              <td>Zerodha: Console → Reports → Tradebook.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="sp-p">
        Drop any of them into <b>Import</b> and the file is identified by reading
        it — there is nothing to choose. Nothing is written until you have seen a
        preview of exactly what will land, and every import can be undone
        afterwards from the import history.
      </p>

      <h3 className="sp-h3">Do it in this order</h3>
      <ol className="sp-list">
        <li><b>Tax P&amp;L first.</b> It carries the real charges, so anything it
            covers is recorded properly rather than estimated.</li>
        <li><b>Then holdings</b>, for the positions you are still in. Trades already
            in your journal are matched by symbol and skipped, so nothing doubles.</li>
        <li><b>Then the tradebook</b>, if you have one, to replace the invented
            purchase dates with the real ones.</li>
      </ol>

      <h3 className="sp-h3">Two things arrive as guesses, and say so</h3>
      <p className="sp-p">
        A broker report records what you bought and sold. It has no idea what you
        were <i>risking</i>, and a holdings file does not say when you bought.
        Rather than leave those blank — which would make half the app read as
        empty — both are filled in and <b>marked as assumed</b>, in the trade sheet
        and on the holdings page.
      </p>
      <p className="sp-p">
        The marking is not decoration. An assumed stop is left out of the
        discipline statistics, and an assumed date is not counted as a holding
        period, so neither can quietly become a finding. Correcting either one
        anywhere clears the mark and it starts counting. The <b>Stops</b> page
        lists everything still waiting.
      </p>

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
