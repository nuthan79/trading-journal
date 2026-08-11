import Link from "next/link";
import { BRAND } from "@/lib/brand";

/**
 * The frame around the privacy policy and the terms.
 *
 * A server component with no styled-jsx and no hooks, on purpose. These two
 * pages sit outside the auth gate and are the only routes in the app that
 * render as static HTML — which is what a search engine reads, and what
 * Google's OAuth review actually fetches when it checks that the privacy URL
 * on the consent screen resolves to a real policy.
 */
export default function LegalShell({ title, updated, lede, children }) {
  return (
    <div className="legal">
      <div className="legal-top">
        <span className="disp" style={{ fontSize: 16 }}>{BRAND.name}</span>
        <Link className="legal-back" href="/">← Back</Link>
      </div>

      <h1 className="disp">{title}</h1>
      <p className="legal-date">Last updated {updated}</p>
      <p className="legal-lede">{lede}</p>

      {!BRAND.contactEmail && (
        <div className="legal-todo">
          <b>This policy is not finished.</b> It has no contact address, and Indian
          law requires one for a grievance to be raised. Set <code>contactEmail</code>{" "}
          in <code>src/lib/brand.js</code> before this page is published or shared.
        </div>
      )}

      {children}
    </div>
  );
}
