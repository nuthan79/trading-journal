import LegalShell from "@/components/LegalShell";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: `Terms of Use — ${BRAND.name}`,
  description: `The terms you agree to when you use ${BRAND.name}.`,
};

const UPDATED = "11 August 2026";

export default function TermsPage() {
  const mail = BRAND.contactEmail;

  return (
    <LegalShell
      title="Terms of Use"
      updated={UPDATED}
      lede={`By creating an account you agree to these terms. The important one, and the reason it is first: ${BRAND.name} records what you have already decided to do. It does not tell you what to buy.`}
    >
      <h2>1. This is not investment advice</h2>
      <p>
        {BRAND.name} is a record-keeping and analysis tool for trades you have
        chosen and executed yourself, elsewhere.
      </p>
      <ul>
        <li>It does not recommend securities, and never will.</li>
        <li>It does not place, route or execute orders. It is not a broker and holds no money or securities.</li>
        <li>It is not registered with SEBI as an investment adviser or a research analyst, and nothing in it should be read as advice from one.</li>
        <li>
          Statistics it shows you — win rate, expectancy, R multiples, projections —
          describe what has already happened in your own records. They are not
          predictions, and past results do not indicate future results.
        </li>
      </ul>
      <p>
        <b>Every trading decision is yours alone, and so is every loss.</b>
      </p>

      <h2>2. The numbers, and their limits</h2>
      <p>
        The figures come from what you enter, so they are only as good as what you
        type. In particular:
      </p>
      <ul>
        <li>
          <b>Charges are computed estimates.</b> They use published statutory rates and
          the broker settings you configured. Your broker&rsquo;s contract note is the
          authority, not this app.
        </li>
        <li>
          <b>This is not a tax record.</b> Do not file returns from it. Use your
          broker&rsquo;s statements and your own advisor.
        </li>
        <li>
          <b>Market prices are indicative</b>, sourced from a third party, delayed, and
          may be wrong or missing. Never trade off a price shown here.
        </li>
      </ul>

      <h2>3. Your account</h2>
      <p>
        Keep your login details to yourself; anything done through your account is
        treated as done by you. Give a real email address — if you lose access to
        it, we may not be able to get you back into your account. Tell us promptly
        if you think someone else is using your account.
      </p>
      <p>One person, one account. Do not share an account.</p>

      <h2>4. What you may not do</h2>
      <ul>
        <li>Break the law, or use the service to help anyone else do so.</li>
        <li>Try to reach data that is not yours, or probe or attack the service.</li>
        <li>Automate access in a way that loads the service unreasonably, or scrape it.</li>
        <li>Resell or rebrand the service.</li>
        <li>Upload anything unlawful, or anything you have no right to upload.</li>
      </ul>

      <h2>5. Your data belongs to you</h2>
      <p>
        The trades, notes and charts you enter are yours. You grant us only the
        permission needed to run the service — to store your data, and to show it
        back to you. We claim no other rights over it, and you can export it or
        delete your account whenever you like.
      </p>
      <p>
        The software, design and name of {BRAND.name} remain ours.
      </p>

      <h2>6. Availability</h2>
      <p>
        The service is provided as it is, with no promise of uptime. It may be
        unavailable for maintenance, or because a provider we depend on is down.
        Features may change or be withdrawn. We will try not to lose your data and
        we keep backups, but you should keep your own exports of anything you
        cannot afford to lose.
      </p>

      <h2>7. Ending it</h2>
      <p>
        You can stop using {BRAND.name} and delete your account at any time. We may
        suspend or close an account that breaches these terms, or if we stop
        offering the service — in which case we will give reasonable notice and a
        chance to export your data first.
      </p>

      <h2>8. Liability</h2>
      <p>
        To the fullest extent the law allows, {BRAND.name} and its operator are not
        liable for trading losses, lost profits, or any indirect or consequential
        loss arising from your use of the service — including from an error in a
        calculation, an incorrect price, or the service being unavailable.
      </p>
      <p>
        Nothing here limits liability that cannot lawfully be limited.
      </p>

      <h2>9. Governing law</h2>
      <p>
        These terms are governed by the laws of India, and the courts of India have
        exclusive jurisdiction over any dispute arising from them.
      </p>

      <h2>10. Changes</h2>
      <p>
        We may revise these terms. The date at the top will change and we will say
        so in the app. If you keep using {BRAND.name} afterwards, the revised terms
        apply.
      </p>

      <h2>11. Contact</h2>
      <p>
        {mail
          ? <>Questions about these terms go to <a href={`mailto:${mail}`}>{mail}</a>.</>
          : <>A contact address has not been set yet. It must be before these terms are published.</>}
      </p>
    </LegalShell>
  );
}
