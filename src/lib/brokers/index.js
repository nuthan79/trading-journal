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
import * as groww from "./groww";
import * as dhan from "./dhan";
import * as zerodhaHoldings from "./zerodha-holdings";
import * as zerodhaTradebook from "./zerodha-tradebook";

export { assembleImport } from "../import-pipeline";

/**
 * In the order they're tried. Zerodha first — it is the one with users.
 *
 * A FILE'S KIND MATTERS AS MUCH AS ITS BROKER, which is what `kind` is for.
 * An adapter with no `kind` reads a tax P&L and yields matched lots; the
 * holdings adapter yields open positions and nothing else. The import screen
 * branches on it, so an adapter that returns a different shape can now be
 * registered without the screen mistaking its output for lots.
 *
 * THE TRADEBOOK IS NOW LISTED, AND IT IMPORTS NOTHING. `matchFifo` returns
 * closed lots as well as open positions, and it writes neither: those lots
 * would duplicate every closed trade the tax P&L already gave, while being
 * strictly worse than them — a tradebook carries no charges and mis-pairs
 * anything bought before its own start date. Its whole job is supplying real
 * entry dates for positions a holdings file has already created, which is why
 * its kind is handled separately from the two that do write trades.
 */
export const BROKERS = [zerodha, groww, dhan, zerodhaHoldings, zerodhaTradebook];

/** What a file yields. Absent means matched lots — the original assumption. */
export const kindOf = (broker) => broker?.kind || "taxpnl";

/**
 * A recognised file that is the WRONG report, named so the message can help.
 *
 * "This doesn't look like a report we can read yet. Supported: Zerodha, Groww,
 * Dhan" is a baffling thing to tell somebody holding a Zerodha file, and that
 * is exactly who gets it: Console offers a P&L Statement and a Tax P&L, the
 * first is the more obvious download, and only the second carries the tradewise
 * exits with per-lot dates a journal needs.
 *
 * Matched on the file's own title text rather than on sheet names, because the
 * titles are what differ — both reports have an "Equity" sheet.
 *
 * Returns a sentence or null. Deliberately not a broker object: the file is not
 * importable, and returning one would invite something to try.
 */
export function wrongReportHint(workbook) {
  const text = [];
  for (const n of workbook?.SheetNames || []) {
    const ws = workbook.Sheets?.[n];
    for (const addr of Object.keys(ws || {})) {
      if (addr[0] === "!") continue;
      const v = ws[addr]?.v;
      if (typeof v === "string" && v.length < 140) text.push(v.toLowerCase());
      if (text.length > 500) break;
    }
  }
  const all = text.join(" | ");
  if (/tradewise/.test(all)) return null;   // it is the right report after all

  if (/p&l statement for/.test(all)) {
    return (
      "That is Zerodha's P&L Statement, which summarises by scrip and carries no " +
      "per-trade dates. The one to download is Console → Reports → Tax P&L, which " +
      "has a Tradewise Exits sheet."
    );
  }
  if (/tradebook for/.test(all)) {
    return (
      "That looks like a tradebook. Import your holdings first and then drop this " +
      "in — it will fill in their purchase dates. Closed trades still have to come " +
      "from the tax P&L, the only file carrying real charges."
    );
  }
  return null;
}

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

/**
 * The tax P&L brokers, by name — for the message shown when nothing matched,
 * and for the drop zone's own description of itself.
 *
 * Filtered by kind rather than listing every adapter, because the sentence
 * these appear in is about capital gains reports. "Zerodha, Groww, Dhan and
 * Zerodha holdings" reads as a fourth broker somebody has not heard of.
 */
export const brokerNames = () =>
  BROKERS.filter((b) => kindOf(b) === "taxpnl").map((b) => b.label);

/** The same, for files that carry open positions instead of closed trades. */
export const holdingsNames = () =>
  BROKERS.filter((b) => kindOf(b) === "holdings").map((b) => b.label);
