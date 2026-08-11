/**
 * Turning a tradebook into positions.
 *
 * WHY THIS EXISTS. A tax P&L report hands you matched pairs — this buy went
 * with that sell, FIFO already applied, charges already apportioned — which is
 * why `brokers/zerodha.js` can go almost straight to the lot shape the
 * pipeline wants. A tradebook hands you the raw stream instead: buys and sells
 * in the order they happened, with nothing said about which went with which.
 * That matching is this file, and it is the only part a tradebook needs that a
 * tax report does not.
 *
 * TWO REASONS IT IS WORTH THE WORK.
 *
 * A tradebook is the same shape at every broker — a date, an instrument, a
 * side, a quantity, a price. Tax reports are not: they differ in their
 * columns, their sections, and in which decisions the broker already made for
 * you. So one tradebook reader covers brokers nobody has written an adapter
 * for, where a tax report needs a new adapter each time.
 *
 * And a tradebook is the only file that carries what you still hold, with the
 * date you bought it. A tax report covers closed trades by definition, so
 * importing one leaves somebody staring at an empty Holdings page while
 * actually holding stock. The leftovers here are those positions.
 *
 * WHAT IT REFUSES TO DO. A sell with no buy to match is not silently balanced
 * by inventing one. It happens for real and for ordinary reasons — bonus
 * issues, splits, demerged shares, a transfer in from another broker — none of
 * which appear in a tradebook because none of them are trades. The honest
 * output is the matched part plus a named shortfall, because a fabricated buy
 * produces an entry price, and an entry price produces an R, and that R is a
 * number somebody will believe.
 */

const round2 = (v) => Math.round(v * 100) / 100;

/** Buys settle before sells on a shared date. You cannot sell what you have
 *  not bought, and a same-day pair is a decision made in that order. */
const SIDE_ORDER = { BUY: 0, SELL: 1 };

/**
 * FIFO, oldest lot first.
 *
 * FIFO rather than any other convention because it is what Indian tax
 * treatment assumes, so it is the matching a user's own broker and CA already
 * did. Choosing differently here would produce holding periods that disagree
 * with their tax report for the same trades.
 *
 * `rows` are already normalised — whatever read the file has resolved the
 * columns, parsed the dates to YYYY-MM-DD and settled the symbol:
 *
 *   { date, symbol, isin, side: "BUY" | "SELL", quantity, price, charges }
 *
 * Returns matched lots in exactly the shape `import-pipeline.js` consumes, the
 * still-open lots beside them, and what could not be matched.
 */
export function matchFifo(rows) {
  const warnings = [];
  const shortfalls = [];
  const lots = [];

  // Stable within a date: the file's own order is the only evidence of
  // sequence when two trades share a day, and reordering them silently would
  // change which buy a sell consumed.
  const ordered = rows
    .map((r, i) => ({ ...r, _i: i }))
    .filter((r) => {
      if (!r.date || !r.symbol) { warnings.push(`Row ${r._i + 1}: no date or symbol — skipped`); return false; }
      if (!(r.quantity > 0)) { warnings.push(`${r.symbol}: row ${r._i + 1} has no quantity — skipped`); return false; }
      if (!(r.price >= 0)) { warnings.push(`${r.symbol}: row ${r._i + 1} has no price — skipped`); return false; }
      return true;
    })
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1
        : (SIDE_ORDER[a.side] ?? 0) - (SIDE_ORDER[b.side] ?? 0)
        || a._i - b._i);

  /** symbol → queue of open buy lots, oldest first */
  const books = new Map();

  for (const r of ordered) {
    const book = books.get(r.symbol) || [];
    if (!books.has(r.symbol)) books.set(r.symbol, book);

    if (r.side === "BUY") {
      book.push({
        date: r.date,
        isin: r.isin || "",
        left: r.quantity,
        price: r.price,
        // Per share, so a partly-consumed lot carries the right share of what
        // it cost to open. The alternative — charging the whole buy to the
        // first sell out of it — overstates the cost of scaling out.
        chargePerShare: r.quantity > 0 ? (r.charges || 0) / r.quantity : 0,
      });
      continue;
    }

    // A sell. Consume the oldest lots until it is satisfied or the book runs dry.
    let need = r.quantity;
    const sellChargePerShare = r.quantity > 0 ? (r.charges || 0) / r.quantity : 0;

    while (need > 0 && book.length > 0) {
      const lot = book[0];
      const take = Math.min(need, lot.left);

      lots.push({
        section: r.section || "equity",
        symbol: r.symbol,
        isin: lot.isin || r.isin || "",
        entryDate: lot.date,
        exitDate: r.date,
        quantity: take,
        buyValue: round2(take * lot.price),
        sellValue: round2(take * r.price),
        profit: round2(take * (r.price - lot.price)),
        holdingDays: daysBetween(lot.date, r.date),
        charges: round2(take * (lot.chargePerShare + sellChargePerShare)),
      });

      lot.left -= take;
      need -= take;
      if (lot.left <= 1e-9) book.shift();
    }

    if (need > 0) {
      // Recorded, never invented. See the note at the top of this file.
      shortfalls.push({ symbol: r.symbol, date: r.date, quantity: need });
    }
  }

  const open = [];
  for (const [symbol, book] of books) {
    for (const lot of book) {
      if (lot.left <= 1e-9) continue;
      open.push({
        symbol,
        isin: lot.isin,
        entryDate: lot.date,
        quantity: lot.left,
        buyValue: round2(lot.left * lot.price),
        charges: round2(lot.left * lot.chargePerShare),
      });
    }
  }

  // One line per symbol, not per sell. A holding sold down over a fortnight
  // produces a shortfall on every one of those sells, and the real file turned
  // three affected symbols into forty-seven near-identical warnings — which
  // reads as catastrophe and gets scrolled past, so the three names that
  // actually matter are lost in it.
  const bySymbol = new Map();
  for (const s of shortfalls) {
    const e = bySymbol.get(s.symbol) || { quantity: 0, sells: 0, first: s.date, last: s.date };
    e.quantity += s.quantity;
    e.sells += 1;
    if (s.date < e.first) e.first = s.date;
    if (s.date > e.last) e.last = s.date;
    bySymbol.set(s.symbol, e);
  }

  for (const [symbol, e] of bySymbol) {
    const when = e.first === e.last ? `on ${e.first}` : `between ${e.first} and ${e.last}`;
    warnings.push(
      `${symbol}: ${e.quantity} shares sold ${when} that this file doesn't show being bought` +
      `${e.sells > 1 ? ` (across ${e.sells} sells)` : ""}. ` +
      `Usually they were bought before the file's start date, or arrived as a bonus, ` +
      `split or demerger. Those shares are left out rather than guessed at.`
    );
  }

  return { lots, open, warnings, shortfalls };
}

function daysBetween(a, b) {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86400000) : null;
}

/**
 * The leftovers, as positions rather than lots.
 *
 * One position per symbol and entry date, at the weighted-average price —
 * the same identity `import-pipeline.js` uses for closed trades, and for the
 * same reason: four buys filling one decision on one morning are one position,
 * and recording them flat would quadruple the trade count and give each
 * fragment its own R.
 *
 * Buys on DIFFERENT days stay separate, which is a deliberate refusal rather
 * than an oversight. Adding to a winner a week later might be one position to
 * you or two; the file cannot tell, and merging them would silently rewrite an
 * entry price. Two rows can be merged by hand — an averaged one cannot be
 * taken apart.
 */
export function openPositions(open) {
  const byKey = new Map();

  for (const lot of open) {
    const k = `${lot.symbol}|${lot.entryDate}`;
    const p = byKey.get(k) || {
      symbol: lot.symbol, isin: lot.isin, entryDate: lot.entryDate,
      quantity: 0, buyValue: 0, charges: 0, buys: 0,
    };
    p.quantity += lot.quantity;
    p.buyValue += lot.buyValue;
    p.charges += lot.charges;
    p.buys += 1;
    byKey.set(k, p);
  }

  return [...byKey.values()]
    .map((p) => ({ ...p, entryPrice: p.quantity > 0 ? p.buyValue / p.quantity : 0 }))
    .sort((a, b) => (a.entryDate < b.entryDate ? 1 : a.entryDate > b.entryDate ? -1 : a.symbol.localeCompare(b.symbol)));
}

/**
 * Open positions as journal rows, and the ones already there.
 *
 * WHAT THIS DELIBERATELY DOES NOT FILL IN. No stop, so no 1R and no R. The
 * tradebook says what you bought, never what you were risking, and a guess
 * there would corrupt every statistic built on R while looking like a
 * measurement. Imported positions land in the `/stops` queue, which exists
 * for exactly this — the same chore an imported tax P&L already creates.
 *
 * Nor a thesis, a pattern or a pivot. Those are the journal, and importing
 * them is not possible because no broker records what you were thinking.
 *
 * CHARGES ARE LEFT TO THE APP, which is the one place this differs from a tax
 * P&L import. There a zero is the broker's own figure and is honoured as the
 * truth; here the tradebook simply has no charges column at all, so a stored
 * zero would be a fabrication rather than a fact. `charges_auto` hands it to
 * the calculator that already knows Indian buy-side costs.
 *
 * `targets` are the journal's existing rows. A position matching one already
 * held on symbol and entry date is reported as a duplicate rather than
 * written — re-running an import must not double a holding.
 */
export function toOpenTradeRows(positions, { batchId, exchange = "NSE", broker = null, targets = [] } = {}) {
  const held = new Set(
    (targets || [])
      .filter((t) => t.status !== "closed")
      .map((t) => `${String(t.symbol).toUpperCase()}|${t.entry_date}`)
  );

  const rows = [];
  const duplicates = [];

  for (const p of positions) {
    const key = `${p.symbol.toUpperCase()}|${p.entryDate}`;
    if (held.has(key)) { duplicates.push(p); continue; }

    rows.push({
      symbol: p.symbol,
      exchange,
      side: "long",
      status: "open",
      broker,

      entry_date: p.entryDate,
      entry_price: round2(p.entryPrice),
      quantity: p.quantity,
      acquisition: "purchase",

      // See the note above. The stops page is where these get their 1R.
      stop_loss: null,
      initial_stop_loss: null,
      stop_source: null,

      exit_date: null,
      exit_price: null,
      exit_reason: null,

      charges: 0,
      charges_auto: true,

      imported: true,
      import_batch: batchId,
      exits: [],

      _preview: { buys: p.buys, buyValue: round2(p.buyValue) },
    });
  }

  return { rows, duplicates };
}
