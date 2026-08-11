import LegalShell from "@/components/LegalShell";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: `Privacy Policy — ${BRAND.name}`,
  description: `What ${BRAND.name} collects, why, and who else can see it.`,
};

const UPDATED = "11 August 2026";

export default function PrivacyPage() {
  const mail = BRAND.contactEmail;

  return (
    <LegalShell
      title="Privacy Policy"
      updated={UPDATED}
      lede={`${BRAND.name} holds your trading records, which are personal and financial. This page says exactly what is collected, where it is kept, and who else can see any part of it. It describes what the software actually does — not what would be convenient to claim.`}
    >
      <h2>Who is responsible</h2>
      <p>
        {BRAND.name} is operated from India by the individual who runs this service.
        Under the Digital Personal Data Protection Act, 2023, they are the Data
        Fiduciary for the personal data described below.
        {mail ? <> Questions and grievances go to <a href={`mailto:${mail}`}>{mail}</a>.</> : null}
      </p>

      <h2>What is collected</h2>

      <h3>Your account</h3>
      <p>
        Your email address. If you sign in with Google, Google also gives us the
        name and profile picture on your Google account. We never see or store
        your Google password. If you set a password with us, it is stored only as
        a one-way hash by our authentication provider — nobody at {BRAND.name}, or
        anywhere else, can read it back.
      </p>

      <h3>What you put in the journal</h3>
      <p>
        Everything you enter: trades, entry and exit prices, quantities, stop
        losses, dates, brokerage and charge settings, your account size and risk
        preferences, diary entries, the emotions you tag them with, capital
        added or withdrawn, and any chart images or chart links you attach.
      </p>

      <h3>Technical records</h3>
      <p>
        Our hosting and database providers keep server logs that include your IP
        address, browser type and the pages requested, for security and
        diagnostics. If page analytics are enabled, they record anonymous page
        views. They do not use cookies, do not fingerprint your device, and
        cannot identify you.
      </p>
      <p>
        Your sign-in session is stored in your own browser&rsquo;s local storage. It
        is not a tracking cookie and is not sent to anyone else.
      </p>

      <h2>Why it is collected</h2>
      <ul>
        <li>To give you an account and keep you signed in.</li>
        <li>To store and show your journal — this is the service itself.</li>
        <li>To compute your statistics. This happens in your browser or on our server, never by sending your data elsewhere.</li>
        <li>To keep the service working and secure, and to count how many people use it.</li>
      </ul>
      <p>
        Your trading data is <b>never</b> sold, rented, shared with advertisers,
        used to train any model, or used to build a profile of you.
      </p>

      <h2>Who else can see any of it</h2>
      <p>
        We use a small number of service providers. Each one is listed here with
        what it actually receives.
      </p>
      <ul>
        <li>
          <b>Supabase</b> — the database, authentication and file storage. It holds
          all of your account and journal data.
        </li>
        <li>
          <b>Vercel</b> — hosting. It sees the requests your browser makes, including
          your IP address.
        </li>
        <li>
          <b>Yahoo Finance</b> — where current market prices come from. Only the stock
          symbols are sent, and they are requested by our server, not your browser, so
          your IP address is not disclosed to them.
        </li>
        <li>
          <b>TradingView</b> — if you attach a TradingView chart snapshot, the image is
          loaded by your browser directly from TradingView&rsquo;s servers. TradingView
          can therefore see your IP address and which chart you are viewing. Nothing
          else about your journal is sent to them. If you would rather not have this,
          do not attach chart links.
        </li>
        <li>
          <b>Google</b> — only if you choose to sign in with Google, and only to
          authenticate you.
        </li>
        <li>
          <b>Our analytics provider</b>, if enabled — anonymous page view counts, with
          no cookies and no personal data.
        </li>
      </ul>
      <p>
        We will also disclose data if we are legally required to. Nothing else.
      </p>

      <h2>Where it is stored, and for how long</h2>
      <p>
        Data is held on our providers&rsquo; infrastructure. It stays for as long as
        your account exists. If you delete your account, your journal data is
        deleted with it. Provider backups and server logs may retain copies for a
        short period afterwards, in line with those providers&rsquo; own retention
        schedules.
      </p>

      <h2>How it is protected</h2>
      <ul>
        <li>All traffic uses HTTPS.</li>
        <li>
          Every table enforces row-level security, so a signed-in user&rsquo;s
          queries can only ever return their own rows. This is enforced by the
          database, not by the app.
        </li>
        <li>Uploaded chart images live in a private bucket and are served through short-lived signed links.</li>
        <li>Passwords are stored only as hashes.</li>
      </ul>
      <p>
        No system is perfectly secure, and we do not claim otherwise. If we ever
        become aware of a breach affecting your data, we will tell you and the
        Data Protection Board of India as the law requires.
      </p>

      <h2>Your rights</h2>
      <p>Under the Digital Personal Data Protection Act, 2023, you may:</p>
      <ul>
        <li>ask what personal data we hold about you and how it is processed;</li>
        <li>have inaccurate data corrected — most of it you can edit yourself, at any time;</li>
        <li>have your data erased, by deleting your account;</li>
        <li>nominate someone to exercise these rights if you die or become incapacitated;</li>
        <li>raise a grievance with us, and afterwards with the Data Protection Board of India.</li>
      </ul>
      <p>
        You can export your journal at any time. We would rather you were able to
        leave with your data than feel stuck with us.
      </p>

      <h2>Children</h2>
      <p>
        This service is not intended for anyone under 18, and we do not knowingly
        create accounts for children. If you believe a child has an account here,
        {mail ? <> write to <a href={`mailto:${mail}`}>{mail}</a> and</> : <> contact us and</>}{" "}
        it will be removed.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes in a way that affects you, the date at the top
        changes and we will say so in the app. Continuing to use {BRAND.name} after
        that means you accept the revised policy.
      </p>
    </LegalShell>
  );
}
