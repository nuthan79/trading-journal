"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The four screens that interpret the record, under one tab.
 *
 * WHAT IS IN HERE AND WHAT IS NOT. Performance sits outside, at the top level,
 * and that line is the useful one: Performance is totals and periods, consulted
 * the way a statement is. Everything in here takes that record and argues
 * something about it, which is a different act and a less frequent one.
 *
 * WHY SUB-TABS AND NOT ONE LONG PAGE. The obvious way to combine four screens
 * is to stack them, and it produces thousands of pixels whose bottom third is
 * never seen. Sub-tabs keep the top nav short AND each screen whole, which is
 * the only version where combining is a gain rather than a filing decision.
 *
 * ORDER IS AN ARGUMENT. Edge is where the edge actually was, in trades that
 * were taken; What-if starts from those measured numbers and lets you move
 * them; Mindset is the state they were taken in; Review is the verdict.
 * Evidence, then hypothesis, then cause, then verdict — and the verdict reads
 * last because it only means something once the other three have been seen.
 */

const SUB = [
  { href: "/analysis/edge", label: "Edge" },
  { href: "/analysis/what-if", label: "What-if" },
  { href: "/analysis/mindset", label: "Mindset" },
  { href: "/analysis/review", label: "Review" },
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
