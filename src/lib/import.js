/**
 * CSV reading for the importer.
 *
 * ImportTrades pulls this in dynamically, alongside the xlsx path, so the
 * Zerodha report can be handed over as either format. The output shape is
 * deliberately the same as SheetJS's `sheet_to_json(sheet, { header: 1 })`:
 * a 2D array of cell values, which is what parseTradewiseRows expects.
 *
 * The quote handling matters — the report puts commas inside company names
 * and quotes the field, so a naive split(",") would shift every column after
 * it and silently misread the row.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        // "" inside a quoted field is a literal quote
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }

  // Blank lines separate sections in the report; the section-heading detector
  // treats a row of empty strings as noise anyway, so drop them here.
  return rows.filter((r) => r.some((x) => String(x ?? "").trim() !== ""));
}
