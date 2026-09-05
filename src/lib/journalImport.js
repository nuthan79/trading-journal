/**
 * A whole journal, turned into trade rows.
 *
 * The tax P&L path goes through `import-pipeline.js`, which exists to solve a
 * problem this file does not have: a broker report is a list of matched lots
 * and the positions have to be reassembled from it. A journal export already
 * knows what a position was, because a person recorded it.
 *
 * So this is deliberately not that pipeline. What it keeps from it is the one
 * thing that matters — never writing a position the journal already holds.
 *
 * WHAT COMES ACROSS THAT NOTHING ELSE CAN BRING:
 *
 *   the stop, recorded rather than assumed, which is what makes R a
 *   measurement instead of a rescaling of percentage return;
 *
 *   every exit tranche with its own date, price and charges;
 *
 *   open and part-sold positions in the same pass as the closed ones.
 */

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * WHAT IS DELIBERATELY NOT IMPORTED.
 *
 * The file carries more than this: the trader's tags ("A Trade", "Power
 * Trade", "MTF"), the risk-per-trade they recorded, a per-tranche profit
 * figure, position size, holding days, an R:R ratio.
 *
 * None of it is taken. Every one is either something the app computes for
 * itself from the fields below — position size, holding days, R, profit — or
 * something it has no honest place for. Importing a figure the app also
 * derives creates two versions of one number that can disagree, and the
 * imported one is the one nobody recomputes.
 *
 * Tags are the clearest case. "A Trade" is conviction and "MTF" is funding;
 * the journal's `pattern` means a VCP, a flat base, a cup. Writing one into
 * the other puts a funding method where a chart pattern belongs and corrupts
 * every breakdown that groups by it — so they are left in the file, where
 * they are still true.
 *
 * What comes across is what the app cannot work out on its own: what was
 * bought, when, at what price, what was risked, and what was sold.
 */

/**
 * `targets` are the journal's existing rows. A position already here on the
 * same symbol and entry date is reported rather than written — re-importing
 * the same export must not double the book.
 */
export function toJournalRows(positions, {
  batchId, exchange = "NSE", broker = null, targets = [],
} = {}) {
  const held = new Map();
  for (const t of targets || []) {
    held.set(`${String(t.symbol).toUpperCase()}|${t.entry_date}`, t);
  }

  const rows = [];
  const duplicates = [];
  const noStop = [];

  for (const p of positions) {
    const key = `${p.symbol.toUpperCase()}|${p.entryDate}`;
    if (held.has(key)) { duplicates.push(p); continue; }

    const sold = p.exits.reduce((a, e) => a + (Number(e.quantity) || 0), 0);
    const closed = sold >= p.quantity - 1e-6 && p.exits.length > 0;

    /*
      A stop on the wrong side of the entry is not a stop.

      On a long it must sit below the entry and on a short above it, or 1R is
      negative and every R computed from it has its sign inverted — a losing
      trade reading as a winner, in a figure nobody would think to check.
      Those come in with no stop and land in the /stops queue like any other
      import, which is the honest outcome.
    */
    const dir = p.side === "short" ? -1 : 1;
    const usable = p.stop > 0 && (p.stop - p.entryPrice) * dir < 0;
    if (!usable && p.stop) noStop.push(p);

    const last = p.exits.length ? p.exits[p.exits.length - 1] : null;

    rows.push({
      symbol: p.symbol,
      exchange,
      side: p.side,
      status: closed ? "closed" : "open",
      broker,

      entry_date: p.entryDate,
      entry_price: round2(p.entryPrice),
      quantity: p.quantity,
      acquisition: "purchase",

      /* RECORDED, not assumed — the whole reason this format is worth having.
         `entry_date_source` likewise: a person typed this date. */
      stop_loss: usable ? round2(p.stop) : null,
      initial_stop_loss: usable ? round2(p.stop) : null,
      stop_source: usable ? "recorded" : null,
      entry_date_source: "recorded",

      /* Mirrors of the last tranche. The database trigger recomputes all three
         from `exits` once they land, so these are a starting value rather than
         the final word — and a position with no exits keeps them null. */
      exit_date: last ? last.exit_date : null,
      exit_price: last ? round2(last.price) : null,
      exit_reason: null,

      /* The ENTRY-side charge only. Every exit carries its own below, and
         derivePosition adds the two — putting the total here would deduct the
         exit costs twice, which is the same trap the tax P&L path documents. */
      charges: round2(p.charges || 0),
      charges_auto: false,

      imported: true,
      import_batch: batchId,

      exits: p.exits.map((e) => ({
        exit_date: e.exit_date,
        quantity: e.quantity,
        price: round2(e.price),
        charges: round2(e.charges || 0),
      })),

      /* Preview only — never written. Just enough for the table to describe
         the row before it is confirmed. */
      _preview: {
        tranches: p.exits.length,
        sold,
        stillOpen: round2(p.quantity - sold),
        netProfit: round2(p.netProfit),
      },
    });
  }

  return { rows, duplicates, noStop };
}

/** Headline figures for the preview, before anything is written. */
export function journalSummary(rows) {
  const closed = rows.filter((r) => r.status === "closed");
  const open = rows.filter((r) => r.status === "open");
  return {
    positions: rows.length,
    closed: closed.length,
    open: open.length,
    withStop: rows.filter((r) => r.stop_loss != null).length,
    tranches: rows.reduce((a, r) => a + r.exits.length, 0),
    invested: round2(open.reduce((a, r) => a + r.entry_price * r._preview.stillOpen, 0)),
    netProfit: round2(rows.reduce((a, r) => a + (isFinite(r._preview.netProfit) ? r._preview.netProfit : 0), 0)),
    from: rows.reduce((a, r) => (!a || r.entry_date < a ? r.entry_date : a), null),
    to: rows.reduce((a, r) => (!a || r.entry_date > a ? r.entry_date : a), null),
  };
}
