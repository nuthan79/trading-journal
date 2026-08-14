"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/errors";

/**
 * What a user sees when a page throws.
 *
 * Before this, a crash inside the journal blanked the screen and told nobody —
 * so the first thing a launch would have measured is people leaving, with no
 * way to tell whether the app was not for them or whether it broke in front of
 * them.
 *
 * IT DOES NOT SHOW THE ERROR. A stack trace across the page reads as "this
 * software is broken and you are on your own", which is worse than what is
 * actually true: one screen failed and the rest still works. The message is
 * reported instead, and the two ways out — try again, or go somewhere that
 * works — are both offered.
 *
 * NOTHING HERE IS REASSURING ABOUT THE DATA WITHOUT REASON. It says the
 * journal is safe because it is: this boundary catches rendering, and rendering
 * happens after a save has already been written or already failed loudly.
 */
export default function AppError({ error, reset }) {
  useEffect(() => {
    reportError(error, { source: "app/error" });
  }, [error]);

  return (
    <div className="wrap" style={{ maxWidth: 460 }}>
      <div className="eyebrow">Something broke</div>
      <h1 className="disp" style={{ fontSize: 22, margin: "8px 0 0" }}>
        This screen didn&rsquo;t load.
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--ink2)", margin: "14px 0 0" }}>
        Your journal is fine — nothing was being saved when this happened, and the
        other screens should still work. The fault has been recorded so it can be
        fixed.
      </p>

      <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
        <button className="btn" onClick={() => reset()}>Try again</button>
        <a className="btn ghost" href="/dashboard" style={{ textDecoration: "none" }}>
          Back to the dashboard
        </a>
      </div>

      {error?.digest && (
        <p className="hint" style={{ marginTop: 18 }}>
          Reference {error.digest}
        </p>
      )}
    </div>
  );
}
