/**
 * Turning a holdings statement into open positions.
 *
 * The sibling of `tradebook.js`, and the shorter of the two because there is
 * no matching to do: a holdings file is already positions. What it costs
 * instead is a date, which it does not carry and which this file has to invent
 * — see `entry_date_source` and migration 036 for why that invention is
 * tracked rather than swallowed.
 *
 * WHAT EACH FILE IS FOR, since there are now three and they must not overlap:
 *
 *   tax P&L     closed trades. Authoritative, carries real charges.
 *   holdings    open positions. Complete, carries no dates.
 *   tradebook   entry dates for those positions, where its window reaches.
 *
 * Only the first two write trades. The tradebook's role on this path is to
 * replace assumed dates with real ones, never to create a row — which is what
 * keeps it from duplicating the tax P&L's closed trades, the mistake that cost
 * a day to find the last time an import doubled a sell.
 *
 * DEDUPE IS BY SYMBOL, NOT BY SYMBOL AND DATE, and that difference is the
 * whole reason this is not just a call into `toOpenTradeRows`. The tradebook
 * keys on `symbol|entry_date` because its dates are real and two entries a
 * week apart are genuinely two positions. Here the date is a guess made at
 * import time, so keying on it would mean importing the same statement twice
 * on two different days produced two GOLDIAM positions that agreed about
 * everything except the day they were invented. Re-importing has to be safe,
 * so the symbol is the identity.
 *
 * AND A QUANTITY THAT DISAGREES IS NOT MERGED. If the journal holds 200 and
 * the file says 336, this reports the disagreement and writes nothing. Adding
 * the difference as a second position would invent an entry price for 136
 * shares; overwriting the first would discard a real entry date the user may
 * have typed. Both are guesses dressed as arithmetic. The user is told the two
 * numbers and left to decide, which is the same refusal `matchFifo` makes when
 * a sell has no buy.
 */

const round2 = (v) => Math.round(v * 100) / 100;

/** YYYY-MM-DD for today, in the browser's own timezone. */
export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The date to write when the file has none — which is always.
 *
 * The statement's own "as on" date beats today wherever the file states one,
 * and not by much but for a real reason: it is a date on which the position
 * provably existed, so it is a true upper bound on when it was bought. Today
 * is only an upper bound by accident, and on a statement downloaded weeks ago
 * it is a worse one.
 *
 * Neither is the answer. Both are flagged `assumed` and neither is allowed to
 * count as a holding period.
 */
export const assumedEntryDate = (asOf) => asOf || today();

/**
 * Open positions as journal rows, plus everything not written and why.
 *
 * `targets` are the journal's existing trades. Only open ones are consulted:
 * a closed GOLDIAM from last year says nothing about whether the GOLDIAM in
 * this file is already recorded.
 */
export function toHoldingRows(holdings, {
  batchId = null,
  asOf = null,
  broker = null,
  targets = [],
  exchange = "NSE",
} = {}) {
  /** symbol → what the journal already holds open in it */
  const held = new Map();
  for (const t of targets || []) {
    if (t.status === "closed") continue;
    const s = String(t.symbol || "").toUpperCase();
    if (!s) continue;
    const e = held.get(s) || { quantity: 0, trades: 0 };
    e.quantity += Number(t.quantity) || 0;
    e.trades += 1;
    held.set(s, e);
  }

  const entryDate = assumedEntryDate(asOf);
  const rows = [];
  const duplicates = [];
  const conflicts = [];

  for (const h of holdings) {
    const symbol = String(h.symbol || "").toUpperCase();
    if (!symbol) continue;

    const existing = held.get(symbol);

    if (existing) {
      // Same symbol, same size: this statement is describing a position the
      // journal already has. Re-importing must be a no-op.
      if (Math.abs(existing.quantity - h.quantity) < 1e-9) {
        duplicates.push({ ...h, symbol });
        continue;
      }
      // Same symbol, different size. Named, never reconciled — see the note
      // at the top of this file.
      conflicts.push({
        ...h,
        symbol,
        journalQuantity: existing.quantity,
        journalTrades: existing.trades,
      });
      continue;
    }

    rows.push({
      symbol,
      exchange: h.exchange || exchange,
      side: "long",
      status: "open",
      broker,

      entry_date: entryDate,
      /**
       * THE POINT OF THIS WHOLE PATH. The file has no purchase date, the
       * column cannot be null, so a guess goes in — and this is what stops
       * every calculation downstream from treating the guess as a fact.
       * calc.js and positions.js both refuse to count days from it.
       */
      entry_date_source: "assumed",
      entry_price: round2(h.avgPrice),
      quantity: h.quantity,
      acquisition: "purchase",

      /**
       * No stop, exactly as the tradebook path does it. A holdings file says
       * what you own and never what you were risking, and an invented stop
       * produces an R that somebody will believe. These land in /stops, which
       * exists for this and already holds the imports from tax P&Ls.
       */
      stop_loss: null,
      initial_stop_loss: null,
      stop_source: null,

      exit_date: null,
      exit_price: null,
      exit_reason: null,

      /**
       * Left to the app's own calculator rather than stored as a fact. A tax
       * P&L states its charges and an imported zero there is the broker's
       * truth; a holdings file has no charges column at all, so a stored zero
       * would be a fabrication. `charges_auto` hands it to the code that knows
       * Indian buy-side costs.
       */
      charges: 0,
      charges_auto: true,

      imported: true,
      import_batch: batchId,
      exits: [],

      _preview: {
        // Non-zero proves the position is over a year old, which is the only
        // evidence either file offers about when it was opened. The review
        // queue leads with these, because for them "bought today" is not
        // merely unknown — it is provably false.
        longTermQty: h.longTermQty || 0,
        sector: h.sector || "",
        buyValue: round2(h.quantity * h.avgPrice),
      },
    });
  }

  return { rows, duplicates, conflicts, entryDate };
}

/**
 * What to tell the user about the dates, in one sentence they will read.
 *
 * Split out because it is said in two places — the preview before importing
 * and the review queue afterwards — and the two drifting apart is how someone
 * ends up believing the dates were filled in for them.
 */
export function dateCaveat(count, asOf) {
  if (!count) return "";
  const when = asOf ? `the statement date, ${asOf}` : "today's date";
  return (
    `${count} ${count === 1 ? "position has" : "positions have"} no purchase date — ` +
    `no broker's holdings file carries one. They have been given ${when} and marked ` +
    `as assumed, so nothing counts them as a holding period until you correct them.`
  );
}
