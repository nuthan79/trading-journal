import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { userFromRequest } from "@/lib/apiAuth";

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
      const { data } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
      const paths = (data || []).map((o) => `${userId}/${o.name}`);
      if (paths.length) await admin.storage.from(bucket).remove(paths);
    } catch {
      /* see above */
    }
  }
}

export async function DELETE(req) {
  const userId = await userFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!url || !serviceKey) {
    // Said plainly rather than pretending. The previous version of this
    // feature failed silently, which is the fault being corrected.
    return NextResponse.json(
      { error: "Account deletion isn't configured on the server yet." },
      { status: 503 }
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await purgeStorage(admin, userId);

  // Everything else — trades, exits, diary, flows, batches, events, crash
  // reports, the profile — follows this out through its cascades.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    // Never the provider's raw message: it can quote identifiers that mean
    // nothing to the person reading it.
    return NextResponse.json({ error: "Could not delete the account." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
