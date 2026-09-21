"use client";

import { REGIONS } from "@/lib/regions";

/**
 * Read this book in the other currency.
 *
 * AN INDIAN TRADER WITH A US BOOK THINKS IN RUPEES. "$1.4K unrealised" takes
 * a beat to land where "₹1.34 L" does not, and that beat is the whole reason
 * this exists. Dollars stay the default and the book's real figures: this
 * changes how they are WRITTEN, never what is stored, never what is summed.
 *
 * Only offered where the book is not already in your home currency, and only
 * ever within one book — nothing here adds a rupee to a dollar.
 */
export default function CurrencyView({ book, value, rate, at, onChange }) {
  const home = REGIONS.find((r) => r.id === "IN");
  const own = REGIONS.find((r) => r.id === book) || home;
  if (!own || own.currency === home.currency) return null;

  const on = value === home.currency;
  const rateText = rate > 0
    ? `₹${rate.toFixed(2)} to the ${own.currency === "USD" ? "dollar" : own.currency}`
    : "rate unavailable";

  return (
    <div className="cv" role="group" aria-label="Show figures in">
      <button data-on={!on ? 1 : 0} onClick={() => onChange?.(own.currency)}
              title={`The book's own currency — what these trades actually made`}>
        {own.sign}
      </button>
      <button data-on={on ? 1 : 0} onClick={() => onChange?.(home.currency)}
              disabled={!(rate > 0)}
              title={rate > 0
                ? `Today's rate, ${rateText} — what this book is worth to you now, not what it made at the time`
                : "The rate could not be fetched, so the figures stay in the book's own currency"}>
        {home.sign}
      </button>

      <style jsx>{`
        .cv { display: inline-flex; border: 1px solid var(--rule); border-radius: 3px;
              overflow: hidden; background: var(--card); }
        .cv button { border: 0; background: transparent; cursor: pointer;
                     padding: 6px 10px; font-size: 13px; font-weight: 600; color: var(--ink3); }
        .cv button[data-on="1"] { background: var(--brass); color: #fff; }
        .cv button:disabled { opacity: .4; cursor: default; }
      `}</style>
    </div>
  );
}
