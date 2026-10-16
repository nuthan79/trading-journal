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

import { sameBroker } from "./brokerFamily";
import { tradeCharges } from "./charges";

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
 * same symbol and entry date is never written twice — re-importing the same
 * export must not double the book.
 *
 * BUT ITS NEW SELLS ARE TAKEN. A bot's ledger is re-exported as it trades: a
 * position imported while open comes back next week sold, and treating the
 * whole row as a duplicate left it open in the journal for good — seven of
 * them on the first ledger tried. So a position already here whose file shows
 * sells the journal lacks becomes a COMPLETION: those sells attach to the
 * trade already here, keeping its stop, notes and anything typed since,
 * exactly as the tax P&L path completes a position (reconcile, in
 * import-pipeline.js). Same rules as there: a sell is matched by its date,
 * only within one broker family, never onto one of two same-day trades, and
 * never past the shares the trade holds. `importTrades` writes them, tagged
 * with the batch, so Undo takes them back out.
 */
export function toJournalRows(positions, {
  batchId, exchange = "NSE", broker = null, targets = [], region = null,
} = {}) {
  const held = new Map();
  for (const t of targets || []) {
    const k = `${String(t.symbol).toUpperCase()}|${t.entry_date}`;
    if (!held.has(k)) held.set(k, []);
    held.get(k).push(t);
  }

  const rows = [];
  const duplicates = [];
  const noStop = [];
  const completions = [];
  const conflicts = [];

  for (const p of positions) {
    const key = `${p.symbol.toUpperCase()}|${p.entryDate}`;
    if (held.has(key)) {
      const done = complete(p, held.get(key), broker);
      if (done.completion) completions.push(done.completion);
      /* In the shape the screen's held-back list reads, as the tax P&L
         path's conflicts are. */
      else if (done.conflict) {
        conflicts.push({
          ...p,
          exitDate: p.exits.length ? p.exits[p.exits.length - 1].exit_date : "still open",
          buyValue: round2(p.entryPrice * p.quantity),
          sellValue: round2(p.exits.reduce((a, e) => a + e.price * e.quantity, 0)),
          reason: done.conflict,
        });
      }
      else duplicates.push(p);
      continue;
    }

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
      /* A journal export that records WHY it sold keeps it; the Champions
         sheet does not, and passes nothing. Same for the pattern and the
         note — taken only when the file states them, so no format grows a
         field it never had. */
      ...(p.exitReason ? { exit_reason: p.exitReason } : { exit_reason: null }),

      /* The ENTRY-side charge only. Every exit carries its own below, and
         derivePosition adds the two — putting the total here would deduct the
         exit costs twice, which is the same trap the tax P&L path documents. */
      charges: round2(p.charges || 0),
      /* True only where the import worked the charges out itself
         (withOwnCharges) — then they are the app's computed figure, kept in
         step on edit like a typed trade's. A broker's stated charges stay
         an override. */
      charges_auto: !!p.chargesAuto,

      /* Spread rather than set: a format that states none of these must not
         start writing three nulls it never had — the probe on this file
         pins exactly that, and a null pattern would overwrite nothing today
         and something tomorrow. */
      /* The book this file belongs to. Sent only when it is not the default,
         so an Indian import still works against a database where migration
         052 has not run — and a US file cannot land in a rupee ledger. */
      ...(region && region !== "IN" ? { region } : null),
      ...(p.pattern ? { pattern: p.pattern } : null),
      ...(p.notes ? { notes: p.notes } : null),

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

  return { rows, duplicates, noStop, completions, conflicts };
}

/**
 * What to do with a position the journal already holds: the sells to add, a
 * reason it cannot be done safely, or nothing (every sell already here).
 */
function complete(p, found, broker) {
  const same = found.filter((t) => sameBroker(t.broker, broker));
  if (!same.length) return {};                    // another broker's position — leave it be
  if (same.length > 1) {
    return { conflict: `${same.length} trades already start on this date — pick one by hand` };
  }
  const t = same[0];
  const have = new Set((t.exits || []).map((e) => e.exit_date));
  const missing = (p.exits || []).filter((e) => !have.has(e.exit_date));
  if (!missing.length) return {};

  const already = (t.exits || []).reduce((a, e) => a + (Number(e.quantity) || 0), 0);
  const adding = missing.reduce((a, e) => a + (Number(e.quantity) || 0), 0);
  const holding = Number(t.quantity);
  /* More sold than the trade holds is not a sell to attach — it is a
     different position, or a size changed by hand. Said, not guessed. */
  if (already + adding > holding + 1e-6) {
    return { conflict: `file sells ${already + adding} but the trade here holds ${holding} — check it by hand` };
  }

  return {
    completion: {
      group: { symbol: p.symbol, entryDate: p.entryDate },
      tradeId: t.id,
      tranches: missing.map((e) => ({
        exit_date: e.exit_date,
        quantity: e.quantity,
        price: round2(e.price),
        charges: round2(e.charges || 0),
        /* The bot's own reason, on the sell it explains. */
        reason: p.exitReason || null,
      })),
      claimsBroker: !t.broker && broker ? broker : null,
      /* Why it was sold, onto the trade — only when this file's sells finish
         it, since the reason describes the last sell. importTrades writes it
         only where the trade has none, so a reason typed by hand stands. */
      exitReason: already + adding >= holding - 1e-6 && p.exitReason ? p.exitReason : null,
      already, adding, holding,
      status: t.status,
      skipped: (p.exits || []).length - missing.length,
    },
  };
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

/**
 * Every leg priced by the app's own calculator, for a file whose charges are
 * not to be taken (the SwingBot ledger — see `ownCharges` there).
 *
 * Per leg, not per position: the buy's charge goes on the position and each
 * sell's on that sell, which is the split derivePosition and the per-sell
 * banking already expect. That is what lets an open position carry its buy
 * charge now, and a completion later add only the charge of the sell it
 * brings — nothing is counted twice. A sale on the day of purchase picks up
 * the intraday rates, as tradeCharges does for any trade.
 */
export function withOwnCharges(positions, config, { exchange = "NSE", region = null } = {}) {
  return (positions || []).map((p) => {
    const c = tradeCharges({
      exchange, region, entry_date: p.entryDate, entry_price: p.entryPrice,
      quantity: p.quantity, exits: p.exits.map((e) => ({ ...e })),
    }, config);
    const exits = p.exits.map((e, i) => ({ ...e, charges: round2(c.sells?.[i]?.total || 0) }));
    const charges = round2(c.buy?.total || 0);
    /* The preview's Net P&L, restated on these charges — it showed the file's
       own figure, which carries the bot's costs, and the row then saved a
       different number. Realised only: an open position has made nothing. */
    const realised = exits.reduce((a, e) => a + (e.price - p.entryPrice) * e.quantity - e.charges, 0);
    return {
      ...p,
      charges,
      chargesAuto: true,
      exits,
      netProfit: exits.length ? round2(realised - charges) : 0,
    };
  });
}
