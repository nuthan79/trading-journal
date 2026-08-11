"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/errors";

/**
 * The last resort: a throw in the root layout itself, which the per-segment
 * boundary never gets to see because the boundary lives inside it.
 *
 * It has to render its own <html> and <body> — Next replaces the whole
 * document here, so there is no layout left to inherit from. That also means
 * no globals.css and no fonts, which is why the styling is inline and plain.
 * A page that fails to style itself while apologising for failing is worse
 * than a plain one.
 */
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    reportError(error, { source: "global-error" });
  }, [error]);

  return (
    <html lang="en">
      <body style={{
        margin: 0, minHeight: "100vh", background: "#EDF0EE", color: "#131C1A",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}>
        <div style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 21, margin: 0, letterSpacing: "0.01em" }}>
            The app didn&rsquo;t start.
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#4A5A56", margin: "14px 0 0" }}>
            Something failed before any page could load. Your journal is untouched —
            this is the app failing to open, not your records. Reloading usually
            fixes it.
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 22, padding: "10px 18px", fontSize: 12, fontWeight: 600,
              letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer",
              background: "#131C1A", color: "#EDF0EE", border: "1px solid #131C1A",
              borderRadius: 2, fontFamily: "inherit",
            }}>
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
