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
export function track(event, props = {}) {
  (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data?.session?.user?.id;
      if (!uid) return;
      await supabase.from("user_events").insert({ user_id: uid, event, props });
    } catch {
      /* deliberately silent — see above */
    }
  })();
}

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
        // broker included since 019: reconcile refuses to match a position
        // against one from a different broker, and cannot tell without it.
        .select("id,symbol,entry_date,quantity,status,imported,broker")
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
  // Both columns, always the same value. The old form left an existing
  // initial_stop_loss alone so a re-fill could not rebase 1R, which is how a
  // row ended up holding two different stops.
  const patchFor = ({ stop_loss, stop_source }) =>
    ({ stop_loss, initial_stop_loss: stop_loss, stop_source: stop_source || "recorded" });

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

/** A viewing URL for a stored avatar. Private bucket, so it expires. */
export async function avatarUrl(path) {
  if (!path) return null;
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
