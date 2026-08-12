"use client";

import { User, SlidersHorizontal, Plug, CreditCard, LifeBuoy } from "lucide-react";

/**
 * One place for everything that isn't a trade.
 *
 * These lived in two modal sheets and a page nobody could find: account bits
 * in one sheet, how-the-journal-counts in another, and importing on a route
 * you reached from a button inside one of them. Three doors to the same
 * cupboard.
 *
 * NOT THE SIX SECTIONS OF THE REFERENCE. Notifications is missing because this
 * app sends none — a panel of switches that control nothing is worse than an
 * absent panel, since it implies mail that will never arrive. It goes in when
 * there is something to turn off.
 *
 * "Setup" rather than "Preferences", because it is not a matter of taste:
 * account size and default risk are what every R in the app is measured
 * against, and calling them preferences suggests the numbers would still mean
 * something if they were wrong.
 */
export const SECTIONS = [
  { id: "profile",     label: "Profile",     icon: User,              sub: "Who you're signed in as" },
  { id: "setup",       label: "Setup",       icon: SlidersHorizontal, sub: "How the journal counts" },
  { id: "integration", label: "Integration", icon: Plug,              sub: "Bring in broker files" },
  { id: "billing",     label: "Billing",     icon: CreditCard,        sub: "Plan and renewal" },
  { id: "support",     label: "Support",     icon: LifeBuoy,          sub: "Ask for help" },
];

export default function SettingsNav({ active, onPick }) {
  return (
    <nav className="sn" aria-label="Settings sections">
      {SECTIONS.map(({ id, label, icon: Icon, sub }) => (
        <button
          key={id}
          className="sn-item"
          data-on={active === id ? 1 : 0}
          onClick={() => onPick(id)}
          aria-current={active === id ? "page" : undefined}
        >
          <Icon size={15} />
          <span className="sn-text">
            <b>{label}</b>
            {/* The one-liner is the point of the nav: "Integration" alone
                tells nobody that this is where a Zerodha file goes. */}
            <i>{sub}</i>
          </span>
        </button>
      ))}

      <style jsx>{`
        .sn { display: flex; flex-direction: column; gap: 2px; }
        .sn-item {
          display: flex; align-items: flex-start; gap: 11px;
          padding: 11px 12px; border: 0; border-radius: 3px;
          background: none; cursor: pointer; text-align: left;
          color: var(--ink2); width: 100%;
        }
        .sn-item :global(svg) { margin-top: 2px; flex: none; }
        .sn-item:hover { background: #E6EBE8; color: var(--ink); }
        .sn-item[data-on="1"] { background: var(--ink); color: var(--paper); }
        .sn-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .sn-text b {
          font-family: 'Archivo', sans-serif; font-weight: 600;
          font-size: 13.5px; letter-spacing: 0.01em;
        }
        .sn-text i { font-style: normal; font-size: 11.5px; opacity: 0.72; }

        /* Below the split the nav becomes a scrolling strip of labels — a
           column of five rows above the content would push the content off
           the first screen entirely. */
        @media (max-width: 860px) {
          .sn {
            flex-direction: row; gap: 6px; overflow-x: auto;
            padding-bottom: 6px; margin-bottom: 4px;
          }
          .sn-item { width: auto; white-space: nowrap; padding: 8px 12px; }
          .sn-text i { display: none; }
        }
      `}</style>
    </nav>
  );
}
