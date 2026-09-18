/**
 * Holdings that were sold after they were imported — found in the journal
 * itself, so a book already carrying the copies can be put right.
 *
 * A holdings row is a snapshot of one day. When the shares in it are later
 * sold, the tax P&L brings those sells in as a closed trade — and, until the
 * broker-family fix, it could not attach them to the holding (the two rows
 * carried different broker labels), so the holding stayed open beside its own
 * closed copy. On a real book: six of eleven holdings from a 3 September
 * snapshot, every share of them sold since, all still showing as held.
 *
 * The evidence is the closed trades' own sells: any imported trade in the same
 * stock and broker, bought on or before the snapshot day, whose sells are dated
 * on or after it, sold shares that were in the snapshot. Adding those up says
 * how much of the holding is gone:
 *
 *   remove   every share it held was sold since — the closed trade already
 *            records the whole purchase, so the holding row is a copy
 *   shrink   some were — it keeps only what is still held
 *   unclear  more sold since than it held: a re-buy the files cannot see.
 *            Reported, never acted on.
 *
 * Pure: it reads derived trades and returns a plan. Nothing is written here.
 */
import { brokerFamily, isHoldingsSnapshot, snapshotDay } from "./brokerFamily";

const EPS = 1e-6;
const day = (d) => String(d || "").slice(0, 10);

export function soldSinceSnapshot(trades = []) {
  const plan = [];
  for (const h of trades) {
    if (!isHoldingsSnapshot(h)) continue;
    if (h.status === "closed") continue;
    if (String(h.id || "").startsWith("demo-")) continue;
    const snap = snapshotDay(h);
    if (!snap) continue;

    const sym = String(h.symbol || "").toUpperCase();
    const fam = brokerFamily(h.broker);
    const openQty = Number.isFinite(Number(h.qtyOpen)) ? Number(h.qtyOpen)
      : Number(h.quantity) - (h.exits || []).reduce((a, e) => a + (Number(e.quantity) || 0), 0);
    if (!(openQty > 0)) continue;

    const evidence = [];
    let soldSince = 0;
    for (const c of trades) {
      if (c === h || c.id === h.id) continue;
      if (isHoldingsSnapshot(c)) continue;
      if (!c.imported) continue;
      if (String(c.symbol || "").toUpperCase() !== sym) continue;
      if (brokerFamily(c.broker) !== fam) continue;
      if (day(c.entry_date) > snap) continue;          // bought after the snapshot — not its shares
      const since = (c.exits || []).filter((e) => day(e.exit_date) >= snap);
      const q = since.reduce((a, e) => a + (Number(e.quantity) || 0), 0);
      if (!(q > 0)) continue;
      soldSince += q;
      evidence.push({ id: c.id, entry: day(c.entry_date), sold: q,
                      last: since.map((e) => day(e.exit_date)).sort().pop() });
    }
    if (!(soldSince > 0)) continue;

    /* The closed trade that took the most of it inherits anything attached to
       the holding — diary entries, charts — when the holding goes. */
    const heir = evidence.slice().sort((a, b) => b.sold - a.sold)[0]?.id || null;
    const base = { id: h.id, symbol: h.symbol, snapshot: snap, held: openQty,
                   soldSince, evidence, heir };
    if (Math.abs(soldSince - openQty) <= EPS) plan.push({ ...base, action: "remove" });
    else if (soldSince < openQty) {
      plan.push({ ...base, action: "shrink",
                  quantity: Number(h.quantity) - soldSince, stillHeld: openQty - soldSince });
    } else plan.push({ ...base, action: "unclear" });
  }
  return plan;
}
