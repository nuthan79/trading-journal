/**
 * Champions journal — a whole trading journal, not a broker report.
 *
 * WHAT MAKES THIS FILE DIFFERENT FROM EVERY OTHER IMPORT, and the reason it
 * gets its own kind: it carries the STOP. A tax P&L knows what a trade made
 * and cannot know what was risked to make it, which is why imported books
 * arrive with `stop_source: "assumed"` and every R figure downstream sits
 * behind a caveat. This file was written by a trader recording their own
 * decisions, so the stop on each row is the stop they actually set — and with
 * it, R stops being a rescaling of percentage return and becomes a
 * measurement.
 *
 * It also carries both halves of the book. Closed positions with their exit
 * tranches, and positions still running, in one sheet — where the broker
 * formats split that across a tax P&L and a holdings file.
 *
 * THE SHEET'S SHAPE. One row opens a position and the rows beneath it, with
 * the first fifteen columns blank, are its exits:
 *
 *   Date  Symbol  Quantity  Entry  Type  SL  SL%  RPT  Position Size  …
 *   ''    ''      ''        ''     ''    ''  ''   ''   ''             …  Exit Date  Exit Price  Exit Quantity  …
 *
 * So a position is a header row plus zero or more continuation rows, and a
 * position with no continuation rows is one that has not been sold at all.
 * Read row by row without that rule, every exit tranche looks like a trade
 * with no symbol.
 *
 * DATES ARE EXCEL SERIALS. 45707 is 19 February 2025, and read as a number it
 * is a plausible price. They are converted here, at the edge, so nothing
 * downstream ever sees one.
 */

const num = (v) => {
  if (v === null || v === undefined || v === "") return NaN;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Excel's day zero is 30 December 1899, and the serial is a whole number of
 * days — so this is exact arithmetic, not a parse. Built in UTC and read back
 * with the UTC getters, because a date that is only ever a calendar day must
 * not acquire a timezone on the way in.
 */
function fromSerial(v) {
  if (typeof v === "string") {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);   // dd/mm/yyyy
    if (d) return `${d[3]}-${String(d[2]).padStart(2, "0")}-${String(d[1]).padStart(2, "0")}`;
    return null;
  }
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  /* Serial 1 is 1 Jan 1900 and 60 is Excel's mythical 29 Feb 1900; anything
     below 61 is not a trade date and is refused rather than shifted. */
  if (v < 61 || v > 80000) return null;
  const ms = Math.round((v - 25569) * 86400000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export const id = "champions";
export const label = "Champions journal";

/**
 * Its own kind. It writes trades like a tax P&L and open positions like a
 * holdings file, and it is neither: those two cannot supply a stop and this
 * one does. `kindOf` returning "journal" is what lets the import screen treat
 * it as a whole book rather than as lots.
 */
export const kind = "journal";

const SHEET = "Trades";

/** The header this reader was written against, in the order it appears. */
const COL = {
  date: 0, symbol: 1, quantity: 2, entry: 3, type: 4, sl: 5, slPct: 6,
  rpt: 7, size: 8, exitPrice: 9, exitPct: 10, days: 11, rr: 12,
  charges: 13, netProfit: 14,
  xDate: 15, xPrice: 16, xQty: 17, xPct: 18, xCharges: 19, xProfit: 20,
  tags: 21,
};

const HEADER_MARKS = ["symbol", "quantity", "entry", "sl", "rpt", "exit date", "exit quantity"];

export function findSheet(workbook) {
  const names = workbook?.SheetNames || [];
  return names.find((n) => n.trim().toLowerCase() === SHEET.toLowerCase())
      || names.find((n) => /^trades?$/i.test(n.trim()))
      || null;
}

export function detectRows(rows) {
  const head = (rows?.[0] || []).map((h) => String(h ?? "").trim().toLowerCase());
  if (!head.length) return false;
  /* Every mark, not most of them. "Symbol" and "Quantity" alone appear in half
     the broker files in existence; RPT beside a per-tranche Exit Quantity is
     what makes this sheet this sheet. */
  return HEADER_MARKS.every((m) => head.includes(m));
}

export function detect(workbook) {
  const sheet = findSheet(workbook);
  if (!sheet) return false;
  const XLSX = workbook?._XLSX;
  const rows = XLSX
    ? XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1, raw: true, defval: null })
    : null;
  if (rows) return detectRows(rows);
  /* No reader handed in — fall back to the workbook's own shape, which is
     distinctive enough: this file always ships its summaries beside the
     trades, and no broker report does. */
  const names = (workbook?.SheetNames || []).map((n) => n.trim().toLowerCase());
  return names.includes("trades") && names.some((n) => n.startsWith("summary"));
}

/**
 * Positions, each with its own exits.
 *
 * Returns the shape `journal.js` turns into trade rows — deliberately not the
 * flat lot list the tax P&L adapters produce. Flattening a position into lots
 * here would throw away the stop, which is the only reason this file is worth
 * reading.
 */
export function parseRows(rows) {
  const warnings = [];
  const positions = [];
  let cur = null;

  const close = () => { if (cur) positions.push(cur); cur = null; };

  for (let i = 1; i < (rows?.length || 0); i++) {
    const r = rows[i] || [];
    const symbol = String(r[COL.symbol] ?? "").trim().toUpperCase();

    if (symbol) {
      close();
      const entryDate = fromSerial(r[COL.date]);
      const quantity = num(r[COL.quantity]);
      const entryPrice = num(r[COL.entry]);
      const stop = num(r[COL.sl]);

      if (!entryDate || !(quantity > 0) || !(entryPrice > 0)) {
        warnings.push(`${symbol || `Row ${i + 1}`}: no entry date, quantity or price — skipped`);
        cur = null;
        continue;
      }

      cur = {
        symbol,
        entryDate,
        quantity,
        entryPrice,
        /* "Long"/"Short" as written. Anything else is left long rather than
           guessed at — every row in the file measured so far is long, and a
           mis-read side flips the sign of every figure on the trade. */
        side: /short/i.test(String(r[COL.type] ?? "")) ? "short" : "long",
        /* THE POINT OF THIS ADAPTER. Only taken when it is a real price on the
           right side of the entry; a zero or a stop above a long's entry is a
           recording slip, and importing it would produce a negative 1R that
           every R in the app then divides by. */
        stop: stop > 0 ? stop : null,
        /* What the trader says they risked, in rupees. Kept for the preview to
           show against what the app computes from the stop — the two
           disagreeing means the stop was moved after entry. */
        rpt: num(r[COL.rpt]),
        charges: Math.abs(num(r[COL.charges])) || 0,
        netProfit: num(r[COL.netProfit]),
        tags: String(r[COL.tags] ?? "").split(",").map((t) => t.trim()).filter(Boolean),
        exits: [],
        row: i + 1,
      };
      continue;
    }

    /* A continuation row: an exit belonging to the position above it. */
    const xDate = fromSerial(r[COL.xDate]);
    if (!xDate) continue;
    if (!cur) { warnings.push(`Row ${i + 1}: an exit with no position above it — skipped`); continue; }

    const q = num(r[COL.xQty]);
    const p = num(r[COL.xPrice]);
    if (!(q > 0) || !(p > 0)) {
      warnings.push(`${cur.symbol}: an exit on ${xDate} has no quantity or price — skipped`);
      continue;
    }
    cur.exits.push({
      exit_date: xDate,
      quantity: q,
      price: p,
      charges: Math.abs(num(r[COL.xCharges])) || 0,
      profit: num(r[COL.xProfit]),
    });
  }
  close();

  /* Sold more than was bought. Reported rather than corrected: the file is the
     trader's own record and the app is not the one to decide which number is
     wrong. */
  for (const p of positions) {
    const sold = p.exits.reduce((a, e) => a + e.quantity, 0);
    if (sold > p.quantity + 1e-6) {
      warnings.push(
        `${p.symbol} (${p.entryDate}): exits total ${sold} against a position of ${p.quantity} — imported as recorded.`
      );
    }
  }

  return { positions, warnings };
}
