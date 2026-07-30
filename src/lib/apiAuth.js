import { createClient } from "@supabase/supabase-js";

/**
 * Who is calling an API route.
 *
 * The session lives in localStorage, not a cookie — see the note on the client
 * in db.js, which trades cookie storage for magic links that survive being
 * opened in a phone's mail app. Nothing is therefore sent to the server on its
 * own, so the caller has to present the access token itself and these routes
 * have to check it rather than read a session.
 *
 * Verified against Supabase rather than by decoding the JWT here. That is a
 * round trip, but it means no service-role key or JWT secret has to exist in
 * this process, and a token revoked by a sign-out stops working immediately
 * instead of staying good until it expires.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// The anon key grants nothing on its own: every table is behind RLS, and this
// client is only ever used to ask Supabase who a token belongs to.
const auth = url && anon
  ? createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

/**
 * Returns the user id, or null. Callers should treat null as 401 — no route
 * here is worth serving to a stranger: one spends the deployment's Yahoo
 * quota, and both would let someone else's traffic get this IP rate-limited,
 * which is what would break marks for the people paying for it.
 */
export async function userFromRequest(req) {
  if (!auth) return null;

  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  try {
    const { data, error } = await auth.auth.getUser(token);
    if (error) return null;
    return data?.user?.id || null;
  } catch {
    // A quote route should not 500 because the auth service was slow.
    return null;
  }
}
