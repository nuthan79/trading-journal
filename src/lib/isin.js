/**
 * ISIN to trading symbol.
 *
 * WHY THIS EXISTS. Zerodha's tax P&L states a symbol, so the importer never
 * needed to work one out and nothing ever did. Every other broker states only
 * a security NAME — and the names are not symbols. A real Dhan import landed
 * fourteen trades under "Route Mobile", "CMS Info Systems" and "Godfrey
 * Phillips", which are `ROUTE`, `CMSINFO` and `GODFRYPHLP`.
 *
 * That is not cosmetic. The symbol is what the quote proxy asks Yahoo for, so
 * those positions would never have priced; it is what the dedupe compares, so
 * the same trade from two brokers would import twice; and it is what every
 * screen groups by. A journal full of names that look right and match nothing
 * is worse than an import that refused.
 *
 * MATCHED ON ISIN, NEVER ON THE NAME. An ISIN is issued per security and
 * appears in every broker's report. A name is written however that broker
 * feels — and the failure mode of name matching is not a miss, it is a wrong
 * match against some other company with a similar name.
 *
 * The list is the same public/symbols.json the autocomplete uses, built by
 * scripts/build-symbols.mjs. Fetched once and held, because an import reads
 * it a few hundred times in a loop.
 */

let INDEX = null;
let LOADING = null;

async function index() {
  if (INDEX) return INDEX;
  if (!LOADING) {
    LOADING = fetch("/symbols.json")
      .then((r) => r.json())
      .then((rows) => {
        const by = new Map();
        for (const r of rows) {
          // `i` is the ISIN, `s` the symbol, `e` the exchange — the short keys
          // keep a 2,400-row file small enough to ship to the browser.
          if (r?.i && r?.s && !by.has(r.i)) by.set(r.i, r);
        }
        INDEX = by;
        return by;
      })
      .catch(() => {
        // A failed fetch must not fail the import. Unresolved lots keep the
        // name the broker gave, which is what happened before this existed.
        INDEX = new Map();
        return INDEX;
      });
  }
  return LOADING;
}

/**
 * Fill in real symbols, and say which could not be.
 *
 * Resolution wins over whatever the adapter supplied, including Zerodha's own
 * symbol column: both come from the same security, and the ISIN is the one
 * that cannot be spelled differently by different brokers. Where the ISIN is
 * absent or unknown the original value is kept — a missing entry in the list
 * is a reason to leave a lot alone, not to blank it.
 *
 * `unresolved` is returned rather than logged so the import screen can name
 * the securities it could not identify. A symbol that quietly stayed a
 * company name is exactly the kind of thing nobody notices until a position
 * refuses to price weeks later.
 */
export async function resolveSymbols(lots) {
  const by = await index();
  if (!by.size) return { lots, unresolved: [], resolved: 0 };

  const unresolved = [];
  let resolved = 0;

  const out = lots.map((l) => {
    const hit = l.isin ? by.get(l.isin) : null;
    if (!hit) {
      if (l.isin) unresolved.push({ isin: l.isin, name: l.symbol });
      return l;
    }
    if (hit.s !== l.symbol) resolved++;
    return { ...l, symbol: hit.s, exchange: hit.e || l.exchange };
  });

  return { lots: out, unresolved, resolved };
}
