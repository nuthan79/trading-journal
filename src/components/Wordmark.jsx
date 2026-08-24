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
            the cap height of the name beside it and read as undersized.

            Then it was 3.2 14.2 33.6 16.6, described as the drawn bounds plus
            half a stroke on each side. That is right vertically and wrong
            horizontally: these strokes have BUTT caps, so they stop dead at
            their endpoints and never reach past x 6 or x 36. The extra 1.8 a
            side was empty, and it pushed the mark away from the name by a gap
            nobody chose. Ink is x 6..36 and y 14.2..30.8 — 30 x 16.6, a ratio
            of 1.81 against the reference drawing's 1.78.
          */
          viewBox="6 14.2 30 16.6"
          aria-hidden="true"
          focusable="false"
        >
          {/* Stroked, because at this size its weight sits close to the
              letterforms beside it and neither half dominates. Measured, not
              guessed: Archivo Bold's stem is 20.8% of its cap height, and a
              3.6 stroke in this 16.6-tall box is 21.7% of the mark's height,
              which is the cap height. The icon is drawn heavier — bars at a
              quarter of its height — because it has to survive 16px, where a
              stroke this fine thins to under a pixel and the riser vanishes
              into anti-aliasing. Same construction, weighted for where it is
              used.

              EQUAL BARS. These were 16 and 14, which is nothing anyone chose
              and reads as a wobble at large sizes. 15 and 15, so the step is
              symmetrical about the riser the way the icon's is.

              The riser is centred on the corner and runs centreline to
              centreline, so butt caps leave a notch of ground at each joint.
              That notch is the edge. Do not tidy these joints flush. */}
          <path d="M6 29 H21" stroke="currentColor" strokeWidth="3.6" fill="none" />
          <path d="M21 29 V16" stroke="var(--brass)" strokeWidth="3.6" fill="none" />
          <path d="M21 16 H36" stroke="currentColor" strokeWidth="3.6" fill="none" />
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
