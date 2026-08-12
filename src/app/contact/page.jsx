import LegalShell from "@/components/LegalShell";
import ContactForm from "@/components/ContactForm";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: `Contact — ${BRAND.name}`,
  description: `Get in touch with ${BRAND.name}.`,
};

/**
 * Reusing LegalShell is deliberate. Privacy, Terms and Contact are the three
 * pages a stranger checks before trusting a site with their trading records,
 * and they should feel like the same place — a contact page in a different
 * visual language reads as an afterthought bolted on.
 */
export default function ContactPage() {
  return (
    <LegalShell
      title="Contact"
      updated="12 August 2026"
      lede={`Questions, problems, or something you wish ${BRAND.name} did. It is built and run by one person, so replies take a day or two — but they do come.`}
    >
      <h2>Send a message</h2>
      <div style={{ marginTop: 16 }}>
        <ContactForm />
      </div>

      <h2>Or email directly</h2>
      <p>
        {BRAND.contactEmail ? (
          <>
            <a href={`mailto:${BRAND.contactEmail}`}>{BRAND.contactEmail}</a> — the same
            inbox the form writes to. Worth using instead if the site itself is what
            has gone wrong.
          </>
        ) : (
          <>A contact address has not been set yet.</>
        )}
      </p>

      <h2>What this is not</h2>
      <p>
        {BRAND.name} keeps a record of trades you have already made. It cannot give
        advice on what to buy or sell, and questions asking for it will not get an
        answer — not out of unhelpfulness, but because it would be neither legal nor
        honest. For anything about your money in your broker account, your broker is
        the one who can act.
      </p>

      <h2>Reporting something private</h2>
      <p>
        If you have found a security problem, or a way to see data that is not yours,
        please write rather than posting it publicly, and describe what you did. It
        will be taken seriously and you will get a reply.
      </p>
    </LegalShell>
  );
}
