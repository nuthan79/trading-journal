"use client";

import { money, moneyTitle } from "@/lib/format";

/**
 * A money figure that keeps its digits.
 *
 * The page shows the compact form — "₹5.88 L" — because that is what makes a
 * column of them readable. Hovering gives back what the abbreviation dropped.
 *
 * Use this wherever a money figure is RENDERED. `money()` on its own is still
 * right inside a string: a title, a hint, a CSV cell, a chart label. There is
 * nothing to hover there. Both follow the book's own currency — see the note
 * at the top of lib/format.js.
 *
 * `note` folds an existing cell tooltip into this one. Anything that used to
 * carry its own `title` over the number passes it here instead, so the two do
 * not nest and fight over the pointer.
 */
export default function Money({ v, note, compact, decimals, className }) {
  const opts = {};
  if (compact != null) opts.compact = compact;
  if (decimals != null) opts.decimals = decimals;

  const title = moneyTitle(v, note);
  return (
    <span className={["money", className].filter(Boolean).join(" ")}
          title={title}>
      {money(v, opts)}
    </span>
  );
}
