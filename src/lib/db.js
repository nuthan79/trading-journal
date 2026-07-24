"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * The whole storage layer. In the prototype this was window.storage; here it
 * is Postgres. The UI components call these same-shaped functions, which is
 * why porting the interface across is mostly mechanical.
 */

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
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

/** Refresh last_price on open positions from the quote route. */
export async function markOpenPositions(openTrades) {
  if (!openTrades.length) return [];
  const q = openTrades.map((t) => `${t.symbol}:${t.exchange}`).join(",");
  const res = await fetch(`/api/quotes?s=${encodeURIComponent(q)}`);
  const { quotes = [] } = await res.json();
  if (!quotes.length) return [];

  const byKey = new Map(quotes.map((x) => [`${x.exchange}:${x.symbol}`, x]));
  const updates = openTrades
    .map((t) => {
      const hit = byKey.get(`${t.exchange}:${t.symbol}`);
      return hit?.price ? { id: t.id, last_price: hit.price, last_price_at: hit.at } : null;
    })
    .filter(Boolean);

  if (!updates.length) return [];
  const user_id = await uid();
  const { data, error } = await supabase
    .from("trades")
    .upsert(updates.map((u) => ({ ...u, user_id })), { onConflict: "id" })
    .select("id,last_price,last_price_at");
  if (error) throw error;
  return data;
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

/** Charts live in a private bucket — this mints a short-lived viewing URL. */
export async function chartUrl(path) {
  if (!path) return null;
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

export const signIn = (email, password) =>
  supabase.auth.signInWithPassword({ email, password });

export const signOut = () => supabase.auth.signOut();
