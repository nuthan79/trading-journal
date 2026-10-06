"use client";

import { useMemo } from "react";
import { openProfitAlert, OPEN_PROFIT_SHARE } from "@/lib/openProfit";
import { money, pct } from "@/lib/format";

/**
 * A reminder that open profit is not banked profit.
 *
 * TWO FACTS AND AN INSTRUCTION, like the losing-run card: how much is riding
 * on the winners, what share of the account that is, and what to go and
 * check. How it is counted lives in the hover.
 *
 * Brass rather than red: nothing is wrong. This is the good problem, and the
 * card is there because the good problem is the one people stop watching.
 */
export default function OpenProfitAlert({ open = [], accountSize = 0 }) {
  const a = useMemo(() => openProfitAlert(open, accountSize), [open, accountSize]);
  if (!a) return null;

  return (
    <div className="opa">
      <b title={`Added up from the ${a.winners} position${a.winners === 1 ? "" : "s"} in profit `
        + `only — an open loser does not make these gains any safer. Measured against the `
        + `account size in Setup, and shown from ${pct(OPEN_PROFIT_SHARE * 100, 0)} of it, which `
        + `on your account is ${money(a.threshold)}. Open profit is not banked: a turn in the `
        + `market takes it back faster than it came.`}>
        {money(a.profit)} of open profit · {pct(a.share, 0)} of your capital
      </b>
      <p>Check the market regime and your stops.</p>

      <style jsx>{`
        .opa {
          border: 1px solid var(--brass); border-left-width: 3px;
          background: var(--card); border-radius: 3px;
          padding: 12px 16px; margin-bottom: 14px;
        }
        .opa > b { cursor: help; }
        .opa p { margin: 4px 0 0; font-size: 13px; color: var(--ink); }
      `}</style>
    </div>
  );
}
