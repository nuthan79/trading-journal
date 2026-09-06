/**
 * Reading a Chartink scan response.
 *
 * The parse only. Nothing here fetches — how the request is made is a
 * separate question with a security decision inside it, and this file is
 * useful and testable either way.
 *
 * THE SHAPE, from a real response rather than from memory:
 *
 *   { draw, recordsTotal, recordsFiltered, link, data: [ … ] }
 *
 * and each row:
 *
 *   sr                                  1, 2, 3 — the scan's own order
 *   nsecode                             "BOSCHLTD"
 *   bsecode                             "500530", sometimes absent
 *   name                                "Bosch Limited"
 *   scan-column-default-close           46820      RUPEES, with paise
 *   scan-column-default-percent-change  -0.38
 *   scan-column-default-volume          16913
 *   scan-column-_397c4                  "auto"                 ← see below
 *   scan-column-_21f5d                  "auto ancillaries"
 *   scan-column-_dbc53                  38.56
 *
 * THE HASHED COLUMNS ARE PER-SCAN. `_397c4` is not "sector" — it is whatever
 * the fourth column of THIS scan happens to be, and the same column in the
 * next scan will have a different hash. So nothing here may name one: the
 * three `default` columns are read by name, and every other `scan-column-*`
 * is carried through untouched. A screen that grows a column keeps it; a
 * screen whose hashes change on Chartink's side loses nothing.
 *
 * CLOSE IS IN RUPEES. Checked across a real 162-row response — ₹38.02 at the
 * bottom, ₹46,820 at the top, decimals present throughout. Worth stating
 * because every value in the sample happens to look like an integer at the
 * top of the list, and reading them as paise would put every price out by a
 * factor of a hundred while still looking like money.
 */

/** Columns whose meaning is fixed, and which therefore get real names. */
const CLOSE = "scan-column-default-close";
const CHANGE = "scan-column-default-percent-change";
const VOLUME = "scan-column-default-volume";

/* Chartink's own UI colouring for the change cell. Not data. */
const NOISE = new Set(["sr", "default-percent-change-conditional-filters-color"]);

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[₹,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * The rows a scan returned, in the shape `buildRun` consumes.
 *
 * Returns `{ rows, warnings, total }` — never throws on a row it cannot read.
 * One unusable row in a hundred and sixty should cost that row, not the whole
 * evening's scan.
 */
export function parseScanResponse(json) {
  const warnings = [];

  if (!json || typeof json !== "object") {
    return { rows: [], warnings: ["The scan returned nothing readable."], total: 0 };
  }
  if (!Array.isArray(json.data)) {
    /* A Laravel error page, a login redirect rendered as JSON, or a changed
       contract all land here. Saying which key was missing is what makes the
       failed run's message worth reading six weeks later. */
    return {
      rows: [],
      warnings: [`The scan response had no \`data\` array (keys: ${Object.keys(json).join(", ") || "none"}).`],
      total: 0,
    };
  }

  const rows = [];
  for (const r of json.data) {
    /*
      NSE code or nothing.

      `bsecode` is a numeric scrip code, not a ticker — the journal already
      treats it as an id that can never be used to price anything (see the
      note on isin.js). A row with no nsecode therefore has no symbol this
      app can act on, and inventing one from the BSE code would produce a
      position nothing can quote.
    */
    const symbol = String(r?.nsecode ?? "").trim().toUpperCase();
    if (!symbol) {
      warnings.push(`A row had no NSE code (${r?.name || r?.bsecode || "unnamed"}) — skipped.`);
      continue;
    }

    const extra = {};
    for (const [k, v] of Object.entries(r)) {
      if (NOISE.has(k)) continue;
      if (k === "nsecode" || k === "bsecode" || k === "name") continue;
      if (k === CLOSE || k === CHANGE || k === VOLUME) continue;
      extra[k] = v;
    }

    rows.push({
      symbol,
      exchange: "NSE",
      close: num(r[CLOSE]),
      chgPct: num(r[CHANGE]),
      volume: num(r[VOLUME]),
      /* Kept because it is free and useful: the journal shows a symbol, and
         "Bosch Limited" is what a person recognises. */
      name: String(r.name ?? "").trim() || undefined,
      bsecode: r.bsecode ? String(r.bsecode).trim() : undefined,
      ...extra,
    });
  }

  return {
    rows,
    warnings,
    /* What Chartink said it found, against what we could read. They differ
       only when rows were skipped, and the run should say so rather than
       quietly reporting the smaller number. */
    total: Number.isFinite(json.recordsTotal) ? json.recordsTotal : rows.length,
  };
}
