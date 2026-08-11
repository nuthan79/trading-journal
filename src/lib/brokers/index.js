/**
 * Which broker sent this file, and how to read it.
 *
 * Every Indian broker exports a tax P&L and no two agree on the shape. Rather
 * than one parser full of branches, each gets a small module whose only job is
 * to turn its own file into the lot list `import-pipeline.js` consumes — see
 * the contract described there.
 *
 * Detection is by evidence in the file, not by a dropdown. Somebody who has
 * just downloaded a report from their broker should not also have to tell us
 * which broker they use; the file already says so, in a sheet name or a title
 * cell, and reading that is more reliable than asking.
 *
 * ADDING A BROKER means adding a module here and nothing else. It needs an
 * id, a label, `detect(workbook)`, `findSheet(workbook)` and
 * `parseRows(rows)`. Grouping, reconciliation, free shares, assumed stops and
 * the whole preview are inherited.
 *
 * WHAT IT MUST NOT MEAN is guessing. A format written from a screenshot or an
 * assumption produces numbers that look right and are not — the same way a
 * fabricated buy value once turned three shares into an R of five thousand.
 * No adapter without a real export from that broker to test against.
 */

import * as zerodha from "./zerodha";

export { assembleImport } from "../import-pipeline";

/**
 * In the order they're tried. Zerodha first — it is the one with users.
 *
 * NOT YET LISTED: `zerodha-tradebook.js`, which is written and tested but
 * cannot be registered until the import screen knows what to do with it. A
 * tradebook is a different KIND of file rather than a different broker — a tax
 * P&L yields matched lots and closed trades, a tradebook yields open positions
 * — and everything downstream of `detectBroker` here assumes the former. Adding
 * it before the screen can branch would turn today's clear "this is not a tax
 * P&L" message into a silent bad parse, which is a worse answer than the one
 * being replaced.
 */
export const BROKERS = [zerodha];

export const brokerById = (id) => BROKERS.find((b) => b.id === id) || null;

/**
 * The first adapter that recognises the file, or null.
 *
 * Null is a useful answer and should be shown as one: naming the brokers that
 * ARE understood tells someone with an HDFC file what to do next, where "could
 * not read this file" leaves them guessing whether it is the wrong report, the
 * wrong format, or a bug.
 */
export function detectBroker(workbook) {
  for (const b of BROKERS) {
    try {
      if (b.detect(workbook)) return b;
    } catch {
      // A malformed file is one adapter's problem, not the next one's turn
      // wasted — keep trying the rest.
    }
  }
  return null;
}

/** Every broker's name, for the message shown when none of them matched. */
export const brokerNames = () => BROKERS.map((b) => b.label);
