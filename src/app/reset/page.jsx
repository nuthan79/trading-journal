"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, updatePassword } from "@/lib/db";

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

const MIN = 8;

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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    // supabase-js consumes the fragment asynchronously, so the first read can
    // land before it has finished. The listener catches the recovery event;
    // getSession covers a page that was already signed in.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(s);
      setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });

    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.get("type") === "recovery") setRecovery(true);
    if (hash.get("error")) {
      setErr(hash.get("error_description") || "That link didn't work — ask for a new one.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    return () => sub.subscription.unsubscribe();
  }, []);

  const tooShort = password.length > 0 && password.length < MIN;
  const mismatch = confirm.length > 0 && password !== confirm;
  const valid = password.length >= MIN && password === confirm;

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
            <button className="btn" onClick={() => router.push("/")}>Go to the journal</button>
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
            <button className="btn ghost" onClick={() => router.push("/")}>
              {session ? "Back to the journal" : "Back to sign in"}
            </button>
          </>
        ) : (
          <>
            <label className="f"><span>New password</span>
              <input className="in" type="password" value={password} autoFocus
                     autoComplete="new-password"
                     onChange={(e) => setPassword(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && submit()} /></label>

            <label className="f"><span>Again</span>
              <input className="in" type="password" value={confirm}
                     autoComplete="new-password"
                     onChange={(e) => setConfirm(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && submit()} /></label>

            {tooShort && <div className="hint">At least {MIN} characters.</div>}
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
