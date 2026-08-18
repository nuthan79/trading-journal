/**
 * Rebuilding a journal from the app's own export.
 *
 * WHY THIS AND NOT A BROKER FILE. A broker tax P&L has no stop loss, so no
 * 1R, so no R — which is the entire app. It also has no pattern, pivot, RS
 * rank, volume percentage, stage, notes or mistake tags. Restoring from one
 * gives a P&L statement with the journal stripped out. This file's export has
 * all of it, which is why this is worth building even though the broker
 * importers serve more people.
 *
 * THE IDEA THAT MAKES IT SAFE. The export carries every row's real primary
 * key, and the account those keys belonged to has been deleted, so nothing
 * can collide. Keep every `id` exactly as it was and rewrite only `user_id`:
 *
 *   - trade_exits.trade_id and diary_entries.trade_id still point at the
 *     right trades, so there is no re-mapping step to get wrong;
 *   - writing becomes an upsert on `id`, which makes importing the same file
 *     twice do nothing at all.
 *
 * Idempotent by construction rather than by a dedupe rule somebody has to
 * maintain. That removes the failure that makes bulk restore frightening —
 * import twice, get two of everything.
 *
 * The planning below is deliberately PURE: it takes parsed JSON and returns
 * the rows to write, touching nothing. That is what lets it be tested against
 * a real export without a database.
 */

/**
 * A uuid derived from the signed-in user and an id out of the export.
 *
 * Shaped as a v5 uuid — SHA-256 rather than v5's SHA-1, with the version and
 * variant bits set so Postgres accepts it as a uuid and nothing downstream
 * has to know it was computed rather than generated.
 *
 * The two properties that matter:
 *
 *   DETERMINISTIC — the same file restored twice derives the same ids, so the
 *   second run overwrites the first instead of building a duplicate journal.
 *   This is what makes the restore safe to retry, which people do.
 *
 *   NAMESPACED TO THE USER — the user's own id is part of the input, so ids
 *   derived for one account can never collide with another account's rows.
 *   The original design reused the export's ids and had neither property when
 *   the source account still existed.
 *
 * crypto.subtle is why planRestore is async. It is present in browsers and in
 * Node 18+, so the pure half still runs under plain node for testing.
 */
async function derivedId(userId, oldId) {
  const data = new TextEncoder().encode(`ledgerr-restore:${userId}:${oldId}`);
  const buf = new Uint8Array(await crypto.subtle.digest("SHA-256", data)).slice(0, 16);
  buf[6] = (buf[6] & 0x0f) | 0x50;   // version 5
  buf[8] = (buf[8] & 0x3f) | 0x80;   // RFC 4122 variant
  const h = [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Tables restored, parents before children. Order matters: a trade_exit
 *  whose trade does not exist yet violates the foreign key. */
export const RESTORE_ORDER = ["trades", "trade_exits", "diary_entries", "capital_flows"];

/**
 * Deliberately NOT restored.
 *
 * `user_events` and `client_errors` are records the app kept ABOUT the
 * person, not content they created. Re-inserting them would put resurrected
 * rows into cohorts that have already been counted, so the D30 retention
 * figure would be reporting on people who left. That is a lie told to
 * yourself, which is the worst kind in a product decision.
 *
 * `import_batches` is skipped because a restore is its own batch — see
 * below. Keeping the old ones would let somebody "undo" an import that
 * happened in an account that no longer exists.
 */
export const SKIPPED_TABLES = ["user_events", "client_errors", "import_batches"];

/** Keys in the export that hold restorable rows, mapped to their table. */
const SOURCE_KEY = {
  trades: "trades",
  trade_exits: "trade_exits",
  diary_entries: "diary_entries",
  capital_flows: "capital_flows",
};

/**
 * Is this actually one of our exports?
 *
 * Checked before anything is written, and checked on shape rather than on a
 * version number: an older export has no version field and is still perfectly
 * restorable, whereas any file claiming to be v1 could be anything.
 */
export function inspectExport(json) {
  if (!json || typeof json !== "object") {
    return { ok: false, error: "That file isn't JSON we can read." };
  }
  if (!Array.isArray(json.trades) || !json.exported_at) {
    return {
      ok: false,
      error:
        "That doesn't look like a journal export. Use the JSON file from " +
        "My profile → Export everything, not a broker file or a CSV.",
    };
  }

  const counts = {};
  for (const t of RESTORE_ORDER) counts[t] = (json[SOURCE_KEY[t]] || []).length;

  return {
    ok: true,
    exportedAt: json.exported_at,
    email: json.account?.email ?? null,
    fromUserId: json.account?.user_id ?? null,
    counts,
    // Not an error. A person may legitimately restore an export taken from
    // an account whose address they have since changed, so this is something
    // to say out loud and let them decide, never something to refuse.
    total: RESTORE_ORDER.reduce((a, t) => a + counts[t], 0),
  };
}

/**
 * Rows to write, re-keyed to the signed-in user.
 *
 * Pure. Returns plain arrays and does not know Supabase exists.
 *
 * `image_path` is stripped from diary entries because the storage objects it
 * points at were purged with the old account — the path would survive as a
 * link to nothing, and an entry that looks like it has a chart but renders a
 * broken image is worse than one that plainly has none. The picture itself is
 * still in the export under `chart_links` as a data URI, so re-uploading is
 * possible later; this is the honest floor, not the ceiling.
 */
export async function planRestore(json, userId) {
  if (!userId) throw new Error("planRestore needs the signed-in user's id.");

  /**
   * Ids are DERIVED, not reused. This is the correction to the original
   * design, which kept them.
   *
   * Keeping them only works if the account they came from is gone. It is not
   * always: somebody testing a restore, or moving a journal into a second
   * account, still has the original. The old ids then collide with live rows
   * belonging to another user, and the upsert's UPDATE half is refused by
   * row-level security — "new row violates row-level security policy (USING
   * expression)". Which is RLS doing exactly its job: without it, a restore
   * would have overwritten another account's trades.
   *
   * So each id becomes a hash of the signed-in user plus the original id.
   * That keeps the property the whole design rests on — the same file
   * restored twice produces the same ids, so it overwrites rather than
   * duplicates — while guaranteeing those ids belong to this user's
   * namespace and can never land on somebody else's row.
   *
   * The map is built before anything is rewritten because children reference
   * parents: trade_exits.trade_id and diary_entries.trade_id have to be moved
   * to the same new ids the trades got.
   */
  const idMap = new Map();
  for (const table of RESTORE_ORDER) {
    for (const r of json[SOURCE_KEY[table]] || []) {
      if (r?.id && !idMap.has(r.id)) idMap.set(r.id, await derivedId(userId, r.id));
    }
  }

  const rows = {};
  for (const table of RESTORE_ORDER) {
    const src = json[SOURCE_KEY[table]] || [];
    rows[table] = src.map((r) => {
      const out = { ...r, user_id: userId, id: idMap.get(r.id) ?? r.id };
      // Point children at the trade's new id. A reference left on the old one
      // would fail the foreign key, since that trade was never written here.
      if (out.trade_id) out.trade_id = idMap.get(out.trade_id) ?? out.trade_id;

      /**
       * Except this one, which must not survive.
       *
       * A trade that came from a broker import carries the id of the batch it
       * arrived in, and import_batches is not restored — so the reference
       * points at a row that no longer exists anywhere and the insert fails
       * on the foreign key. Cleared here and stamped with the restore's own
       * batch by the writer, which also makes the whole restore undoable by
       * the machinery that already exists.
       */
      // The column is `import_batch`, not `import_batch_id` — 006 named it
      // without the suffix and undo_import matches on that name. The suffixed
      // spelling is a column that does not exist, and PostgREST rejects the
      // whole write rather than ignoring it.
      if ("import_batch" in out) out.import_batch = null;
      if (table === "diary_entries" && out.image_path) {
        const external = /^https?:\/\//i.test(out.image_path);
        // A pasted TradingView link is an ordinary URL and still works.
        if (!external) out.image_path = null;
      }
      return out;
    });
  }

  /**
   * The profile is an UPDATE, never an insert: signing up already created a
   * row, and `id` is the user's own uuid, so inserting a second one is not
   * possible. Only the settings that change how the journal counts are
   * carried over — not onboarding stamps, not the plan.
   *
   * Plan especially: restoring it would let anyone who was once given a
   * complimentary account grant themselves another by re-importing their own
   * file. Entitlement is decided by the profiles table, so it must never be
   * writable from a file the user supplies.
   */
  const p = json.profile || {};
  const profilePatch = {};
  for (const k of ["account_size", "default_risk_pct", "charge_config", "avatar_path"]) {
    if (p[k] !== undefined && p[k] !== null) profilePatch[k] = p[k];
  }

  return { rows, profilePatch };
}

/**
 * Trades this account already holds that the file is about to add again.
 *
 * THE HOLE THIS COVERS. Restore is idempotent by DERIVED ID: the same file
 * restored twice produces the same ids and overwrites itself. That is complete
 * protection against re-running a restore, and none at all against the same
 * trades already being here under different ids — which is exactly what a
 * broker import produces. Restore one account's export into another that had
 * already imported the same tax P&L and every trade lands twice. Fifty-four
 * pairs, on the account this was found on.
 *
 * MATCHED ON CONTENT, because ids cannot see it. Symbol, entry date and
 * quantity — the same notion of "the same trade" the broker importer uses,
 * minus the exit, since a position part-sold since the export would otherwise
 * slip past as new. That looseness is deliberate for a warning: over-reporting
 * costs a second look, under-reporting costs a duplicated journal.
 *
 * A WARNING, NOT A BLOCK, and the distinction matters. The ordinary path —
 * delete the account, come back, restore — runs against an empty journal and
 * must stay one click. Somebody deliberately merging two accounts is doing
 * something unusual but not wrong, and refusing them would leave a file the
 * app itself wrote that the app will not read.
 *
 * `existing` is the account's current trades: { id, symbol, entry_date,
 * quantity }. Pure, so this file still runs in plain node against a real
 * export with no Supabase client anywhere near it.
 */
export function findContentDuplicates(plan, existing = []) {
  const key = (t) =>
    `${String(t.symbol || "").toUpperCase()}|${t.entry_date || ""}|${Number(t.quantity) || 0}`;

  const held = new Map();
  for (const t of existing) {
    const k = key(t);
    if (!held.has(k)) held.set(k, t);
  }

  const hits = [];
  for (const r of plan.rows.trades || []) {
    const match = held.get(key(r));
    // Same id means the upsert will overwrite it, which is the design working
    // rather than a duplicate — only a DIFFERENT row holding the same trade is
    // a second copy waiting to happen.
    if (match && match.id !== r.id) {
      hits.push({
        symbol: String(r.symbol || "").toUpperCase(),
        entry_date: r.entry_date,
        quantity: Number(r.quantity) || 0,
      });
    }
  }
  return hits;
}

/**
 * What the confirmation screen says before anything is written.
 *
 * Restores are not undoable by feel — they are undoable because of the batch
 * — so the number of rows about to appear should be visible first.
 */
export function describePlan(plan) {
  const parts = [];
  for (const t of RESTORE_ORDER) {
    const n = plan.rows[t].length;
    if (n) parts.push(`${n} ${t.replace(/_/g, " ")}`);
  }
  return parts.length ? parts.join(", ") : "nothing";
}
