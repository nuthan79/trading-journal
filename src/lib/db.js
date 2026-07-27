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

/* ------------------------------- trades ---------------------------- */

export async function listTrades() {
  const { data, error } = await supabase
    .from("trades").select("*").order("entry_date", { ascending: false });
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

/* -------------------------------- diary ---------------------------- */

export async function listDiary() {
  const { data, error } = await supabase
    .from("diary_entries").select("*").order("entry_date", { ascending: false });
  if (error) throw error;
  return data;
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
  const { data, error } = await supabase
    .from("capital_flows").select("*").order("flow_date");
  if (error) throw error;
  return data;
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
