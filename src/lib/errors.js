"use client";

import { supabase } from "./db";

/**
 * Where a crash goes.
 *
 * ONE SEAM, like quotes.js and Analytics.jsx. Everything that catches an error
 * calls this and nothing else knows where reports end up, so moving to Sentry
 * later is this file and no other — which is the whole reason it exists rather
 * than four components each writing their own insert.
 *
 * SILENT ON EVERY FAILURE PATH, exactly like track(). Reporting that a page
 * broke must not itself break the page, and the reasons it might fail are the
 * same ones: signed out, offline, 025 not run, RLS refusing the row. All of
 * them end with the app carrying on.
 *
 * WHAT IT DELIBERATELY DOES NOT SEND. No form values, no journal content, no
 * query string. A crash in the trade form must not post somebody's position
 * size into a table that was never meant to hold it. The message and the stack
 * are the app's own text; the path is the route without its parameters.
 */

/**
 * One row per fault, not one per catcher.
 *
 * Keyed on where and what, deliberately not on which listener caught it. A
 * render crash is seen by the error boundary AND by window.onerror — testing
 * this produced two rows for one throw, which would have quietly doubled every
 * count in the "what is breaking" query and made a single bug look like a
 * pattern. The same message on a different page is still a different fault, so
 * the path stays in the key.
 *
 * Also stops a component that throws on every render from writing a row per
 * frame, which is what this started out as.
 */
const seen = new Set();

export function reportError(error, { source = "unknown", path } = {}) {
  (async () => {
    try {
      const message = String(error?.message || error || "Unknown error").slice(0, 500);
      // pathname only. The query string is where ids and filters live.
      const where = path ?? (typeof location !== "undefined" ? location.pathname : null);
      const key = `${where}:${message}`;
      if (seen.has(key)) return;
      seen.add(key);

      const { data } = await supabase.auth.getSession();
      const uid = data?.session?.user?.id;
      if (!uid) return;                     // see 025 — signed-in only, on purpose

      await supabase.from("client_errors").insert({
        user_id: uid,
        message,
        source,
        path: where,
        stack: error?.stack ? String(error.stack).slice(0, 4000) : null,
      });
    } catch {
      /* deliberately silent — see above */
    }
  })();
}

/**
 * The two things a React error boundary never sees: an exception thrown
 * outside rendering, and a promise nobody caught. Between them they are most
 * of what actually breaks in a client app — a failed fetch, a null deref in an
 * event handler — and all of it would otherwise be invisible.
 *
 * Returns its own cleanup so a caller in an effect can hand it straight back.
 */
export function listenForErrors() {
  if (typeof window === "undefined") return () => {};

  const onError = (e) =>
    reportError(e.error || e.message, { source: "window.onerror" });
  const onRejection = (e) =>
    reportError(e.reason, { source: "unhandledrejection" });

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
