/**
 * Groww's capital gains statement.
 *
 * The file that prompted this arrived named for a different broker entirely —
 * `DHAN Stocks_Capital_Gains_Report_….xlsx` — and is a Groww report. Which is
 * exactly why detection reads the contents and never the filename: only the
 * disclaimer at the bottom names who wrote it.
 *
 * THE THING THIS FORMAT DOES NOT GIVE YOU IS CHARGES PER TRADE. They appear
 * once, at the top, as a summary for the whole period: brokerage, STT, stamp
 * duty, DP, GST, exchange and SEBI fees, all as period totals.
 *
 * Those totals are deliberately NOT divided across the trades. Splitting a
 * period's brokerage by turnover would produce a per-trade figure that is
 * arithmetically tidy and factually invented — and it would be written into
 * the journal looking exactly like a figure the broker had stated. The app
 * already has a charges calculator that models the real Indian rules, so the
 * charges are COMPUTED per trade instead and flagged as computed.
 *
 * That distinction is the whole reason `charges_auto` exists: a stated figure
 * is a fact and must never be recalculated, while a computed one may be. An
 * imported zero would be read as "this trade genuinely cost nothing", which is
 * true of demerged shares and false of every trade in this file.
 *
 * WHAT IS EXACT AND WHAT IS NOT. Every statutory component — STT, exchange
 * transaction charges, SEBI fee, stamp duty, GST, DP — is fixed by rule and
 * identical whichever broker executed the trade. Only brokerage varies, and
 * it is computed from whatever preset the user has configured, which may not
 * be the plan these particular trades were executed under. The import screen
 * says so rather than letting a precise-looking number imply otherwise.
 */

import { tradeCharges } from "../charges";

export const id = "groww";
export const label = "Groww";

const norm = (v) => String(v ?? "").trim();
const key = (v) => norm(v).toLowerCase().replace(/\s+/g, " ");

/**
 * Sections carried into the journal, and sections passed over.
 *
 * Short and long term are the same thing to a journal — closed delivery
 * trades. The split exists for tax, where holding period changes the rate,
 * and nothing here cares about that.
 *
 * Intraday is excluded because this is a swing journal and an intraday
 * position has no overnight risk to measure in R. Buyback is excluded because
 * a tender is not a trade you took: the price was set by the company, not by
 * a decision worth reviewing.
 */
export const INCLUDED_SECTIONS = ["short term trades", "long term trades"];
export const EXCLUDED_SECTIONS = ["intraday trades", "buyback trades"];

const SECTION_HEADS = [...INCLUDED_SECTIONS, ...EXCLUDED_SECTIONS];

function num(v) {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * `06-02-2025` → `2025-02-06`.
 *
 * Day-first, which is unambiguous here only because the format is fixed by
 * the report rather than by a locale. Anything that does not match is returned
 * as null and the row is reported rather than guessed at — a date read the
 * wrong way round silently moves a trade to another financial year.
 */
export function toDate(v) {
  const s = norm(v);
  let m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  return null;
}

export function findSheet(workbook) {
  const names = workbook?.SheetNames || [];
  return names.length ? names[0] : null;
}

/**
 * Groww, specifically — not merely "a spreadsheet with capital gains in it".
 *
 * Two pieces of evidence, because one is not enough. Several brokers title a
 * report "Capital Gains Statement"; only Groww's carries its own company name
 * in the disclaimer. Matching the title alone would claim Dhan's file, and an
 * adapter that confidently misreads another broker's format is worse than one
 * that declines.
 */
export function detect(workbook) {
  const sheet = findSheet(workbook);
  if (!sheet) return false;
  const text = sheetText(workbook, sheet);
  return text.includes("groww") && text.includes("capital gains statement");
}

/**
 * Every cell's text, lowercased.
 *
 * Read straight off the SheetJS worksheet rather than through its utils,
 * because detection runs before anything decides this file is worth loading a
 * parser for — and an adapter that imports the spreadsheet library would put
 * it in the bundle of everyone who never imports a file.
 *
 * A SheetJS sheet is keyed by cell reference with metadata under keys starting
 * `!`, hence the skip.
 */
function sheetText(workbook, name, limit = 600) {
  const ws = workbook?.Sheets?.[name];
  if (!ws) return "";
  const out = [];
  let n = 0;
  for (const ref of Object.keys(ws)) {
    if (ref[0] === "!") continue;
    const v = ws[ref]?.w ?? ws[ref]?.v;
    if (v != null) out.push(String(v));
    if (++n > limit) break;
  }
  return out.join(" | ").toLowerCase();
}

/**
 * The summary block at the top, which states what the period really cost.
 *
 * Worth reading precisely because the charges are computed rather than taken
 * from the file: this is the one number that can tell us the computation was
 * wrong. Testing against a real report, the adapter came out at ₹460 against
 * a stated ₹925 — because Groww bills 0.1% brokerage and the configured
 * preset was zero-brokerage. Every statutory component matched to the paisa;
 * only brokerage, and the GST on it, were missing.
 *
 * Without this check that gap is invisible. The trades import, the journal
 * looks complete, and every R is quietly flattered by costs that were never
 * counted. With it, the import can say so and the user can change one setting.
 *
 * MTF interest is excluded from the comparison. It is a financing cost for
 * carrying a leveraged position, not a cost of transacting, and no charges
 * calculator should be expected to produce it.
 */
const SUMMARY_LABELS = {
  "exchange transaction charges": "exchange",
  "sebi charges": "sebi",
  "stt": "stt",
  "stamp duty": "stampDuty",
  "ipft charges": "ipft",
  "brokerage": "brokerage",
  "dp charges": "dp",
  "total gst": "gst",
  "mtf interest": "mtfInterest",
  "total": "total",
};

export function parseSummary(rows) {
  const found = {};
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const label = SUMMARY_LABELS[key(row[0])];
    if (!label || found[label] != null) continue;
    const v = row.slice(1).find((c) => norm(c) !== "");
    if (v != null) found[label] = num(v);
  }
  if (found.total == null) return null;
  return {
    ...found,
    // What a charges calculator could reasonably be expected to reproduce.
    comparable: Math.round((found.total - (found.mtfInterest || 0)) * 100) / 100,
  };
}

/** Column positions, read from the header row rather than assumed. Groww has
 *  changed this report's shape before and a fixed index would move silently. */
const COLS = {
  name: ["stock name"],
  isin: ["isin"],
  quantity: ["quantity"],
  buyDate: ["buy date"],
  buyPrice: ["buy price"],
  buyValue: ["buy value"],
  sellDate: ["sell date"],
  sellPrice: ["sell price"],
  sellValue: ["sell value"],
  profit: ["realised p&l", "realized p&l"],
  /**
   * Not in the report today. Looked for anyway.
   *
   * Brokers change these files — Groww has already changed this one's shape
   * once. If a charges column ever appears, the failure without this would be
   * silent and permanent: a stated figure sitting in the file, ignored, while
   * the journal used a number computed from whatever brokerage plan the user
   * happens to have configured. The cross-check below would warn forever, and
   * no setting could honestly silence it.
   *
   * Several spellings because it is a guess about a future file. A name that
   * never appears costs nothing; the one that does appear is the one that
   * matters. Zerodha calls its columns "Brokerage" and "STT", Dhan uses
   * "Total Charges", Angel One "Charges and Statutory Levies" — so the
   * plausible set is small and worth listing.
   */
  charges: [
    "charges", "total charges", "charges and statutory levies",
    "taxes and charges", "total charges and levies",
  ],
};

function headerMap(row) {
  const map = {};
  row.forEach((cell, i) => {
    const k = key(cell);
    for (const [field, names] of Object.entries(COLS)) {
      if (names.includes(k)) map[field] = i;
    }
  });
  return map;
}

const isHeaderRow = (row) => {
  const cells = row.map(key);
  return cells.includes("isin") && cells.includes("quantity");
};

/**
 * Rows in, lots out.
 *
 * `chargeConfig` is the user's broker settings. Without one the charges come
 * out as the defaults, which is still far closer than zero — but the caller
 * should pass it.
 */
export function parseRows(rows, { chargeConfig = null, exchange = "NSE" } = {}) {
  const lots = [];
  const warnings = [];
  // Advisories: things worth knowing that did NOT cost you a row.
  const notes = [];
  const sectionCounts = {};

  let section = null;
  let cols = null;
  let statedRows = 0;
  let computedRows = 0;

  rows.forEach((row, i) => {
    if (!Array.isArray(row)) return;
    const cells = row.map((c) => norm(c)).filter(Boolean);
    if (!cells.length) return;

    const first = key(cells[0]);
    if (SECTION_HEADS.includes(first)) { section = first; cols = null; return; }
    if (isHeaderRow(row)) { cols = headerMap(row); return; }
    if (!section || !cols) return;

    sectionCounts[section] = (sectionCounts[section] || 0) + 1;
    if (!INCLUDED_SECTIONS.includes(section)) return;

    const isin = norm(row[cols.isin]);
    const quantity = num(row[cols.quantity]);
    const entryDate = toDate(row[cols.buyDate]);
    const exitDate = toDate(row[cols.sellDate]);
    const buyValue = num(row[cols.buyValue]);
    const sellValue = num(row[cols.sellValue]);

    // Reported, never guessed at. A row missing any of these cannot be made
    // into a position, and inventing the gap is how a fabricated buy value
    // once turned three shares into an R of five thousand.
    if (!isin || !quantity || !entryDate || !exitDate) {
      warnings.push(
        `Row ${i + 1}: skipped — ${!isin ? "no ISIN" : !quantity ? "no quantity"
          : !entryDate ? "unreadable buy date" : "unreadable sell date"}.`
      );
      return;
    }

    const buyPrice = num(row[cols.buyPrice]) || (quantity ? buyValue / quantity : 0);
    const sellPrice = num(row[cols.sellPrice]) || (quantity ? sellValue / quantity : 0);

    /**
     * A stated figure beats a computed one, always.
     *
     * The report has no charges column today, so this computes — see the note
     * at the top for why the period totals are not divided up instead. But if
     * one ever appears, what the broker actually billed is a fact and this
     * calculator is a model of the rules, and a model is only ever as right as
     * the brokerage plan someone remembered to configure.
     *
     * Decided per row rather than per file, because a column can exist and be
     * blank on some rows — a corporate action, a transfer — and computing the
     * gaps is better than importing them as free.
     */
    const stated = cols.charges !== undefined ? num(row[cols.charges]) : NaN;
    const hasStated = Number.isFinite(stated) && stated > 0;

    const c = hasStated ? null : tradeCharges(
      {
        exchange,
        quantity,
        entry_price: buyPrice,
        exits: [{ price: sellPrice, quantity }],
      },
      chargeConfig
    );
    if (hasStated) statedRows++; else computedRows++;

    lots.push({
      section,
      symbol: norm(row[cols.name]),   // a label; ISIN is the key
      isin,
      entryDate,
      exitDate,
      quantity,
      buyValue,
      sellValue,
      profit: num(row[cols.profit]) || sellValue - buyValue,
      charges: hasStated ? stated : Number(c?.total ?? c?.sellTotal ?? 0),
      // Per lot, so a mixed file is described honestly rather than by
      // whichever kind happened to be in the majority.
      chargesComputed: !hasStated,
      holdingDays: null,
    });
  });

  /**
   * The computed total, held against the one the report states.
   *
   * A tolerance rather than an equality: rounding across dozens of lots will
   * never land exactly, and a rupee or two of drift is not worth alarming
   * anybody about. 5% or ₹50, whichever is larger, is loose enough to ignore
   * rounding and tight enough to catch a missing brokerage model — the real
   * case here was a 50% shortfall.
   *
   * Under-charging is the direction that matters and the message says which
   * way it went: costs that were never counted make every R look better than
   * it was, which is the specific lie this journal exists to avoid telling.
   */
  const summary = parseSummary(rows);
  const computedTotal = Math.round(lots.reduce((a, l) => a + l.charges, 0) * 100) / 100;

  /**
   * Only worth checking against a figure we produced.
   *
   * Once the file states its own charges there is nothing to second-guess:
   * the summary and the rows both come from Groww, and a disagreement between
   * them is Groww's arithmetic, not a mis-set brokerage plan. Warning about it
   * would send somebody to change a setting that is no longer used.
   */
  if (summary?.comparable && lots.length && computedRows > 0 && statedRows === 0) {
    const diff = computedTotal - summary.comparable;
    const tolerance = Math.max(50, summary.comparable * 0.05);
    if (Math.abs(diff) > tolerance) {
      notes.push(
        `Charges worked out to ₹${computedTotal.toFixed(2)}, but this report says the ` +
        `period actually cost ₹${summary.comparable.toFixed(2)}` +
        (summary.mtfInterest ? ` (excluding ₹${summary.mtfInterest.toFixed(2)} MTF interest)` : "") +
        `. ${diff < 0 ? "Under" : "Over"}stated by ₹${Math.abs(diff).toFixed(2)}` +
        (summary.brokerage
          ? ` — this report shows ₹${summary.brokerage.toFixed(2)} of brokerage, so check the ` +
            `brokerage rate in Setup matches the account these trades were made in.`
          : ` — check your charge settings in Setup.`)
      );
    }
  }

  return {
    lots,
    warnings,
    notes,
    sectionCounts,
    summary,
    computedTotal,
    missingColumns: [],
    skippedSections: Object.entries(sectionCounts)
      .filter(([s]) => !INCLUDED_SECTIONS.includes(s))
      .map(([s, n]) => ({ section: s, rows: n })),
    /**
     * Whether these charges were worked out or read, said from what actually
     * happened rather than asserted.
     *
     * There is no charges column today, so this is true — but the columns are
     * looked for, and if Groww adds one this flips on its own and the import
     * screen stops claiming the numbers were estimated. A file with the column
     * on some rows only reports true, because some of them were computed and
     * that is the part worth disclosing.
     */
    chargesComputed: computedRows > 0,
    chargesStatedRows: statedRows,
    chargesComputedRows: computedRows,
  };
}
