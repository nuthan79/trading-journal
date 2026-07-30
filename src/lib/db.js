"use client";

import { createClient } from "@supabase/supabase-js";

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
  if (error) throw error;
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
export async function markOpenPositions(openTrades) {
  if (!openTrades?.length) return { marked: [], error: null };

  const key = (e, s) => `${e}:${s}`;
  const q = openTrades.map((t) => `${t.symbol}:${t.exchange}`).join(",");

  let quotes = [];
  try {
    const res = await fetch(`/api/quotes?s=${encodeURIComponent(q)}`);
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

    const patch = { last_price: hit.price, last_price_at: hit.at };
    const { data, error } = await supabase
      .from("trades")
      .update(patch)
      .eq("id", t.id)
      .select("id,last_price,last_price_at")
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
        .select("id,symbol,entry_date,quantity,status")
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
  const offenders = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) =>
      !(Number(r.entry_price) > 0) ||
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
      `the journal needs a positive entry price, quantity and exit price. ${list}` +
      `${offenders.length > 5 ? ` (+${offenders.length - 5} more)` : ""}. Nothing was saved.`
    );
  }

  const { data, error } = await supabase.from("trades").insert(rows).select("id");
  if (error) {
    await supabase.from("import_batches").delete().eq("id", batch.id);
    throw error;
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

  return {
    inserted: data?.length ?? rows.length,
    tranches: exitRows.length,
    batchId: batch.id,
  };
}

/** Removes a batch and everything it wrote. trade_exits cascades off trades. */
export async function undoImport(batchId) {
  const { data, error } = await supabase.rpc("undo_import", { p_batch: batchId });
  if (error) throw error;
  return data;
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
 * Trail a stop up to entry, taking the position's risk off the table.
 *
 * `initial_stop_loss` is written alongside because it is nullable: migration
 * 007 backfilled the rows that existed then, and `derivePosition` falls back
 * to `stop_loss` when it's missing. Move the stop without pinning it and a
 * trade whose column is still null gets a 1R of zero — every R it has ever
 * recorded divides by nothing. Passing the initial stop the caller already
 * derived repairs a null row and is a no-op on a row that has one.
 */
export async function moveStopToEntry({ id, entry, initialStop }) {
  const { data, error } = await supabase
    .from("trades")
    .update({ stop_loss: entry, initial_stop_loss: initialStop })
    // Only ever a live position. The caller reads from the open list, so this
    // is a guard against a stale screen — a trade closed in another tab, or
    // between the page loading and the button being pressed. A closed trade's
    // stop is history and moving it would silently restate a recorded R.
    .in("status", ["open", "partial"])
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data?.length) {
    throw new Error("That position isn't open any more — reload and try again.");
  }
}

/**
 * Fill in stops one batch at a time — StopFill is built to be done in sittings.
 *
 * The first stop a trade is given is also its 1R, so it's pinned here on the
 * way in. Rows that already carry one are left alone: re-filling a stop must
 * not re-base the risk the trade was actually taken with.
 */
export async function saveStops(rows) {
  for (const { id, stop_loss, initial_stop_loss } of rows) {
    const patch = initial_stop_loss == null
      ? { stop_loss, initial_stop_loss: stop_loss }
      : { stop_loss };
    const { error } = await supabase
      .from("trades")
      .update(patch)
      .eq("id", id);
    if (error) throw error;
  }
  return rows.length;
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

export const sendMagicLink = (email, emailRedirectTo) =>
  supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } });

/**
 * Kept alongside the magic link on purpose. Magic links depend on email
 * delivery and Supabase's send-rate cap, so password sign-in is the way
 * back in when a link is slow, rate-limited, or lands in a browser that
 * can't reach this app.
 */
export const signInWithPassword = (email, password) =>
  supabase.auth.signInWithPassword({ email, password });

export const signOut = () => supabase.auth.signOut();
