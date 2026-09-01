/**
 * One CSV writer, for every table that offers a download.
 *
 * WHY IT IS NOT TWO. The trades export lived inside Trades.jsx, and adding the
 * same button to Holdings meant either importing a component's private
 * function or writing the escaping a second time. Escaping is exactly the kind
 * of thing that gets written twice and diverges once: the second copy handles
 * the quote and forgets the embedded newline, and nobody notices until a notes
 * field with a line break in it silently shifts every following column by one.
 *
 * `toCsv` is pure and takes plain data, so the awkward values — a quote inside
 * a note, an array of tags, NaN, null — are probeable without a browser.
 */

/**
 * Columns are `{ key, header }`, or a bare string when the two are the same.
 *
 * The trades export has always written raw field names as its header row and
 * somebody may have a spreadsheet keyed on them, so `header` defaults to `key`
 * and that file stays byte-identical. New exports can say something readable
 * instead.
 */
const col = (c) => (typeof c === "string" ? { key: c, header: c } : { header: c.key, ...c });

/**
 * RFC 4180 quoting, applied to everything rather than only where needed.
 *
 * Quoting every field is a few bytes larger and removes the question of which
 * ones need it — the comma, the quote, the newline and the leading space all
 * stop being special cases. A quote inside the value doubles.
 */
const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/**
 * A cell, by what the value IS rather than by which column it came from.
 *
 * Numbers are written at four decimal places so a spreadsheet reads them as
 * numbers and nothing rounds on the way out; a non-finite one — NaN from a
 * trade with no R, Infinity from a division nobody guarded — becomes empty,
 * because "NaN" in a spreadsheet column poisons every formula over it.
 *
 * Arrays join on a pipe rather than a comma for the obvious reason.
 */
function cell(v) {
  if (Array.isArray(v)) return esc(v.join(" | "));
  if (typeof v === "number") return esc(isFinite(v) ? v.toFixed(4) : "");
  if (typeof v === "boolean") return esc(v ? "yes" : "no");
  return esc(v);
}

export function toCsv(rows, cols) {
  const cs = (cols || []).map(col);
  const head = cs.map((c) => esc(c.header)).join(",");
  const body = (rows || []).map((r) => cs.map((c) => cell(r?.[c.key])).join(","));
  /* CRLF, which is what RFC 4180 says and what stops Excel on Windows from
     reading the whole file as one line. */
  return [head, ...body].join("\r\n");
}

/**
 * Hand the file to the browser.
 *
 * Split from `toCsv` so the formatting can be probed in node, where there is
 * no Blob and no anchor to click.
 */
export function downloadCsv(rows, cols, filename) {
  const blob = new Blob(["﻿" + toCsv(rows, cols)], {
    type: "text/csv;charset=utf-8",
  });
  /* The BOM is for Excel, which otherwise reads a UTF-8 file as the system
     codepage and turns every ₹ into three characters of noise. */
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
