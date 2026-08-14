"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, updatePassword } from "@/lib/db";
import { MIN_PASSWORD } from "@/lib/password";
import { RevealToggle, pwType } from "@/components/PasswordEye";

/**
 * Where the recovery email lands.
 *
 * Outside the (app) route group on purpose. The recovery link already carries
 * a session in its fragment, so anything under the auth gate would wave the
 * visitor straight through into the journal — still holding the password they
 * came here to replace, and with no obvious way to change it.
 *
 * A session is not what unlocks the form — following a recovery link is. See
 * the note on `recovery` below; an expired link, a link opened twice, and
 * someone simply typing /reset while signed in are all turned away, each told
 * what to do instead rather than shown a form that fails on submit.
 */

/**
 * The fragment as it was when the document loaded.
 *
 * `window.__lrHash` is set by an inline script in the root layout, which runs
 * before any bundle and therefore before the supabase client can consume the
 * recovery fragment and strip it from the address bar. See the note there.
 *
 * Snapshotting at module scope was tried first and is not reliable: db.js is
 * in an earlier chunk and can finish its URL handling before this module is
 * evaluated. That produced exactly the failure this is here to prevent — a
 * valid recovery link signing somebody in and then being told there was
 * nothing to recover. The module-scope read is kept only as a fallback for a
 * document that somehow rendered without the script.
 */
const INITIAL_HASH =
  typeof window === "undefined"
    ? ""
    : (window.__lrHash ?? window.location.hash.slice(1));

/** How long to wait for PASSWORD_RECOVERY before deciding it isn't coming.
 *  Only reached when the fragment was already stripped AND the event fired
 *  before we subscribed — the case the snapshot above is there to prevent. */
const RECOVERY_GRACE_MS = 1500;

export default function ResetPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  /**
   * Arrived by following a recovery link, as opposed to merely being signed in.
   *
   * The distinction is the whole security of this page. A session alone is not
   * permission to set a password without knowing the old one — otherwise anyone
   * who found an unlocked browser could come straight here and lock the owner
   * out, which is exactly what asking for the current password in Settings is
   * there to prevent.
   *
   * The PASSWORD_RECOVERY event is the signal that matters: supabase-js emits
   * it when it consumes a recovery link, having already stripped the fragment.
   * The fragment is checked too, for the case where there was no session to
   * extract and nothing was stripped — but only from an effect. A useState
   * initialiser is no good here: this renders on the server first, where there
   * is no location, and hydration keeps that value rather than re-running it.
   */
  const [recovery, setRecovery] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    // The snapshot first, falling back to the live hash for a plain visit
    // where there was nothing for the client to strip.
    const hash = new URLSearchParams(INITIAL_HASH || window.location.hash.slice(1));

    // Supabase said no before this page ran — an expired token, or one already
    // spent. Nothing to wait for, so answer immediately.
    if (hash.get("error")) {
      setErr(hash.get("error_description") || "That link didn't work — ask for a new one.");
      setReady(true);
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    const arrivedByLink = hash.get("type") === "recovery";
    if (arrivedByLink) setRecovery(true);

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(s);
      setReady(true);
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      // THE FIX. getSession resolves long before the client has finished
      // exchanging a recovery fragment for a session, so declaring readiness
      // here told anyone following a perfectly good link that it had expired —
      // the most alarming message this app can show, at the exact moment
      // somebody is already locked out. When the URL says a recovery is in
      // flight, wait for it to land.
      if (!arrivedByLink) setReady(true);
    });

    // Re-read rather than just flipping ready. The session may have been
    // established while we were waiting — by an event that fired before this
    // listener existed — and the copy taken above would still be the null one
    // read before the exchange finished. Deciding on that would report a good
    // link as expired, which is the whole fault being fixed.
    const grace = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setReady(true);
    }, RECOVERY_GRACE_MS);
    return () => { clearTimeout(grace); sub.subscription.unsubscribe(); };
  }, []);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && password !== confirm;
  const valid = password.length >= MIN_PASSWORD && password === confirm;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr("");
    const { error } = await updatePassword(password);
    if (error) setErr(error.message);
    else setDone(true);
    setBusy(false);
  };

  if (!ready) {
    return <div className="wrap"><div className="eyebrow">Checking your link</div></div>;
  }

  return (
    <div className="wrap" style={{ maxWidth: 380 }}>
      <div className="eyebrow">Trading Journal</div>
      <h1 className="disp" style={{ fontSize: 22, margin: "6px 0 24px" }}>
        {done ? "Password changed" : "Set a new password"}
      </h1>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {done ? (
          <>
            <p style={{ fontSize: 13, color: "var(--ink2)", lineHeight: 1.6, margin: 0 }}>
              You&apos;re signed in on this device already. Use the new password next time.
            </p>
            <button className="btn" onClick={() => router.push("/dashboard")}>Go to the journal</button>
          </>
        ) : !session || !recovery ? (
          <>
            <p style={{ fontSize: 13, color: "var(--ink2)", lineHeight: 1.6, margin: 0 }}>
              {err
                || (session
                  ? "You're already signed in, so there's nothing to recover here. To change " +
                    "your password, open Setup — it asks for the current one first."
                  : "This link has expired or has already been used. Recovery links are " +
                    "good once and not for long.")}
            </p>
            {/* /dashboard, not "/". The root is the marketing page now and has
                no sign-in form on it, so somebody whose recovery link had
                expired was being sent to an advertisement instead of a way
                back in. */}
            <button className="btn ghost" onClick={() => router.push("/dashboard")}>
              {session ? "Back to the journal" : "Back to sign in"}
            </button>
          </>
        ) : (
          <>
            {/* This screen is reached from an email link by someone who has
                already forgotten one password, often on a phone. Being able
                to see what is being typed matters more here than anywhere. */}
            <label className="f"><span>New password</span>
              <div className="pw-wrap">
                <input className="in" type={pwType(reveal)} value={password} autoFocus
                       autoComplete="new-password"
                       onChange={(e) => setPassword(e.target.value)}
                       onKeyDown={(e) => e.key === "Enter" && submit()} />
                <RevealToggle on={reveal} onToggle={() => setReveal((v) => !v)} />
              </div></label>

            <label className="f"><span>Again</span>
              <input className="in" type={pwType(reveal)} value={confirm}
                     autoComplete="new-password"
                     onChange={(e) => setConfirm(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && submit()} /></label>

            {tooShort && <div className="hint">At least {MIN_PASSWORD} characters.</div>}
            {mismatch && <div className="hint">Those two don&apos;t match.</div>}
            {err && <div className="warn">{err}</div>}

            <button className="btn" onClick={submit} disabled={!valid || busy}>
              {busy ? "Saving…" : "Save new password"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
