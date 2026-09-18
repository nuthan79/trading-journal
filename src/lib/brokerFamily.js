/**
 * Which broker a row came from — as a BROKER, not as the file that brought it.
 *
 * `trades.broker` holds the importing adapter's id, and one broker has several:
 * `zerodha` for the tax P&L, `zerodha_holdings`, `zerodha_tradebook`. The rule
 * "never merge across brokers" compared those raw ids, so a holdings row
 * (`zerodha_holdings`) and the tax P&L sells of the same shares (`zerodha`)
 * counted as two brokers — the step built to close a sold holding refused every
 * match, and each sale landed as a second copy beside the holding it closed.
 * Found on a real book: six holdings, all sold after the snapshot, all left
 * open beside their closed copies.
 *
 * The raw id stays on the row: it is how a holdings SNAPSHOT is recognised.
 */
import { today } from "./format";

export const brokerFamily = (id) =>
  (id ? String(id).replace(/_(holdings|tradebook)$/, "") : id);

/** Null matches either way, on purpose — see `reconcile`: a hand-entered trade
 *  has no broker, and completing it is the point of importing afterwards. */
export const sameBroker = (a, b) => !a || !b || brokerFamily(a) === brokerFamily(b);

/** A row a holdings file created — a snapshot of what was held, on one day. */
export const isHoldingsSnapshot = (t) => /_holdings$/.test(String(t?.broker || ""));

/**
 * The day the snapshot was taken: the day the holdings file was imported, in
 * the user's own calendar. Read from `created_at`, which survives the row being
 * re-dated — once a tradebook gives it a real entry date, the entry date no
 * longer says when the snapshot was. Falls back to an assumed entry date,
 * which is the same day for a row nothing has corrected yet.
 */
export function snapshotDay(t) {
  const at = Date.parse(t?.created_at);
  if (Number.isFinite(at)) return today(new Date(at));
  return t?.entry_date_source === "assumed" ? String(t.entry_date || "").slice(0, 10) || null : null;
}
