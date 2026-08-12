"use client";

import { useState } from "react";
import { Info, X } from "lucide-react";

/**
 * The sign that none of this is yours.
 *
 * ON EVERY SCREEN, not just the dashboard. Somebody who lands on Trades and
 * finds forty rows with no warning has simply found their journal, apparently
 * already full. The screen where it matters most is Performance, because that
 * is where invented numbers look most like findings.
 *
 * ONE CLICK, NO CONFIRMATION. Two warnings exist to protect real data; this
 * data was never theirs, cost nothing, and is regenerated from a seed rather
 * than deleted. Asking twice would only teach the habit of clicking through
 * warnings — which is exactly the reflex you do not want trained before
 * somebody meets the real delete-account dialog.
 *
 * It also goes by itself the moment a real trade exists, so nobody has to
 * dismiss anything to stop their first genuine trade being averaged in with
 * fiction.
 */
export default function DemoBanner({ onDismiss }) {
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (busy) return;
    setBusy(true);
    try { await onDismiss(); } finally { setBusy(false); }
  };

  return (
    <div className="db" role="status">
      <Info size={15} />
      <p>
        <b>This is sample data.</b> A made-up book so the charts have something to
        show. It disappears the moment you log a trade of your own — nothing here
        is saved, and none of it counts towards your figures.
      </p>
      <button className="btn ghost sm" onClick={go} disabled={busy}>
        <X size={13} />{busy ? "Clearing…" : "Clear sample data"}
      </button>

      <style jsx>{`
        .db {
          display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
          border: 1px solid var(--brass); background: #FBF6EA;
          border-radius: 3px; padding: 11px 14px; margin-bottom: 18px;
          color: #6A4E12;
        }
        .db :global(svg) { flex: none; }
        .db p {
          flex: 1 1 340px; margin: 0; font-size: 12.5px; line-height: 1.6;
        }
        .db b { font-weight: 600; }
      `}</style>
    </div>
  );
}
