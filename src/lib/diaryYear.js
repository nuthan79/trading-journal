/**
 * The diary's year map — a year of trading days at a glance, coloured by
 * what each one realised, with a mark where something was written.
 *
 * THE GAPS ARE THE POINT. A month of trades with no writing is worth seeing
 * as much as any entry: it is the stretch the diary was meant for and was not
 * used. So a day's cell says three things — whether you traded, what it
 * banked in R, and whether you wrote — and the line under the map counts the
 * days you traded and wrote nothing.
 *
 * Pure. Dates are stored YYYY-MM-DD strings, compared as strings and moved
 * with UTC arithmetic only — never new Date(str), which reads a bare date as
 * UTC midnight and lands on the wrong day west of Greenwich.
 */

const DAY = 86400000;
const toMs = (iso) => {
  const [y, m, d] = String(iso).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const toIso = (ms) => new Date(ms).toISOString().slice(0, 10);
const weekday = (iso) => new Date(toMs(iso)).getUTCDay();           // 0 Sun … 6 Sat

/**
 * The weeks of the year ending on `today`, Monday to Friday.
 *
 * `tradingDays` is the index's own calendar (a Set of dates); without it every
 * weekday counts. A holiday inside the range is a gap in the column, not a
 * cell — a cell is a day the market was open. `idx` is diaryDay.dayIndex().
 * `entries` are the diary's rows.
 */
export function yearMap({ today, tradingDays = null, idx = null, entries = [], weeks = 52 }) {
  const end = toMs(today);
  const isOpen = (iso) => (tradingDays ? tradingDays.has(iso) : weekday(iso) >= 1 && weekday(iso) <= 5);

  /* Monday of the week `weeks` back. */
  const back = end - (weeks - 1) * 7 * DAY;
  const start = back - ((weekday(toIso(back)) + 6) % 7) * DAY;

  /* An entry written on a weekend or a holiday belongs to the last day the
     market was open before it — the day it is most likely about — and the
     cell says so in its title rather than inventing a session. */
  const byDay = new Map();
  for (const e of entries || []) {
    let d = String(e.entry_date || "").slice(0, 10);
    if (!d) continue;
    const written = d;
    for (let i = 0; i < 7 && !isOpen(d); i++) d = toIso(toMs(d) - DAY);
    if (!isOpen(d)) continue;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push({ id: e.id, written });
  }

  const cols = [];
  const months = [];
  let traded = 0, written = 0, tradedUnwritten = 0;

  for (let w = start; w <= end; w += 7 * DAY) {
    const col = [];
    for (let k = 0; k < 5; k++) {
      const iso = toIso(w + k * DAY);
      if (toMs(iso) > end || toMs(iso) < start || !isOpen(iso)) { col.push(null); continue; }
      const r = idx?.realisedR?.get(iso);
      const did = !!idx?.traded?.has(iso);
      const notes = byDay.get(iso) || [];
      if (did) traded++;
      if (notes.length) written++;
      if (did && !notes.length) tradedUnwritten++;
      col.push({ date: iso, r: Number.isFinite(r) ? r : null, traded: did, entries: notes });
    }
    /* A month label on the first column whose Monday falls in a new month. */
    const ym = toIso(w).slice(0, 7);
    if (!months.length || months[months.length - 1].ym !== ym) months.push({ ym, col: cols.length });
    cols.push(col);
  }

  return { cols, months, stats: { traded, written, tradedUnwritten } };
}

/**
 * The cell for a date, or null if that date is outside the window or was not
 * a session.
 *
 * THROUGH THE MAP, NOT THE ENTRIES. yearMap rolls an entry written on a
 * weekend or a holiday onto the last session before it, so the cell already
 * knows which entry a date belongs to. Looking the date up in the diary
 * instead would be a second rule for the same question, and the two would
 * disagree on exactly the entries the roll-back exists for.
 */
export function cellOn(year, date) {
  for (const col of year?.cols || []) {
    for (const c of col) if (c && c.date === date) return c;
  }
  return null;
}

/**
 * The date in a location hash, or null. "#d-2026-08-14" → "2026-08-14".
 * Validated by shape, not parsed into a Date — a hash is user input, and
 * new Date() on a bad one yields Invalid Date silently.
 */
export function hashDate(hash) {
  const m = /^#d-(\d{4})-(\d{2})-(\d{2})$/.exec(String(hash || ""));
  if (!m) return null;
  const mo = Number(m[2]), d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * A cell's shade: green for a day that banked R, red for one that lost it,
 * stronger the larger, flat at 3R — past which a colour cannot say more.
 * Grey for a day traded with nothing realised (buys only); none for no trade.
 */
export function cellTone(cell) {
  if (!cell) return null;
  if (cell.r == null) return cell.traded ? { kind: "traded", strength: 0 } : { kind: "idle", strength: 0 };
  if (cell.r === 0) return { kind: "traded", strength: 0 };
  return { kind: cell.r > 0 ? "gain" : "loss", strength: Math.min(1, Math.abs(cell.r) / 3) };
}
