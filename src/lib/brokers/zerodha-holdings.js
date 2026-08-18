/**
 * Zerodha's holdings — the file that says what you own right now.
 *
 * WHY A THIRD ZERODHA ADAPTER. The tax P&L covers closed trades by definition
 * and the tradebook only reaches back as far as its own start date, so someone
 * who has held ONGC since 2023 and downloads one financial year gets neither.
 * A holdings statement is the only export that states every open position
 * without qualification, which makes it the one file that can answer "what am
 * I holding" completely.
 *
 * WHAT IT CANNOT SAY IS WHEN. No broker's holdings export carries a purchase
 * date — not Zerodha's, not Dhan's. That is the whole difficulty of this path
 * and the reason for `entry_date_source` (migration 036): the date has to be
 * invented to satisfy a NOT NULL column, and everything downstream has to know
 * it was invented. See `holdings.js` for what gets written.
 *
 * TWO SHAPES, BOTH REAL, both tested against files from this user's account.
 *
 *   A. The Kite web export — a CSV, nine columns, no ISIN and no dates:
 *      Instrument, Qty., Avg. cost, LTP, Invested, Cur. val, P&L, Net chg.,
 *      Day chg. It is what you get from the Holdings tab's download arrow, so
 *      it is what most people will reach for.
 *
 *   B. The Console "Equity Holdings Statement" — an xlsx, and much the better
 *      file: Symbol, ISIN, Sector, Quantity Available, Quantity Discrepant,
 *      Quantity Long Term, Quantity Pledged (Margin), Quantity Pledged (Loan),
 *      Average Price, Previous Closing Price — plus an "as on" date in the
 *      title block. It comes from the same Console the tax P&L does, so anyone
 *      who managed that report can fetch this one.
 *
 * B IS PREFERRED AND THE SCREEN SHOULD SAY SO, for two reasons that matter
 * later: the ISIN makes symbol resolution unambiguous the way it already is
 * for imports, and `Quantity Long Term` proves a position is over a year old,
 * which is the only evidence either file offers about WHEN — enough to know
 * that dating it today is wrong, if not enough to say what is right.
 *
 * QUANTITY LONG TERM IS A SUBSET, NOT AN ADDITION. Verified in the real file:
 * GOLDIAM reads 336 available against 169 long term. Adding them would have
 * silently inflated that holding by half. Every position's cost basis was
 * checked the same way — quantity × Average Price summed to 4,434,616.30
 * against the file's own stated Invested Value of 4,434,616.35, so the average
 * is the cost of the shares still held, which is exactly what an open position
 * needs and is already net of whatever was sold earlier.
 *
 * DETECTION CANNOT COLLIDE with the other two Zerodha adapters. The tax P&L is
 * recognised by a "Tradewise Exits" sheet and the tradebook by Trade Date plus
 * Trade Type; neither label appears here, and neither of them carries
 * "Avg. cost" or "Quantity Available".
 */

const norm = (v) => String(v ?? "").trim();
const key = (v) => norm(v).toLowerCase().replace(/[^a-z]/g, "");
const num = (v) => {
  const n = Number(norm(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

export const id = "zerodha_holdings";
export const label = "Zerodha holdings";

/**
 * Open positions, not matched lots.
 *
 * Read by the import screen to decide which half of the pipeline a file goes
 * through. A tax P&L yields closed trades, a tradebook yields both, and this
 * yields open positions only.
 */
export const kind = "holdings";

/* ------------------------------------------------------------------ */
/*  Recognising the two shapes                                         */
/* ------------------------------------------------------------------ */

/** Console xlsx: a Symbol column beside a Quantity Available column. */
const isConsole = (labels) =>
  labels.has("symbol") && labels.has("quantityavailable") && labels.has("averageprice");

/** Kite CSV: Instrument beside Avg. cost. Nothing else exports that pair. */
const isKite = (labels) => labels.has("instrument") && labels.has("avgcost");

/**
 * Reads cells directly rather than converting to rows, because detection runs
 * before anything has decided this file is ours — same approach as the
 * tradebook adapter, and for the same reason.
 */
function labelsIn(ws) {
  const out = new Set();
  if (!ws) return out;
  for (const addr of Object.keys(ws)) {
    if (addr[0] === "!") continue;
    const v = ws[addr]?.v;
    if (typeof v === "string") out.add(key(v));
  }
  return out;
}

export function findSheet(workbook) {
  // The Console file has Equity, Mutual Funds and Combined sheets. Equity is
  // the one wanted, but it is found by its columns rather than its name so a
  // renamed or reordered workbook still reads.
  for (const n of workbook?.SheetNames || []) {
    const labels = labelsIn(workbook.Sheets?.[n]);
    if (isConsole(labels) || isKite(labels)) return n;
  }
  return null;
}

export function detect(workbook) {
  return !!findSheet(workbook);
}

/**
 * Detection from rows rather than a workbook, for the CSV path.
 *
 * The import screen used to treat "it is a CSV" as proof of a Zerodha tax
 * P&L, because that was the only report anyone offered in that format. Kite's
 * holdings export is a CSV too, so the file extension no longer identifies
 * anything and the header row has to be read instead.
 */
export function detectRows(rows) {
  return !!findHeader(rows);
}

/* ------------------------------------------------------------------ */
/*  Reading it                                                         */
/* ------------------------------------------------------------------ */

const CONSOLE_COLS = {
  symbol: ["symbol"],
  isin: ["isin"],
  sector: ["sector"],
  available: ["quantityavailable"],
  discrepant: ["quantitydiscrepant"],
  longTerm: ["quantitylongterm"],
  pledgedMargin: ["quantitypledgedmargin"],
  pledgedLoan: ["quantitypledgedloan"],
  avgPrice: ["averageprice"],
};

const KITE_COLS = {
  symbol: ["instrument"],
  available: ["qty", "quantity"],
  avgPrice: ["avgcost"],
  // Not for display — for precision. See `preciseAvg` below.
  invested: ["invested"],
};

/** The header row, wherever it landed, and which column went where. */
function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const cells = (rows[r] || []).map(key);
    const labels = new Set(cells);
    const shape = isConsole(labels) ? "console" : isKite(labels) ? "kite" : null;
    if (!shape) continue;

    const wanted = shape === "console" ? CONSOLE_COLS : KITE_COLS;
    const map = {};
    for (const [want, names] of Object.entries(wanted)) {
      const i = cells.findIndex((c) => names.includes(c));
      if (i >= 0) map[want] = i;
    }
    return { row: r, map, shape };
  }
  return null;
}

/**
 * "Equity Holdings Statement as on 2026-07-29" → "2026-07-29".
 *
 * Worth having because it bounds the guess: nothing in the file can have been
 * bought after the day the file describes. The Kite CSV has no such line and
 * returns null, which is honest — a missing bound is better than today's date
 * pretending to be one.
 */
/**
 * The average cost, to the precision the file actually holds.
 *
 * The Kite CSV rounds `Avg. cost` to two decimals but carries `Invested` in
 * full, so dividing recovers what was rounded away. It is not a nicety: across
 * ten holdings the rounded column overstated the book by ₹28, and PARACABLES
 * alone by ₹24 — because 8,485 shares multiply a half-paisa error 8,485 times.
 *
 * Checked against the Console file, which states the unrounded figure itself:
 * 609,622.69 ÷ 8,485 gives 71.8471, exactly what Console reports. The two
 * shapes therefore agree to the paisa instead of drifting apart by position
 * size, which matters because the same person may import either one.
 *
 * Falls back to the stated column when there is no Invested value to divide.
 */
function preciseAvg(invested, quantity, stated) {
  if (invested > 0 && quantity > 0) {
    const derived = invested / quantity;
    // Guard against a mismatched pair — a totals row, or a column that turned
    // out to mean something else. A derived average should be within a rupee
    // or a percent of the stated one; anything further apart is not precision,
    // it is a misread, and the stated figure is the safer answer.
    if (Math.abs(derived - stated) <= Math.max(1, stated * 0.01)) return derived;
  }
  return stated;
}

function asOfFrom(rows) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    for (const cell of rows[r] || []) {
      const m = norm(cell).match(/as on\s+(\d{4})-(\d{2})-(\d{2})/i);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      const dmy = norm(cell).match(/as on\s+(\d{1,2})[-/](\d{1,2})[-/](\d{4})/i);
      if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    }
  }
  return null;
}

/**
 * Rows in, holdings out.
 *
 * Shape: { symbol, isin, quantity, avgPrice, longTermQty, sector }, plus the
 * statement date and any warnings. Deliberately NOT the lot shape the closed
 * pipeline consumes — a holding has no exit and never will until it is sold.
 */
export function parseRows(rows) {
  const warnings = [];
  const found = findHeader(rows);

  if (!found) {
    return { holdings: [], warnings: ["No holdings header row found in this sheet."], asOf: null };
  }

  const { row: h, map, shape } = found;
  const missing = ["symbol", "available", "avgPrice"].filter((k) => map[k] === undefined);
  if (missing.length) {
    return { holdings: [], warnings: [`Missing columns: ${missing.join(", ")}`], asOf: null };
  }

  const asOf = asOfFrom(rows);
  const holdings = [];
  let pledgedSeen = 0;

  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const symbol = norm(row[map.symbol]).toUpperCase();
    if (!symbol) continue;

    // The Console file ends with a totals block and the Kite CSV with a blank
    // trailing column; neither has a usable average, so both fall out here
    // rather than needing a rule about where the table stops.
    const statedAvg = num(row[map.avgPrice]);
    const at = (k) => (map[k] !== undefined ? num(row[map[k]]) || 0 : 0);

    /**
     * Pledged shares are still owned, so they count. Discrepant ones are a
     * mismatch between broker and depository rather than a holding, and are
     * left out and named instead.
     *
     * Every pledged column was zero in the file this was written against, so
     * that addition is the one untested line here — which is why a non-zero
     * one warns rather than passing silently. Better to be told the number
     * came from an unproven path than to find out from a wrong position size.
     */
    const pledged = at("pledgedMargin") + at("pledgedLoan");
    if (pledged > 0) pledgedSeen += 1;
    const quantity = (num(row[map.available]) || 0) + pledged;

    const discrepant = at("discrepant");
    if (discrepant > 0) {
      warnings.push(
        `${symbol}: ${discrepant} shares are marked discrepant by your broker and are ` +
        `left out. That is a mismatch between Zerodha and the depository, not stock ` +
        `you can sell — sort it out with them and re-import.`
      );
    }

    if (!(quantity > 0)) continue;
    if (!(statedAvg > 0)) {
      warnings.push(`${symbol}: no average cost in this file — skipped, since there is no entry price without it.`);
      continue;
    }

    const avgPrice = preciseAvg(at("invested"), quantity, statedAvg);

    const longTermQty = at("longTerm");

    holdings.push({
      symbol,
      isin: map.isin !== undefined ? norm(row[map.isin]) : "",
      sector: map.sector !== undefined ? norm(row[map.sector]) : "",
      quantity,
      avgPrice,
      // A subset of quantity, never an addition — see the note at the top.
      // Non-zero proves the position is over a year old, which is the only
      // thing either file says about when it was opened.
      longTermQty,
    });
  }

  if (pledgedSeen > 0) {
    warnings.push(
      `${pledgedSeen} ${pledgedSeen === 1 ? "holding is" : "holdings are"} partly pledged. ` +
      `Pledged shares are counted as held, since you still own them — check those ` +
      `quantities against your broker before relying on them.`
    );
  }

  return { holdings, warnings, asOf, shape };
}
