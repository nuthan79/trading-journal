import { BRAND } from "@/lib/brand";

/**
 * The lockup: the ledge mark, then the name with RR in brass.
 *
 * ONE DEFINITION, SEVEN PLACES. The name appears in the marketing header and
 * footer, the signed-out landing, the legal shell, both /learn pages and the
 * calculator. Written out at each of those it would drift — a different size
 * here, the RR left plain there — and a mark that is slightly different
 * everywhere is not a mark. So the lockup is a component and the call sites
 * choose only a size.
 *
 * WHY THE RR IS BRASS. LedgeRR is Ledger + RR, and RR is the unit the whole
 * app is built on. Colouring it is the cheapest way to teach both at once, and
 * brass is already the accent — it spends nothing new. Teal was the other
 * candidate and was rejected: it is the gain colour, and a name that borrows it
 * would be making a claim beside every P&L it sits near.
 *
 * WHY A LEDGE. A ledge is the flat shelf a stock stands on before it breaks
 * off one — so the name describes the subject twice, and the second meaning is
 * the one nobody uses. The flat part is deliberately the longer half: every
 * other trading logo shouts the breakout, and this app is about the wait.
 *
 * The mark scales with the type rather than taking a pixel size, so the pair
 * stays in proportion wherever it lands. `em` on the SVG is what does that.
 */

export default function Wordmark({
  size = 20,
  showMark = true,
  className = "",
  markClassName = "",
}) {
  return (
    <span className={`wm-lock ${className}`} style={{ fontSize: size }}>
      {showMark && (
        <svg
          className={`wm-mark ${markClassName}`}
          /*
            Cropped to the ink, not to a comparison grid.

            This was 0 0 40 40 — the shared box the options sheet used so four
            marks could be compared fairly. Carried over here it left the mark
            occupying a third of its own height, so it rendered at about half
            the cap height of the name beside it and read as undersized. The
            box below is the drawn bounds plus half a stroke on each side:
            x 5..35 and y 16..29 with a 3.6 stroke.
          */
          viewBox="3.2 14.2 33.6 16.6"
          aria-hidden="true"
          focusable="false"
        >
          {/* M1, stroked. Its weight sits close to the letterforms beside it,
              so neither the mark nor the name dominates the pair. The favicon
              uses a heavier three-shelf drawing instead — at 16px this one
              loses its riser to anti-aliasing. */}
          <path d="M5 29 H21" stroke="currentColor" strokeWidth="3.6" fill="none" />
          <path d="M21 29 V16" stroke="var(--brass)" strokeWidth="3.6" fill="none" />
          <path d="M21 16 H35" stroke="currentColor" strokeWidth="3.6" fill="none" />
        </svg>
      )}
      <span className="wm-name">
        Ledge<span className="wm-rr">RR</span>
      </span>
    </span>
  );
}

/** For anywhere the name is needed as a plain string. */
export const brandName = BRAND.name;
