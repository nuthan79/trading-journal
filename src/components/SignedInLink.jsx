"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * "Sign in", or "Open your journal" if there is already a session.
 *
 * WHY THIS EXISTS. `/` used to be the app, so anyone signed in who typed the
 * bare domain landed in their journal. Since it became a static marketing page
 * they land on an advertisement for a product they already use, with a Sign in
 * link in the corner — which reads exactly like being signed out, and is what
 * a returning user reports as "login is broken".
 *
 * The same landing happens after Google sign-in and after clicking an email
 * confirmation link, both of which return to the site root.
 *
 * DELIBERATELY DOES NOT IMPORT THE SUPABASE CLIENT. This is the one page on
 * the domain with no client bundle worth speaking of, and pulling in
 * supabase-js to decide the wording of one link would cost about 40KB on the
 * page whose speed matters most. Supabase persists the session under a
 * localStorage key of the form `sb-<project>-auth-token`, so the presence of
 * one is enough to know somebody has signed in here before.
 *
 * It cannot tell a live session from an expired one, and does not need to:
 * /dashboard resolves that properly and shows the sign-in form if the token is
 * stale. The worst case is offering "Open your journal" to somebody who then
 * has to sign in — which is where they were headed anyway.
 *
 * Renders the signed-out wording until the effect runs, so the server HTML and
 * the first client render agree and hydration does not warn.
 */
export default function SignedInLink({ className }) {
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    try {
      const found = Object.keys(window.localStorage).some(
        (k) => /^sb-.*-auth-token$/.test(k) && window.localStorage.getItem(k)
      );
      setHasSession(found);
    } catch {
      // Private mode denies localStorage. Signed-out wording is the safe answer.
    }
  }, []);

  return (
    <Link className={className} href="/dashboard">
      {hasSession ? "Open your journal" : "Sign in"}
    </Link>
  );
}
