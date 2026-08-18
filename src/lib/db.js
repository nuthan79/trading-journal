"use client";

import { createClient } from "@supabase/supabase-js";
import { isPreset, presetPath } from "./avatars";
// The pure half of restore. Kept in its own file so it can be run against a
// real export in plain node, with no Supabase client anywhere near it.
import { inspectExport, planRestore, RESTORE_ORDER, SKIPPED_TABLES } from "./restore";

/**
 * The whole storage layer. In the prototype this was window.storage; here it
 * is Postgres. The UI components call these same-shaped functions, which is
 * why porting the interface across is mostly mechanical.
 */

/**
 * Plain supabase-js, not @supabase/ssr's createBrowserClient, and implicit
 * flow rather than the default PKCE — both deliberate.
 *
 * PKCE binds a magic link to the browser that requested it: the exchange
 * needs a code_verifier held in that browser's storage, so clicking the
 * link from a phone's mail app (which opens its own in-app browser) always
 * fails. The usual fix is a 6-digit code in the same email, but Supabase
 * gates email-template customisation behind custom SMTP, so {{ .Token }}
 * isn't available on the built-in sender.
 *
 * Implicit flow puts the session in the link's URL fragment instead, so it
 * signs you in wherever you open it. createBrowserClient can't do this —
 * it spreads your auth options and then hardcodes flowType: "pkce" over
 * the top — hence going direct to createClient here. That moves session
 * storage from cookies to localStorage, which is fine because nothing
 * server-side reads the session: every screen gates on it client-side and
 * the API routes are unauthenticated proxies.
 *
 * The cost is that tokens ride in the URL and can reach browser history —
 * acceptable for a single-user personal journal. Worth moving back to
 * @supabase/ssr + PKCE + the code fallback if custom SMTP is ever set up.
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { flowType: "implicit", detectSessionInUrl: true, persistSession: true } }
);

const uid = async () => (await supabase.auth.getUser()).data.user?.id;

/**
 * fetch() for this app's own API routes, carrying the access token.
 *
 * The session is in localStorage rather than a cookie, so nothing rides along
 * on its own — the routes can only know who is calling if the token is put on
 * the request. Exported because Review.jsx calls /api/market directly.
 */
export async function apiFetch(path, init = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return fetch(path, {
    ...init,
    headers: {
      ...(init.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

/**
 * PostgREST caps a select at `max-rows` — 1000 on Supabase by default — and
 * says nothing when it truncates. A journal of 1200 trades simply appeared to
 * lose the oldest 200, and worse things happened quietly: exit tranches past
 * the cap went missing so positions fell back to their flat columns, and the
 * dedupe key list came back short, which would let a re-imported file write
 * duplicates.
 *
 * So every list here pages through instead of trusting one round trip.
 *
 * `build` has to construct a fresh query each call — a PostgREST builder is
 * single-use. The caller must also order by something unique (id works as a
 * tiebreaker); paging over a non-unique sort lets rows shuffle between pages,
 * which drops some and repeats others.
 */
const PAGE = 1000;

async function fetchAllPages(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    // A short page means we've reached the end. An exactly-full one is
    // ambiguous, so it costs one extra empty request to be sure.
    if (!data || data.length < PAGE) return out;
  }
}

/* ------------------------------- events ---------------------------- */

/**
 * Record that something happened. Never throws, never blocks, never waits.
 *
 * Analytics that can break the app is worse than no analytics. Every failure
 * path here is swallowed on purpose: signed out, offline, table missing
 * because 016 has not been run, RLS refusing the row — all of it ends the
 * same way, with the app carrying on as though nothing was asked of it.
 *
 * Not awaited by callers either. A journal entry saving is the user's
 * business; the note that they saved one is ours, and ours can be late or
 * lost without anyone minding.
 *
 * `props` is for counts and enums. Never a symbol, a price, or anything about
 * the positions — see the note on the table in 016.
 */
/**
 * Whether this account has declined analytics. null means not yet known.
 *
 * Held here rather than passed in, because track() is called from a dozen
 * places that have no business knowing about a preference.
 *
 * The three states matter. Starting at `false` would record events for
 * somebody who opted out, in the window before their profile loads — and the
 * first event of a session fires on the first page. So the unknown state is
 * distinct, and the first event pays for one lookup that every later event
 * reuses.
 */
let analyticsOptOut = null;

/** Set from the profile once it loads, and by the toggle itself, so a change
 *  takes effect on the next event rather than the next sign-in. */
export function setAnalyticsFlag(optedOut) {
  analyticsOptOut = !!optedOut;
}

async function analyticsAllowed() {
  if (analyticsOptOut !== null) return !analyticsOptOut;
  try {
    const id = await uid();
    if (!id) return false;
    const { data } = await supabase
      .from("profiles").select("analytics_opt_out").eq("id", id).single();
    // A missing column means 034 has not been run; collecting as before is
    // the honest default there, since nobody has been offered the choice yet.
    analyticsOptOut = !!data?.analytics_opt_out;
    return !analyticsOptOut;
  } catch {
    analyticsOptOut = false;
    return true;
  }
}

export function track(event, props = {}) {
  (async () => {
    try {
      if (!(await analyticsAllowed())) return;
      const { data } = await supabase.auth.getSession();
      const uid = data?.session?.user?.id;
      if (!uid) return;
      await supabase.from("user_events").insert({ user_id: uid, event, props });
    } catch {
      /* deliberately silent — see above */
    }
  })();
}

/** Read by the crash reporter, which must obey the same switch — a crash
 *  report is a record about the person, not about their journal. */
export const analyticsPermitted = () => analyticsAllowed();

/**
 * The one event that answers "is anyone still using this".
 *
 * Fired once per browser session rather than per page load, so it counts
 * visits and not clicks. Active days come straight off this; everything else
 * in the events table describes what they did once they were here.
 */
export function trackVisit() {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (sessionStorage.getItem("tj_visit")) return;
    sessionStorage.setItem("tj_visit", "1");
    track("opened");
  } catch {
    /* private mode denies sessionStorage; not worth a broken page */
  }
}

/* ------------------------------- trades ---------------------------- */

export async function listTrades() {
  return fetchAllPages(() =>
    supabase
      .from("trades")
      .select("*")
      .order("entry_date", { ascending: false })
      .order("id", { ascending: true })
  );
}

/**
 * Exit tranches, keyed by trade id.
 *
 * Fetched as one query and joined client-side rather than as a nested select,
 * so the shape stays identical to what derivePosition() already expects and
 * the trades query is left alone.
 *
 * Returns an empty map rather than throwing if the table isn't there — this
 * ships ahead of migration 007, and a missing table should degrade to the old
 * single-exit behaviour instead of blanking the whole journal.
 */
export async function listExitsByTrade() {
  let rows;
  try {
    rows = await fetchAllPages(() =>
      supabase
        .from("trade_exits")
        .select("*")
        .order("exit_date", { ascending: true })
        .order("id", { ascending: true })
    );
  } catch (error) {
    if (isMissingTable(error)) return {};
    throw error;
  }

  const byTrade = {};
  for (const e of rows) (byTrade[e.trade_id] ||= []).push(e);
  return byTrade;
}

// 42P01 is Postgres "undefined_table"; PostgREST also reports an unknown
// relation as PGRST205 before it has reloaded its schema cache.
const isMissingTable = (error) =>
  error?.code === "42P01" ||
  error?.code === "PGRST205" ||
  /does not exist|schema cache/i.test(error?.message || "");

/**
 * A write that named a column the database doesn't have — which here always
 * means a migration hasn't been run yet.
 *
 * PostgREST reports it as PGRST204 with a message naming the column, and left
 * alone that message reaches the user as "Could not find the 'stop_source'
 * column of 'trades' in the schema cache" — accurate, and no help at all to
 * someone deciding what to do next. Every other migration-gated path in this
 * file names the file to run; this makes the column ones do the same.
 */
const MIGRATION_FOR_COLUMN = {
  broker: "019_trade_broker.sql",
  breakeven_ack_at: "017_breakeven_ack.sql",
  acquisition: "013_zero_cost_shares.sql",
  stop_source: "011_stop_source.sql",
  initial_stop_loss: "007_partial_exits.sql",
  avatar_path: "010_avatars.sql",
  import_batch: "009_import_reconcile.sql",
};

function migrationHint(error) {
  const msg = error?.message || "";
  if (error?.code !== "PGRST204" && !/could not find the .* column/i.test(msg)) return null;
  const column = msg.match(/'([^']+)' column/)?.[1];
  const file = MIGRATION_FOR_COLUMN[column];
  return file
    ? `Migration ${file.slice(0, 3)} hasn't been run — supabase/${file} adds the ` +
      `${column} column this needs. Nothing was saved.`
    : `The database is missing a column this version expects (${column || "unknown"}). ` +
      `Check for an unrun file in supabase/. Nothing was saved.`;
}

export async function saveExits(tradeId, exits) {
  const user_id = await uid();

  // Replace wholesale: the form hands back the full tranche list, and
  // diffing it row by row would be more code for the same result.
  const { error: delErr } = await supabase
    .from("trade_exits").delete().eq("trade_id", tradeId);
  if (delErr) throw delErr;

  if (!exits?.length) return [];

  const rows = exits.map((e) => ({
    trade_id: tradeId,
    user_id,
    exit_date: e.exit_date,
    quantity: Number(e.quantity),
    price: Number(e.price),
    reason: e.reason || null,
    charges: Number(e.charges) || 0,
  }));

  const { data, error } = await supabase.from("trade_exits").insert(rows).select();
  if (error) throw error;
  return data;
}

export async function saveTrade(t) {
  const user_id = await uid();
  const row = { ...t, user_id };
  delete row.created_at; delete row.updated_at;
  const { data, error } = await supabase
    .from("trades").upsert(row).select().single();
  if (error) throw new Error(migrationHint(error) || error.message);
  // Logging a trade and closing one are different habits, and the second is
  // the one that says someone is seeing this journal through.
  track(t.id ? "trade_saved" : "trade_logged", { closed: row.status === "closed" });
  return data;
}

export async function deleteTrade(id) {
  const { error } = await supabase.from("trades").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Refresh last_price on the open positions.
 *
 * Uses .update() per row rather than .upsert(). An upsert sends Postgres
 * INSERT ... ON CONFLICT DO UPDATE, and the INSERT half must satisfy every
 * NOT NULL column — so a partial payload of {id, last_price} fails the
 * not-null check before the conflict clause is ever reached.
 *
 * Returns the rows that were actually marked, so the caller can merge them
 * into state without a full refetch.
 */
/**
 * One quote, for the form to show beside a price being typed.
 *
 * Separate from markOpenPositions because it must not write anything. That
 * function's job is to stamp the book; this one is answering "what is it
 * trading at right now" while somebody fills in a field, and a form that
 * silently updated stored marks as you typed in it would be a surprising
 * thing to have built.
 *
 * Returns null on anything going wrong rather than throwing. A missing price
 * beside an input is a blank hint; an exception is a form that will not open.
 */
export async function quoteFor(symbol, exchange) {
  if (!symbol || !exchange) return null;
  try {
    const res = await apiFetch(
      `/api/quotes?s=${encodeURIComponent(`${symbol}:${exchange}`)}`
    );
    const json = await res.json();
    const q = (json.quotes || [])[0];
    return q?.price != null ? q : null;
  } catch {
    return null;
  }
}

/**
 * Record, change or clear the nominee.
 *
 * Section 14 of the DPDP Act, and promised in the privacy policy since it
 * shipped: somebody to exercise these rights if the account holder dies or is
 * incapacitated. Until now there was nowhere to put one.
 *
 * Clearing is passing empty strings, and is not a lesser action than setting:
 * a nomination that no longer reflects what somebody wants should be
 * removable without deleting the account around it.
 */
export async function saveNominee({ name, contact }) {
  const id = await uid();
  if (!id) throw new Error("Sign in first.");

  const clean = (v) => (typeof v === "string" ? v.trim() : "");
  const nominee_name = clean(name);
  const nominee_contact = clean(contact);
  const clearing = !nominee_name && !nominee_contact;

  /**
   * Returns the updated profile, because the caller hands it straight to
   * setProfile — the same contract saveAvatarPreset already follows.
   *
   * Returning nothing is not harmless here: the layout renders "Opening the
   * ledger" whenever the profile is falsy, so setProfile(undefined) unmounts
   * the whole app until a reload. The comment above that gate warns about
   * exactly this, and it caught me anyway.
   */
  const { data, error } = await supabase
    .from("profiles")
    .update({
      nominee_name: clearing ? null : nominee_name || null,
      nominee_contact: clearing ? null : nominee_contact || null,
      // Stamped so a nomination can be shown with its date — a nominee named
      // four years ago is worth re-reading, and only the date says so.
      nominee_set_at: clearing ? null : new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(migrationHint(error) || error.message);
  return { cleared: clearing, profile: data };
}

/**
 * Turn product events and crash reports off, or back on.
 *
 * TURNING THEM OFF ALSO DELETES WHAT WAS COLLECTED. A switch that stops
 * future collection while quietly keeping the existing pile is the weaker
 * half of the promise — somebody declining analytics means they would rather
 * this did not exist, not that it may continue existing provided nothing is
 * added to it. Both tables are records ABOUT them rather than anything they
 * asked us to hold, so there is nothing of theirs to lose.
 *
 * The flag is written first. If the deletes fail, collection has still
 * stopped, which is the half that matters most; the rows can be cleared
 * again. The reverse order could leave a switch that reads "off" while
 * events keep arriving.
 */
export async function setAnalyticsOptOut(optedOut) {
  const id = await uid();
  if (!id) throw new Error("Sign in first.");

  // Returns the row for the same reason saveNominee does — see the note there.
  const { data: profile, error } = await supabase
    .from("profiles").update({ analytics_opt_out: !!optedOut }).eq("id", id)
    .select().single();
  if (error) throw new Error(migrationHint(error) || error.message);

  // In effect from the next event, not the next sign-in.
  setAnalyticsFlag(!!optedOut);

  /**
   * Delete, then COUNT WHAT IS LEFT. Never trust the delete.
   *
   * The first version reported whatever `count` came back with and called it
   * done. It came back zero — because these tables had INSERT and SELECT
   * policies and no DELETE policy, so the statement matched no rows and
   * succeeded. 388 events survived a request to erase them while the screen
   * said there had been nothing to delete.
   *
   * An RLS-blocked DELETE is not an error: the rows are invisible to the
   * statement rather than protected from it, so nothing is thrown. This is
   * the third time that shape has bitten this project — it is what made
   * account deletion silently do nothing, twice, before /api/account started
   * re-fetching the user afterwards.
   *
   * So the answer comes from a second query rather than from the first one's
   * optimism, and anything left over is returned and said out loud. 035 adds
   * the missing policies; this makes sure a future missing one is noticed
   * within a second instead of never.
   */
  let erased = 0;
  const remaining = [];

  if (optedOut) {
    for (const table of ["user_events", "client_errors"]) {
      try {
        const { count: before } = await supabase
          .from(table).select("id", { count: "exact", head: true }).eq("user_id", id);
        await supabase.from(table).delete().eq("user_id", id);
        const { count: after } = await supabase
          .from(table).select("id", { count: "exact", head: true }).eq("user_id", id);

        erased += Math.max(0, (before || 0) - (after || 0));
        if (after > 0) remaining.push({ table, rows: after });
      } catch {
        // A table that isn't there yet has nothing to erase. Anything else
        // shows up as `remaining` on the next attempt rather than as silence.
      }
    }
  }

  return { erased, remaining, profile };
}

export async function markOpenPositions(openTrades) {
  if (!openTrades?.length) return { marked: [], error: null };

  const key = (e, s) => `${e}:${s}`;
  const q = openTrades.map((t) => `${t.symbol}:${t.exchange}`).join(",");

  let quotes = [];
  try {
    const res = await apiFetch(`/api/quotes?s=${encodeURIComponent(q)}`);
    const json = await res.json();
    quotes = json.quotes || [];
    if (!quotes.length) {
      return { marked: [], error: json.error || "No prices returned" };
    }
  } catch (err) {
    return { marked: [], error: err.message };
  }

  const byKey = new Map(quotes.map((x) => [key(x.exchange, x.symbol), x]));
  const marked = [];

  // Sequential updates: a handful of open positions, and this keeps one bad
  // row from failing the whole batch.
  for (const t of openTrades) {
    const hit = byKey.get(key(t.exchange, t.symbol));
    if (!hit?.price) continue;

    /**
     * prev_close rides along with last_price, and is written even when the
     * quote came back without one.
     *
     * Keeping an older close when a fetch omits it would look like the kind
     * thing to do, but it would pair a close from one day with a price from
     * another, and today's change would be computed across the gap. That is
     * a wrong number rather than a missing one, and it would appear in
     * rupees beside correct figures with nothing marking it as doubtful.
     */
    const patch = {
      last_price: hit.price,
      last_price_at: hit.at,
      prev_close: hit.prevClose ?? null,
      // Same rule again: written together with the price they are measured
      // against, nulled rather than kept, so a mark is never placed inside
      // some other day's range.
      day_high: hit.dayHigh ?? null,
      day_low: hit.dayLow ?? null,
    };
    const { data, error } = await supabase
      .from("trades")
      .update(patch)
      .eq("id", t.id)
      .select("id,last_price,last_price_at,prev_close,day_high,day_low")
      .single();

    if (!error && data) marked.push(data);
    else if (error) console.warn("[mark]", t.symbol, error.message);
  }

  return { marked, error: marked.length ? null : "Nothing could be marked" };
}

/* -------------------------------- import --------------------------- */

/**
 * Keys for everything already in the journal, so an overlapping file can be
 * re-imported safely. Each tax report covers one financial year, so a position
 * entered in March and exited in April appears in two of them.
 */
/**
 * Every position already in the journal, with the sells recorded against it.
 *
 * What the importer matches a file against. Deliberately more than the old key
 * list: to tell "this position has moved on since the last import" from "this
 * is a different trade", it needs the position's identity, how big it is and
 * which sells it already holds — not a string that folds all of that together.
 */
export async function listImportTargets() {
  const [trades, exits] = await Promise.all([
    fetchAllPages(() =>
      supabase.from("trades")
        // broker included since 019: reconcile refuses to match a position
        // against one from a different broker, and cannot tell without it.
        // entry_date_source since 036: the tradebook path only offers to date
        // positions whose date was invented, and cannot tell which without it.
        .select("id,symbol,entry_date,quantity,status,imported,broker,entry_date_source")
        .order("id")),
    fetchAllPages(() =>
      supabase.from("trade_exits")
        .select("trade_id,exit_date,quantity")
        .order("id")),
  ]);

  const byTrade = new Map();
  for (const e of exits) {
    if (!byTrade.has(e.trade_id)) byTrade.set(e.trade_id, []);
    byTrade.get(e.trade_id).push(e);
  }
  return trades.map((t) => ({ ...t, exits: byTrade.get(t.id) || [] }));
}

/**
 * Writes the batch row first so every trade can carry its id — that's what
 * makes an import reviewable and undoable as a unit. If the trades fail, the
 * batch row is removed again rather than left pointing at nothing.
 *
 * `_preview` is display-only scaffolding from the parser and is stripped here;
 * sending it would fail on a column that doesn't exist.
 */
/**
 * Write a journal back from the app's own export.
 *
 * The deciding half — validation, re-keying, foreign keys, keeping charge
 * overrides — lives in lib/restore.js and is pure, so it can be run against a
 * real export file without a database. This is only the part that talks to
 * Supabase, and it is here rather than there so importing the planner into a
 * test never drags a Supabase client along with it.
 *
 * UPSERT, NOT INSERT. Every id in the export is kept, so re-running the same
 * file overwrites the same rows instead of creating a second copy. Somebody
 * who is not sure whether the first attempt worked can simply do it again —
 * which is exactly what people do, and is normally how a restore turns into
 * a duplicated journal.
 *
 * PARENTS BEFORE CHILDREN, one table at a time. A trade_exit whose trade has
 * not been written yet fails on the foreign key.
 *
 * The batch exists so this is undoable by the machinery that already undoes
 * broker imports. It is deleted again if anything fails, so a half-finished
 * restore does not leave a batch describing work that did not happen.
 */
export async function restoreFromExport(json, filename = null) {
  const user_id = await uid();
  if (!user_id) throw new Error("Sign in first.");

  const info = inspectExport(json);
  if (!info.ok) throw new Error(info.error);
  if (!info.total) throw new Error("That export has nothing in it to restore.");

  const { rows, profilePatch } = await planRestore(json, user_id);

  const { data: batch, error: batchErr } = await supabase
    .from("import_batches")
    .insert({
      user_id,
      filename,
      source: "ledgerr-export",
      trades_count: rows.trades.length,
      lots_count: info.total,
    })
    .select()
    .single();
  if (batchErr) throw batchErr;

  const undoBatch = async () => {
    try { await supabase.from("import_batches").delete().eq("id", batch.id); } catch {}
  };

  // Stamped now rather than in the planner, because only here is there a
  // batch to point at. This is what makes the restore undoable.
  const trades = rows.trades.map((t) => ({ ...t, import_batch: batch.id }));

  /**
   * In chunks. A journal of any age runs to hundreds of rows and a single
   * request carrying all of them is the one most likely to be rejected for
   * its size — on a restore, where the person is already anxious about
   * whether their data survived.
   */
  const CHUNK = 200;
  const written = {};

  const writeAll = async (table, list) => {
    written[table] = 0;
    for (let i = 0; i < list.length; i += CHUNK) {
      const slice = list.slice(i, i + CHUNK);
      const { error } = await supabase.from(table).upsert(slice, { onConflict: "id" });
      if (error) {
        await undoBatch();
        throw new Error(
          `Restore stopped while writing ${table.replace(/_/g, " ")} ` +
          `(${written[table]} of ${list.length} done). ` +
          `${migrationHint(error) || error.message} ` +
          `Nothing further was written — running the same file again is safe.`
        );
      }
      written[table] += slice.length;
    }
  };

  await writeAll("trades", trades);
  for (const table of RESTORE_ORDER.filter((t) => t !== "trades")) {
    if (rows[table].length) await writeAll(table, rows[table]);
    else written[table] = 0;
  }

  /**
   * The profile last, and never fatal.
   *
   * By this point the journal itself is back, which is what the person came
   * for. Failing the whole restore over an account size would be telling them
   * their trades did not survive when they did.
   */
  let profileRestored = false;
  if (Object.keys(profilePatch).length) {
    const { error } = await supabase.from("profiles").update(profilePatch).eq("id", user_id);
    profileRestored = !error;
  }

  return { batchId: batch.id, written, profileRestored, skipped: SKIPPED_TABLES };
}

/**
 * A batch row on its own, for a run that changed something without importing.
 *
 * The tradebook path is the case: it creates no trade, so it has nothing for
 * importTrades to insert — but it very much has something to explain, since
 * the positions it could NOT date are what somebody comes back asking about.
 * A run that leaves no trace in the history is a run nobody can ask about.
 */
export async function recordBatch(meta) {
  const user_id = await uid();
  const { data, error } = await supabase
    .from("import_batches")
    .insert({ ...meta, user_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function importTrades({ trades, completions = [], meta }) {
  const user_id = await uid();

  const { data: batch, error: batchErr } = await supabase
    .from("import_batches")
    .insert({ ...meta, user_id })
    .select()
    .single();
  if (batchErr) throw batchErr;

  // `exits` is the tranche list; it rides alongside the trade rather than in
  // them, so strip it here and write it to trade_exits once ids come back.
  const rows = trades.map(({ _preview, exits, ...t }) => ({
    ...t,
    user_id,
    import_batch: batch.id,
  }));

  // Last line of defence, and a diagnostic. The insert is one statement, so a
  // single row Postgres won't take rejects the whole file — and it reports the
  // constraint without saying which row tripped it. Checking here turns that
  // into something you can act on.
  //
  // Mirrors the CHECK constraints exactly, including the one 013 relaxed:
  // shares that arrived free are allowed an entry price of zero, and only
  // those. Left as a blanket "must be positive" it went on rejecting the very
  // rows 013 was written to admit — and said the journal needed a positive
  // entry price for a row whose price was correctly, truthfully, nothing.
  const freeShares = (r) =>
    r.acquisition === "bonus" && Number(r.entry_price) === 0;

  const offenders = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) =>
      (!(Number(r.entry_price) > 0) && !freeShares(r)) ||
      !(Number(r.quantity) > 0) ||
      (r.exit_price != null && !(Number(r.exit_price) > 0))
    );

  if (offenders.length) {
    await supabase.from("import_batches").delete().eq("id", batch.id);
    const list = offenders
      .slice(0, 5)
      .map(({ r }) =>
        `${r.symbol} ${r.entry_date}→${r.exit_date} qty ${r.quantity} entry ${r.entry_price} exit ${r.exit_price}`
      )
      .join("; ");
    throw new Error(
      `${offenders.length} row${offenders.length === 1 ? "" : "s"} can't be saved — ` +
      `a quantity and an exit price are needed, and an entry price unless the ` +
      `shares were free. ${list}` +
      `${offenders.length > 5 ? ` (+${offenders.length - 5} more)` : ""}. Nothing was saved.`
    );
  }

  const { data, error } = await supabase.from("trades").insert(rows).select("id");
  if (error) {
    await supabase.from("import_batches").delete().eq("id", batch.id);
    throw new Error(migrationHint(error) || error.message);
  }

  // insert() returns rows in the order sent, which is what lets a tranche
  // list be matched back to the trade it came from.
  const exitRows = [];
  const tranche = (trade_id, e) => ({
    trade_id,
    user_id,
    exit_date: e.exit_date,
    quantity: Number(e.quantity),
    price: Number(e.price),
    reason: e.reason || null,
    charges: Number(e.charges) || 0,
    import_batch: batch.id,
  });

  (data || []).forEach((saved, i) => {
    for (const e of trades[i]?.exits || []) exitRows.push(tranche(saved.id, e));
  });

  // Sells for positions that were already here. No trade is created; these
  // attach to the row the user already has, so their stop, thesis and pattern
  // survive and the status trigger closes the position off the tranches.
  // Tagged with the batch like any other, which is what lets undo take them
  // back out again.
  for (const c of completions) {
    for (const e of c.tranches) exitRows.push(tranche(c.tradeId, e));
  }

  // An earlier import could only see the lots matched inside its own period,
  // so it may have recorded a smaller position than was really held. Where a
  // later file shows more, correct the size before the sells land — the status
  // trigger reads trades.quantity to decide partial from closed, and against a
  // stale figure it would call a half-sold position finished. Only ever
  // applied to imported rows; reconcile() refuses to touch a hand-typed size.
  for (const c of completions) {
    if (!c.grow) continue;
    const { error: growErr } = await supabase
      .from("trades")
      .update({ quantity: c.grow.quantity, entry_price: c.grow.entry_price })
      .eq("id", c.tradeId);
    if (growErr) {
      await supabase.from("trades").delete().eq("import_batch", batch.id);
      await supabase.from("import_batches").delete().eq("id", batch.id);
      throw new Error(`Could not correct the size of ${c.group.symbol}: ${growErr.message}. Nothing was saved.`);
    }
  }

  // A position that had no broker now belongs to the file that completed it.
  // Nothing the trader typed is touched — this is only what stops the next
  // broker's import matching the same trade and stacking its sells on top.
  for (const c of completions) {
    if (!c.claimsBroker) continue;
    const { error: brokerErr } = await supabase
      .from("trades")
      .update({ broker: c.claimsBroker })
      .is("broker", null)
      .eq("id", c.tradeId);
    if (brokerErr) {
      await supabase.from("trades").delete().eq("import_batch", batch.id);
      await supabase.from("import_batches").delete().eq("id", batch.id);
      throw new Error(
        migrationHint(brokerErr) ||
        `Could not record the broker on ${c.group.symbol}: ${brokerErr.message}. Nothing was saved.`
      );
    }
  }

  if (exitRows.length) {
    const { error: exitErr } = await supabase.from("trade_exits").insert(exitRows);
    if (exitErr) {
      // Undo the whole thing rather than leave positions with no exits —
      // they would read as open, with the wrong R, and be hard to spot.
      await supabase.from("trades").delete().eq("import_batch", batch.id);
      await supabase.from("import_batches").delete().eq("id", batch.id);
      throw new Error(
        isMissingTable(exitErr)
          ? "Migration 007 hasn't been run — supabase/007_partial_exits.sql creates the " +
            "trade_exits table this import needs. Nothing was saved."
          : exitErr.message
      );
    }
  }

  const result = {
    inserted: data?.length ?? rows.length,
    completed: completions.length,
    tranches: exitRows.length,
    batchId: batch.id,
  };
  // The size matters as much as the fact: an import of four hundred trades and
  // one of three are different events in someone's first ten minutes.
  track("imported", {
    inserted: result.inserted,
    completed: result.completed,
    tranches: result.tranches,
  });
  return result;
}

/**
 * Dismiss the breakeven reminder on one position.
 *
 * Writes a timestamp and nothing else. Not the stop — the stop lives at the
 * broker and this app holds exactly one, the one the trader typed. The whole
 * point of the column is that acknowledging a reminder and moving a stop are
 * different acts, and the app only witnesses the first.
 *
 * Guarded to open positions for the same reason the old version was: a closed
 * trade's reminder is history, and a stale screen should not be able to write
 * to it.
 */
export async function acknowledgeBreakeven(id) {
  const { data, error } = await supabase
    .from("trades")
    .update({ breakeven_ack_at: new Date().toISOString() })
    .in("status", ["open", "partial"])
    .eq("id", id)
    .select("id");
  if (error) throw new Error(migrationHint(error) || error.message);
  if (!data?.length) {
    throw new Error("That position isn't open any more — reload and try again.");
  }
  track("breakeven_acknowledged");
  return data[0];
}

/** Removes a batch and everything it wrote. trade_exits cascades off trades. */
export async function undoImport(batchId) {
  const { data, error } = await supabase.rpc("undo_import", { p_batch: batchId });
  if (error) throw error;
  return data;
}

/**
 * How many trades each batch still owns, right now.
 *
 * `import_batches.trades_count` is what the import claimed when it ran, and
 * on this database it is badly out of date: batches recording 244, 177 and
 * 132 trades have none left, because those rows were removed by the split
 * merge and other cleanups since. Summed across every batch it says 3,151
 * against 1,657 actually linked.
 *
 * Showing the recorded figure on an undo button would offer to delete 244
 * trades that are not there — the precise kind of wrong number that ruins a
 * screen whose whole purpose is making somebody feel safe pressing a
 * destructive button.
 *
 * Counted client-side from one column rather than by a grouped query, because
 * PostgREST has no group-by and the alternative is another database function
 * to maintain. One narrow column over a few thousand rows is cheap.
 */
export async function importBatchCounts() {
  const rows = await fetchAllPages(() =>
    supabase
      .from("trades")
      .select("id,import_batch")
      .not("import_batch", "is", null)
      .order("id", { ascending: true })
  );
  const counts = {};
  for (const r of rows) counts[r.import_batch] = (counts[r.import_batch] || 0) + 1;
  return counts;
}

export async function listImportBatches() {
  const { data, error } = await supabase
    .from("import_batches").select("*").order("created_at", { ascending: false });
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return data;
}


/**
 * Fill in stops one batch at a time — StopFill is built to be done in sittings.
 *
 * The first stop a trade is given is also its 1R, so it's pinned here on the
 * way in. Rows that already carry one are left alone: re-filling a stop must
 * not re-base the risk the trade was actually taken with.
 */
const STOP_CHUNK = 25;

export async function saveStops(rows, onProgress) {
  /**
   * Chunks in parallel rather than one at a time.
   *
   * Each row needs its own stop, so this can't be one statement — but a
   * thousand round trips in series is minutes of staring at a button, and
   * filling every stop at once is now something the app offers.
   *
   * allSettled rather than all: a single row Postgres won't take shouldn't
   * discard the nine hundred that saved beside it. Failures are counted and
   * reported at the end, and the rows that worked stay saved.
   */
  /**
   * Whatever the row actually decided, and nothing else.
   *
   * This used to write the stop columns unconditionally, which was right when
   * a stop was the only thing this screen could fix. It now also carries a
   * purchase date, because a holdings import leaves both missing on the same
   * rows and sending somebody to two screens for one chore is worse than the
   * gap it closes.
   *
   * Building the patch from the keys PRESENT matters: a row that only answered
   * the date must not also write `stop_loss: undefined` over a stop that is
   * already there. Absent means untouched, and untouched means leave alone —
   * the same rule `charges_auto` follows.
   *
   * Both stop columns still take the same value. The old form left an existing
   * initial_stop_loss alone so a re-fill could not rebase 1R, which is how a
   * row ended up holding two different stops.
   */
  const patchFor = (r) => ({
    ...(r.stop_loss !== undefined
      ? {
          stop_loss: r.stop_loss,
          initial_stop_loss: r.stop_loss,
          stop_source: r.stop_source || "recorded",
        }
      : {}),
    ...(r.entry_date !== undefined
      ? {
          entry_date: r.entry_date,
          // Typing the date is what makes it real — see migration 036 and the
          // matching line in TradeForm's payload.
          entry_date_source: r.entry_date_source || "recorded",
        }
      : {}),
  });

  track("stops_filled", { n: rows.length });

  let done = 0;
  const failures = [];

  for (let i = 0; i < rows.length; i += STOP_CHUNK) {
    const chunk = rows.slice(i, i + STOP_CHUNK);
    const results = await Promise.allSettled(
      chunk.map((r) =>
        supabase.from("trades").update(patchFor(r)).eq("id", r.id)
          .then(({ error }) => { if (error) throw error; })
      )
    );
    results.forEach((res, j) => {
      if (res.status === "rejected") failures.push({ row: chunk[j], error: res.reason });
      else done++;
    });
    onProgress?.(Math.min(i + STOP_CHUNK, rows.length), rows.length);
  }

  if (failures.length) {
    const first = failures[0].error;
    throw new Error(
      (migrationHint(first) || first?.message || "Some rows could not be saved") +
      ` — ${done} of ${rows.length} saved, ${failures.length} failed.`
    );
  }
  return done;
}

/* -------------------------------- diary ---------------------------- */

export async function listDiary() {
  return fetchAllPages(() =>
    supabase
      .from("diary_entries")
      .select("*")
      .order("entry_date", { ascending: false })
      .order("id", { ascending: true })
  );
}

export async function saveDiary(entry, imageFile) {
  const user_id = await uid();
  let image_path = entry.image_path || null;

  if (imageFile) {
    const path = `${user_id}/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage
      .from("charts").upload(path, imageFile, { contentType: "image/jpeg", upsert: false });
    if (error) throw error;
    image_path = path;
  }

  const { data, error } = await supabase
    .from("diary_entries").upsert({ ...entry, image_path, user_id }).select().single();
  if (error) throw error;
  track("diary_written", { withImage: !!image_path });
  return data;
}

/** Charts live in a private bucket — this mints a short-lived viewing URL.
 *  A pasted chart link (see resolveTradingViewChart) is stored as a full
 *  external URL in the same column rather than a Storage path — pass it
 *  through as-is instead of asking Storage to sign a path it doesn't own. */
export async function chartUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const { data } = await supabase.storage.from("charts").createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

export async function deleteDiary(entry) {
  if (entry.image_path) await supabase.storage.from("charts").remove([entry.image_path]);
  const { error } = await supabase.from("diary_entries").delete().eq("id", entry.id);
  if (error) throw error;
}

/* -------------------------------- avatar --------------------------- */

const AVATAR_PX = 256;

/**
 * Square the image and shrink it before it ever leaves the browser.
 *
 * A photo straight off a phone is several megabytes and thousands of pixels
 * wide, to be drawn at 32. Uploading that would cost the user their data, cost
 * the storage bill, and look no better. Cropped to a square from the centre so
 * a portrait doesn't arrive squashed.
 */
function squareToBlob(file, px = AVATAR_PX) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = px;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(
        img,
        (img.width - side) / 2, (img.height - side) / 2, side, side,
        0, 0, px, px
      );
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Could not read that image."))),
        "image/jpeg",
        0.9
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't an image this browser can read."));
    };
    img.src = url;
  });
}

/**
 * Replace the account's picture. Returns the stored path.
 *
 * The old file is removed after the new one is recorded, not before: if the
 * upload fails the account keeps the picture it had, and an orphaned object
 * costs a few kilobytes where a broken profile costs trust.
 */
export async function uploadAvatar(file) {
  const user_id = await uid();
  const blob = await squareToBlob(file);
  const path = `${user_id}/${crypto.randomUUID()}.jpg`;

  const { error } = await supabase.storage
    .from("avatars").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;

  const { data: prev } = await supabase
    .from("profiles").select("avatar_path").eq("id", user_id).single();

  const { data, error: saveErr } = await supabase
    .from("profiles").update({ avatar_path: path }).eq("id", user_id).select().single();
  if (saveErr) throw saveErr;

  if (prev?.avatar_path && prev.avatar_path !== path) {
    await supabase.storage.from("avatars").remove([prev.avatar_path]);
  }
  return data;
}

export async function removeAvatar() {
  const user_id = await uid();
  const { data: prev } = await supabase
    .from("profiles").select("avatar_path").eq("id", user_id).single();

  const { data, error } = await supabase
    .from("profiles").update({ avatar_path: null }).eq("id", user_id).select().single();
  if (error) throw error;

  if (prev?.avatar_path) await supabase.storage.from("avatars").remove([prev.avatar_path]);
  return data;
}

/**
 * Choose one of the drawn avatars.
 *
 * Writes the sentinel into the same column an upload uses, and deletes the
 * uploaded file if there was one — otherwise picking a preset would leave the
 * old photo sitting in the bucket, paid for and unreachable, and switching
 * back and forth would accumulate them.
 */
export async function saveAvatarPreset(index) {
  const user_id = await uid();
  const { data: prev } = await supabase
    .from("profiles").select("avatar_path").eq("id", user_id).single();

  const { data, error } = await supabase
    .from("profiles").update({ avatar_path: presetPath(index) }).eq("id", user_id)
    .select().single();
  if (error) throw error;

  if (prev?.avatar_path && !isPreset(prev.avatar_path)) {
    await supabase.storage.from("avatars").remove([prev.avatar_path]);
  }
  return data;
}

/** A viewing URL for a stored avatar. Private bucket, so it expires. */
export async function avatarUrl(path) {
  // A preset is drawn, not stored, so there is nothing to sign. Returning null
  // lets the caller fall through to rendering it directly.
  if (!path || isPreset(path)) return null;
  const { data } = await supabase.storage.from("avatars").createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

/* ---------------------------- capital flows ------------------------ */

export async function listFlows() {
  return fetchAllPages(() =>
    supabase
      .from("capital_flows")
      .select("*")
      .order("flow_date")
      .order("id", { ascending: true })
  );
}

export async function saveFlow(flow) {
  const user_id = await uid();
  const { data, error } = await supabase
    .from("capital_flows").upsert({ ...flow, user_id }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteFlow(id) {
  const { error } = await supabase.from("capital_flows").delete().eq("id", id);
  if (error) throw error;
}

/* ------------------------------ settings --------------------------- */

export async function getProfile() {
  const { data, error } = await supabase.from("profiles").select("*").single();
  if (error) throw error;
  return data;
}

export async function saveProfile(patch) {
  const id = await uid();
  const { data, error } = await supabase
    .from("profiles").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

/* -------------------------------- auth ----------------------------- */

/**
 * The magic link is gone, and signInWithOtp with it.
 *
 * It existed because it was once the only way to create an account at all —
 * this function only ever admits a user who already exists. Sign-up and Google
 * both work now, so it had become a third route to what two already do, and
 * the only one whose failure is silent: a link sitting in a spam folder is
 * indistinguishable from an app that ignored you. Anyone who signed up by link
 * and never set a password gets in through sendPasswordReset below, which
 * issues one.
 */
export const signInWithPassword = (email, password) =>
  supabase.auth.signInWithPassword({ email, password });

/**
 * Create an account with an email and a password of the user's choosing.
 *
 * WITHOUT THIS THERE IS NO WAY TO SIGN UP AT ALL except the magic link, since
 * `signInWithPassword` only ever admits a user who already exists — which made
 * outgoing email the single point of failure for every new account on a service
 * whose own sender is rate-limited.
 *
 * The caller has to handle two outcomes, and which one it gets is a dashboard
 * setting rather than anything in this code. With "Confirm email" off, a
 * session comes back and the user is in. With it on, `data.session` is null and
 * a confirmation mail has gone out instead. Treating the second case as success
 * would drop somebody on a blank screen wondering if it worked.
 */
export const signUpWithPassword = (email, password) =>
  supabase.auth.signUp({ email, password });

/**
 * Google, which is the only way in that touches no email at all — no send
 * limit, no spam folder, no address typed wrong and locked out forever.
 *
 * Requires the provider to be configured in Supabase; until it is, this errors.
 * The button is behind NEXT_PUBLIC_GOOGLE_AUTH for exactly that reason, so an
 * unconfigured deployment shows no button rather than a broken one.
 */
export const signInWithGoogle = (redirectTo) =>
  supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      // Always ask which Google account. Without this, Google silently reuses
      // whichever one the browser is already signed into and the user never
      // sees a choice — so somebody with a personal and a trading Gmail, or a
      // shared family machine, lands in the wrong journal with no way to say
      // otherwise. The one extra click buys the ability to pick.
      queryParams: { prompt: "select_account" },
    },
  });

export const signOut = () => supabase.auth.signOut();

/**
 * Send the "set a new password" email.
 *
 * Recovery rides the same implicit flow as the magic link: the session comes
 * back in the URL fragment, so the link works in whichever browser opens it —
 * which matters, because the one place people read email is rarely the one
 * they were locked out of.
 *
 * `/reset` sits outside the app's auth gate. Landing there already signs the
 * visitor in, and dropping them straight into the journal would leave them
 * with the password they came to change.
 */
export const sendPasswordReset = (email, redirectTo) =>
  supabase.auth.resetPasswordForEmail(email, { redirectTo });

/** Set the password on the signed-in account. */
export const updatePassword = (password) =>
  supabase.auth.updateUser({ password });

/**
 * Prove the person at the keyboard knows the current password.
 *
 * Supabase treats the session alone as sufficient to change a password, which
 * would let anyone who found an unlocked laptop lock the owner out of their
 * own trading history. Signing in again with the old password costs one round
 * trip and closes that.
 *
 * Returns false for an account that has only ever used magic links, since
 * there is no password to check — the caller sends those to email recovery.
 */
export async function reauthenticate(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return !error;
}

/* ------------------------------ export ----------------------------- */

/**
 * Everything this account owns, in one file.
 *
 * WHY IT IS ALL OF IT. The privacy policy says your journal can be exported at
 * any time, and the sign-up card says you can take everything and leave. A
 * partial export makes both of those sentences untrue — and the trades CSV on
 * the trade sheet, useful as it is, carries no diary, no capital flows and no
 * settings. This is the one that has to match the promise.
 *
 * JSON RATHER THAN A ZIP OF CSVs. A CSV per table would be friendlier to open
 * and would lose the shape: which sell belongs to which trade, which diary
 * entry hangs off which position. The point of this file is that nothing is
 * lost, so it is the whole graph or it is a convenience — and the convenience
 * already exists on the trade sheet. It also means no archive library ships to
 * everyone who never presses the button.
 *
 * INCLUDING WHAT WE RECORDED ABOUT YOU, not only what you typed. Product events
 * and crash reports are personal data under the DPDP Act's right of access, so
 * leaving them out would be choosing the flattering reading of "everything".
 *
 * CHART IMAGES are referenced, not embedded. A pasted TradingView link is
 * already a URL and survives; a file uploaded back when uploads existed lives
 * in private storage, so a short-lived signed link is included beside its path.
 * Those expire — which is said in the file rather than left to be discovered.
 */
/**
 * How many bytes of chart images an export will carry before it stops.
 *
 * Counted on the raw images, not the encoded text: base64 inflates by about
 * a third, so this is roughly a 21MB file's worth of pictures. A browser has
 * to hold the whole thing as a string to save it, and an export that runs the
 * tab out of memory produces nothing at all — which is worse than an export
 * carrying most of the charts and saying which ones it left out.
 */
const CHART_EMBED_LIMIT = 16 * 1024 * 1024;

/** Blob to `data:` URI. FileReader rather than manual base64 because it gets
 *  the MIME type from the blob and does not build a huge intermediate array. */
function blobToDataUri(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function exportEverything() {
  const user_id = await uid();

  const raw = (table, order) =>
    fetchAllPages(() => supabase.from(table).select("*").order(order, { ascending: true }));

  const [profile, trades, exits, diary, flows, batches, events, errors] = await Promise.all([
    getProfile().catch(() => null),
    listTrades().catch(() => []),
    raw("trade_exits", "exit_date").catch(() => []),
    listDiary().catch(() => []),
    listFlows().catch(() => []),
    listImportBatches().catch(() => []),
    raw("user_events", "created_at").catch(() => []),
    raw("client_errors", "created_at").catch(() => []),
  ]);

  /**
   * Uploaded charts, carried INSIDE the file rather than linked from it.
   *
   * They used to be signed URLs, which the note honestly said expire within
   * the hour — and that is the problem. Somebody exporting "everything" is
   * doing it precisely so they have it later, and later is exactly when a
   * signed URL is worthless. Worse, the one moment the export truly matters
   * is after the account is deleted, and deletion purges the bucket, so both
   * the link and the file behind it are gone.
   *
   * So each image is read once and embedded as a data URI. The file gets
   * bigger; it also becomes true.
   *
   * Only genuinely stored images. A pasted TradingView link is already a
   * durable URL and asking storage to sign it would fail on every entry.
   *
   * Sequential, not Promise.all: the running total is what decides whether
   * the next image is embedded, and concurrent workers all reading a stale
   * total would sail past the cap together.
   */
  const stored = diary.filter((d) => d.image_path && !/^https?:\/\//i.test(d.image_path));
  const charts = {};
  let embedded = 0;
  let skipped = 0;

  for (const d of stored) {
    try {
      const url = await chartUrl(d.image_path);
      // Past the cap, fall back to the old behaviour rather than failing the
      // whole export. A link that expires beats no export at all, and the
      // note below says which ones those are.
      if (embedded >= CHART_EMBED_LIMIT) { charts[d.image_path] = url; skipped++; continue; }

      const blob = await (await fetch(url)).blob();
      if (embedded + blob.size > CHART_EMBED_LIMIT) {
        charts[d.image_path] = url; skipped++; continue;
      }
      charts[d.image_path] = await blobToDataUri(blob);
      embedded += blob.size;
    } catch {
      skipped++;
    }
  }

  return {
    exported_at: new Date().toISOString(),
    account: { user_id, email: (await supabase.auth.getUser()).data?.user?.email ?? null },
    note:
      "Everything this account holds. Uploaded charts are embedded in " +
      "`chart_links` as data: URIs — the image itself is in this file, so it " +
      "still opens after the account is gone. Paste one into a browser's " +
      "address bar to view it." +
      (skipped
        ? ` ${skipped} could not be embedded and are temporary links that stop ` +
          "working within the hour — open and save those now if you want them."
        : "") +
      " TradingView links stored on diary entries are ordinary URLs and do not " +
      "expire. Trades and their sells are joined by trade_exits.trade_id; diary " +
      "entries point at a trade through trade_id.",
    chart_images_embedded: stored.length - skipped,
    chart_images_missing: skipped,
    profile,
    trades,
    trade_exits: exits,
    diary_entries: diary,
    capital_flows: flows,
    import_batches: batches,
    user_events: events,
    client_errors: errors,
    chart_links: charts,
  };
}

/**
 * Sign out of every browser, not just this one.
 *
 * The plain signOut() drops the token held here and leaves every other
 * session alone, which is the right default and the wrong answer to the
 * question people actually ask — they signed in on a friend's laptop, or an
 * office machine, and want it undone from where they are now.
 *
 * Supabase revokes the refresh tokens server-side, so the other browsers stop
 * working at their next refresh rather than instantly. Worth saying in the UI:
 * "everywhere" that takes up to an hour is not what it sounds like.
 */
export const signOutEverywhere = () => supabase.auth.signOut({ scope: "global" });

/**
 * Delete this account and everything in it.
 *
 * THE WORK HAPPENS ON THE SERVER, at /api/account, and it took two failed
 * attempts to accept that. A `security definer` function was tried first, to
 * keep the service-role key out of this app entirely — but auth.users has row
 * level security and is owned by supabase_auth_admin, so a function owned by
 * postgres could not touch it. A DELETE blocked by RLS is not an error: it
 * matched zero rows and returned success, so the button signed people out,
 * showed them the landing page, and left every row where it was.
 *
 * A promise in the privacy policy that quietly does nothing is worse than a
 * secret held on a server. The route takes no id — it deletes whoever the
 * access token says is calling — so nothing about it can be pointed at
 * somebody else.
 *
 * Signs out afterwards because the session outlives the user it referred to:
 * the token stays cryptographically valid until it expires, and every request
 * it makes now returns nothing at all, which reads as the app having broken
 * rather than as the account having gone.
 */
export async function deleteMyAccount() {
  const res = await apiFetch("/api/account", { method: "DELETE" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Could not delete the account.");

  try { await supabase.auth.signOut(); } catch { /* the account is gone either way */ }
}
