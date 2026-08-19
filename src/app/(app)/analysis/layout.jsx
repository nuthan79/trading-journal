"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The four screens that answer "what does my history tell me", under one tab.
 *
 * WHY THEY WERE MERGED. Performance, Edge, Review and Mindset were four
 * top-level tabs out of eight, and every one of them is the same kind of
 * question asked at a different angle: what happened, what it is worth, what I
 * did wrong, how I felt doing it. Meanwhile Dashboard, Holdings, Trades and
 * Diary are four different kinds of thing entirely. A nav where half the items
 * are facets of one idea reads as a long list rather than as a structure, and
 * the list was about to grow again.
 *
 * WHY SUB-TABS AND NOT ONE LONG PAGE. The obvious way to combine four screens
 * is to stack them, and it produces six thousand pixels whose bottom third is
 * never seen. Sub-tabs keep the top nav short AND each screen whole, which is
 * the only version where combining is a gain rather than a filing decision.
 *
 * ORDER IS AN ARGUMENT. Performance is what happened; Edge is what that is
 * worth per trade and where it compounds to; Review is what went wrong;
 * Mindset is the state it went wrong in. Facts, then value, then fault, then
 * cause — each one only makes sense once the one before it has been read.
 */

const SUB = [
  { href: "/analysis/performance", label: "Performance" },
  { href: "/analysis/edge", label: "Edge" },
  { href: "/analysis/review", label: "Review" },
  { href: "/analysis/mindset", label: "Mindset" },
];

export default function AnalysisLayout({ children }) {
  const pathname = usePathname();

  return (
    <>
      <div className="an-subtabs">
        {SUB.map((s) => (
          <Link key={s.href} href={s.href} className="an-subtab"
                data-on={pathname === s.href ? 1 : 0}>
            {s.label}
          </Link>
        ))}
      </div>
      {children}

      {/*
        GLOBAL, PREFIXED — because these tabs are `Link` components.

        Scoped styled-jsx only reaches elements this component function renders
        itself, and a child component's markup is not that. Written scoped
        first, the strip picked up its border while every tab inside it stayed
        default browser-blue with no padding — styled, unstyled, side by side,
        and no error anywhere. The `an-` prefix keeps the global block safe.
      */}
      <style jsx global>{`
        /*
          A second row of tabs has to look subordinate to the first or the page
          reads as having two navigations of equal weight. So: smaller, no
          uppercase tracking, and a filled pill for the current one rather than
          the brass underline the top row uses — a different mechanism, not a
          smaller copy of the same one.
        */
        .an-subtabs {
          display: flex; gap: 4px; flex-wrap: wrap;
          margin: 0 0 4px; padding-bottom: 14px;
          border-bottom: 1px solid var(--rule);
        }
        .an-subtab {
          font-size: 12.5px; color: var(--ink3); text-decoration: none;
          padding: 6px 12px; border-radius: 3px; white-space: nowrap;
        }
        .an-subtab:hover { color: var(--ink2); background: var(--card); }
        .an-subtab[data-on="1"] {
          color: var(--ink); background: var(--card);
          border: 1px solid var(--rule); padding: 5px 11px;
        }
      `}</style>
    </>
  );
}
