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
        /*
          Up from 12.5px and given weight, because at grey 12.5 regular this
          row read as a caption under the nav rather than as the nav it is.

          NOT ITALIC. This app already spends italic on a specific meaning —
          "Not recorded" in the edge table, the placeholder rows in Mindset —
          so it says a value is absent. Italic navigation would collide with
          that, and italic in a tab strip reads as emphasis rather than as a
          control anyway.

          Sentence case while the row above is uppercase and tracked out, and
          that treatment is now the ONLY thing carrying the hierarchy — this row
          renders a 17px line box against the main nav's 14px, so it is the
          larger of the two. Uppercase and letter-spacing still read as
          top-level, and the brass underline above marks the active tab, so the
          order survives; but the size no longer helps it. Worth knowing before
          anything else on either row changes.

          Inactive lifts from --ink3 to --ink2 for the same reason the section
          headings did: --ink3 on paper is about 3:1, and a control nobody can
          read is not a quieter control.
        */
        .an-subtab {
          font-size: 14px; font-weight: 600; color: var(--ink2);
          text-decoration: none; padding: 6px 13px; border-radius: 3px;
          white-space: nowrap;
        }
        .an-subtab:hover { color: var(--ink); background: var(--card); }
        .an-subtab[data-on="1"] {
          color: var(--ink); background: var(--card);
          border: 1px solid var(--rule); padding: 5px 12px;
        }
      `}</style>
    </>
  );
}
