"use client";

import { ArrowLeft } from "lucide-react";
import { region as regionInfo, REGIONS } from "@/lib/regions";

/**
 * A market you do not have, and have nothing in.
 *
 * WHAT THIS REPLACES: an empty journal under two red warnings, which is what
 * somebody saw when they opened a market they had never bought. Every screen
 * said a version of "there is nothing here", and the overall impression was
 * of an app that had broken rather than of something worth having.
 *
 * So the switch still SHOWS every market — a market nobody can see is a
 * market nobody asks for — and opening one you do not hold says what it is,
 * rather than pretending to be your journal.
 *
 * NOT SHOWN TO SOMEBODY WHOSE ACCESS LAPSED WITH TRADES IN THERE. They have
 * a book to read, and taking it away would be the opposite of the rule:
 * writes blocked, reads kept.
 */
export default function RegionOffer({ region, state, onBack }) {
  const r = regionInfo(region);
  const home = REGIONS[0];

  return (
    <div className="sec ro">
      <div className="eyebrow">{r.label}</div>
      <h2>{state === "expired"
        ? `Your ${r.label} access has ended`
        : `${r.label} is not on your account yet`}</h2>

      <p>
        {state === "expired"
          ? <>You had this market and the access has run out. Nothing was deleted —
            there is simply nothing in this book to show. Renew it and it opens
            exactly as it was.</>
          : <>Each market is its own book. This one would hold your US trades, in
            dollars, with their own capital, their own totals and their own year —
            entirely separate from {home.label}, which stays exactly as it is.</>}
      </p>

      <ul>
        <li><b>{r.exchanges.join(", ")}</b> — symbols, live prices and daily bars</li>
        <li><b>Its own capital and risk</b>, so a dollar book never distorts a rupee one</li>
        <li><b>US charges</b> — commission, and the SEC and FINRA fees on a sale</li>
        <li><b>The calendar year</b>, which is how an American tax year runs</li>
        <li><b>Read it in rupees</b> at today&apos;s rate whenever you would rather</li>
      </ul>

      <p className="ro-ask">
        Want it switched on? <a href="/support">Ask for access</a> and I&apos;ll
        open it on your account.
      </p>

      <button className="btn ghost sm" onClick={onBack}>
        <ArrowLeft size={13} />Back to {home.label}
      </button>

      <style jsx>{`
        .ro { max-width: 62ch; }
        .ro h2 { font-size: 20px; margin: 6px 0 10px; }
        .ro p { font-size: 13.5px; line-height: 1.65; color: var(--ink2); margin: 0 0 14px; }
        .ro ul { margin: 0 0 16px; padding: 0 0 0 18px; }
        .ro li { font-size: 13px; line-height: 1.7; color: var(--ink2); }
        .ro li b { color: var(--ink); font-weight: 600; }
        .ro-ask :global(a) { color: var(--brass); font-weight: 600; }
      `}</style>
    </div>
  );
}
