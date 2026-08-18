import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { userFromRequest } from "@/lib/apiAuth";
import { rateLimit, tooMany } from "@/lib/rateLimit";

/**
 * Deleting an account is not something anybody does twice by accident.
 *
 * Low not to ration a legitimate user — one is enough — but because this route
 * holds the service-role key and purges storage, and a loop hitting it is the
 * most expensive mistake available here.
 */
const LIMIT = { limit: 3, windowMs: 60 * 60 * 1000 };

/**
 * DELETE /api/account — remove the caller's account, permanently.
 *
 * WHY THIS EXISTS, HAVING ARGUED AGAINST IT
 *
 * 027 and 029 did this in a `security definer` function precisely to avoid
 * putting a service-role key in this app. That reasoning was sound and the
 * result was worse than the thing it avoided: `auth.users` carries row level
 * security and is owned by `supabase_auth_admin`, while the function is owned
 * by `postgres`, which is not a superuser here. SECURITY DEFINER does not
 * bypass RLS unless the owner owns the table — so the DELETE matched zero rows
 * and, because a blocked DELETE is not an error, returned success.
 *
 * The button therefore signed people out, sent them to the landing page, and
 * left every row exactly where it was. A promise in the privacy policy that
 * quietly does nothing is worse than one secret held on a server.
 *
 * WHAT KEEPS THE KEY SAFE
 *
 * SUPABASE_SERVICE_ROLE_KEY has no NEXT_PUBLIC_ prefix, so it is never
 * compiled into anything a browser receives. The route takes no id: the user
 * it deletes comes from the verified access token, so there is no parameter to
 * tamper with and no way to name a victim. And it is the only thing this
 * process ever does with that key.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Uploaded charts and avatars.
 *
 * Storage does not cascade from auth.users, so without this the files outlive
 * the account — still stored, still billed, still holding someone's chart
 * images after they asked to be forgotten. Done before the user row goes, and
 * never allowed to block it: an orphaned image is a smaller failure than an
 * account that cannot be deleted.
 */
async function purgeStorage(admin, userId) {
  for (const bucket of ["charts", "avatars"]) {
    try {
      const { data, error } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
      if (error) { console.error("[account] list", bucket, error.message); continue; }
      const paths = (data || []).map((o) => `${userId}/${o.name}`);
      if (!paths.length) continue;
      const { error: rmErr } = await admin.storage.from(bucket).remove(paths);
      if (rmErr) console.error("[account] remove", bucket, rmErr.message);
    } catch (e) {
      console.error("[account] storage", bucket, e?.message);
    }
  }
}

export async function DELETE(req) {
  const userId = await userFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const gate = rateLimit(`account-delete:${userId}`, LIMIT);
  if (!gate.ok) {
    return tooMany(gate.retryAfter, "Too many delete attempts. Wait a little and try again.");
  }

  if (!url || !serviceKey) {
    // Said plainly rather than pretending. The previous version of this
    // feature failed silently, which is the fault being corrected.
    console.error("[account] not configured:",
      `url=${!!url}`, `serviceKey=${!!serviceKey}`);
    return NextResponse.json(
      { error: "Account deletion isn't configured on the server yet." },
      { status: 503 }
    );
  }

  /**
   * The shape of the key, never the key.
   *
   * Three attempts at this feature have now failed in three different ways and
   * all of them looked the same from the browser, so the one fact worth
   * writing down is which kind of credential arrived: a publishable key in
   * this slot would explain an admin call being refused, and is otherwise
   * invisible. Length and prefix only — enough to identify the type, useless
   * to anyone reading the logs.
   */
  console.log("[account] key kind:",
    serviceKey.startsWith("sb_secret_") ? "sb_secret"
      : serviceKey.startsWith("sb_publishable_") ? "sb_publishable (WRONG — this is the public one)"
      : serviceKey.startsWith("eyJ") ? "legacy JWT"
      : "unrecognised",
    `len=${serviceKey.length}`);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await purgeStorage(admin, userId);

  // Everything else — trades, exits, diary, flows, batches, events, crash
  // reports, the profile — follows this out through its cascades.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    // The browser gets nothing useful, on purpose — but the reason is written
    // where it can be read, because a generic message on the screen is what
    // made the last two failures indistinguishable from each other.
    console.error("[account] deleteUser failed:", error.status, error.message);
    return NextResponse.json({ error: "Could not delete the account." }, { status: 500 });
  }

  /**
   * Confirmed, not assumed.
   *
   * The whole history of this feature is calls that reported success without
   * acting — an RLS-blocked DELETE matching zero rows and returning ok. So the
   * row is looked for again afterwards, and a user who is still there is
   * reported as a failure rather than celebrated as one.
   */
  const { data: still } = await admin.auth.admin.getUserById(userId);
  if (still?.user?.id) {
    console.error("[account] deleteUser returned ok but the user is still present:", userId);
    return NextResponse.json(
      { error: "The account could not be removed. Nothing was deleted." },
      { status: 500 }
    );
  }

  console.log("[account] deleted", userId);
  return NextResponse.json({ ok: true });
}
