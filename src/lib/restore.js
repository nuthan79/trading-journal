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
export function planRestore(json, userId) {
  if (!userId) throw new Error("planRestore needs the signed-in user's id.");

  const rows = {};
  for (const table of RESTORE_ORDER) {
    const src = json[SOURCE_KEY[table]] || [];
    rows[table] = src.map((r) => {
      // Every id is kept. Only ownership changes.
      const out = { ...r, user_id: userId };

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
      if ("import_batch_id" in out) out.import_batch_id = null;
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
