"use client";

import { qty, qtyExact } from "@/lib/format";

/**
 * A share count that keeps its digits.
 *
 * Same bargain as `<Money>`: the column stays readable and the exact figure
 * is one hover away. US brokers sell fractional shares, so a quantity can
 * carry nine decimals — and a column of those is unreadable while the digits
 * still matter when somebody reconciles against their broker.
 */
export default function Qty({ v, className }) {
  const short = qty(v);
  const full = qtyExact(v);
  return (
    <span className={["qty", className].filter(Boolean).join(" ")}
          title={short !== full ? full : undefined}>{short}</span>
  );
}
