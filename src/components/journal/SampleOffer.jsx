"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, Upload } from "lucide-react";

/**
 * The way back into a full app, for a journal that has none of its own.
 *
 * The sample book shows itself to a new account — but the moment it is
 * cleared, every screen turns into a sentence explaining what would be here
 * if there were anything: Holdings says nothing is held, Analysis says it
 * needs closed trades, Performance says close one and the record starts. All
 * true, and all of it leaves somebody deciding whether to keep the app
 * looking at an app that does nothing.
 *
 * So it sits in the SAME SLOT as the sample banner, above whichever screen
 * is being read, and appears only when there is nothing of the user's to show
 * and no sample showing either. One click brings the book back; the banner
 * then replaces this, and carries the way out again.
 */
export default function SampleOffer({ onShow }) {
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (busy) return;
    setBusy(true);
    try { await onShow(); } finally { setBusy(false); }
  };

  return (
    <div className="so" role="status">
      <Eye size={15} />
      <p>
        <b>Nothing here yet.</b> Every screen fills in from your trades — so until
        there are some, there is nothing to look at. Borrow a made-up book to see
        what each page does. None of it is saved, and yours are never touched.
      </p>
      <div className="so-acts">
        <button className="btn sm" onClick={go} disabled={busy}>
          {busy ? "Loading…" : "Show me a sample journal"}
        </button>
        <Link href="/import" className="btn ghost sm"><Upload size={12} />Import mine</Link>
      </div>

      <style jsx>{`
        .so {
          display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
          border: 1px solid var(--rule); background: var(--card);
          border-radius: 3px; padding: 11px 14px; margin-bottom: 18px;
          color: var(--ink2);
        }
        .so :global(svg) { flex: none; }
        .so p { flex: 1 1 340px; margin: 0; font-size: 12.5px; line-height: 1.6; }
        .so b { font-weight: 600; color: var(--ink); }
        .so-acts { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      `}</style>
    </div>
  );
}
