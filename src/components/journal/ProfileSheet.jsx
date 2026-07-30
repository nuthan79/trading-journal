"use client";

import { useEffect, useState } from "react";
import { X, LogOut } from "lucide-react";
import { supabase, reauthenticate, updatePassword, sendPasswordReset, signOut } from "@/lib/db";
import { rupee } from "@/lib/format";

/**
 * The account, as opposed to the journal's settings.
 *
 * Who you are signed in as, and the password that gets you back. Setup is for
 * how the journal counts — account size, risk, broker charges — and mixing the
 * two put a password field in the middle of a form that autosaves every
 * keystroke to localStorage.
 */

const MIN_PASSWORD = 8;

/**
 * Change the password without leaving the journal.
 *
 * Nothing here is ever drafted to localStorage — unlike the setup sheet, which
 * autosaves as you type. That is why it lives on its own rather than as one
 * more section over there.
 *
 * An account that has only ever used magic links has no current password to
 * check, so the failure is routed to email recovery rather than presented as
 * a wrong answer.
 */
function PasswordChange({ autoFocus }) {
  // Read from the session rather than passed in: it's the address the password
  // belongs to, and re-authenticating needs the one Supabase actually has, not
  // whatever a parent happened to be holding.
  const [email, setEmail] = useState("");
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data?.user?.email || ""));
  }, []);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && next !== confirm;
  const valid = email && current && next.length >= MIN_PASSWORD && next === confirm;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr(""); setDone(false);

    if (!(await reauthenticate(email, current))) {
      setErr("That current password isn't right. If you've only ever signed in with an " +
             "email link, use the reset link below to set one.");
      setBusy(false);
      return;
    }

    const { error } = await updatePassword(next);
    if (error) setErr(error.message);
    else {
      setDone(true);
      setCurrent(""); setNext(""); setConfirm("");
    }
    setBusy(false);
  };

  const emailInstead = async () => {
    setBusy(true); setErr("");
    const { error } = await sendPasswordReset(email, `${window.location.origin}/reset`);
    setErr(error ? error.message : "");
    if (!error) setDone(true);
    setBusy(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 320 }}>
      <label className="f"><span>Current password</span>
        <input className="in" type="password" value={current} autoComplete="current-password"
               autoFocus={autoFocus}
               onChange={(e) => { setCurrent(e.target.value); setDone(false); }} /></label>
      <label className="f"><span>New password</span>
        <input className="in" type="password" value={next} autoComplete="new-password"
               onChange={(e) => { setNext(e.target.value); setDone(false); }} /></label>
      <label className="f"><span>Again</span>
        <input className="in" type="password" value={confirm} autoComplete="new-password"
               onChange={(e) => { setConfirm(e.target.value); setDone(false); }}
               onKeyDown={(e) => e.key === "Enter" && submit()} /></label>

      {tooShort && <div className="hint">At least {MIN_PASSWORD} characters.</div>}
      {mismatch && <div className="hint">Those two don&apos;t match.</div>}
      {err && <div className="warn">{err}</div>}
      {done && !err && <div className="hint" style={{ color: "var(--long)" }}>Password updated.</div>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn ghost sm" onClick={submit} disabled={!valid || busy}>
          {busy ? "Saving…" : "Change password"}
        </button>
        <button type="button" className="lnk" onClick={emailInstead} disabled={busy || !email}>
          Email me a reset link instead
        </button>
      </div>
    </div>
  );
}


const fmtDate = (d) => {
  const x = new Date(d);
  return isFinite(x)
    ? x.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";
};

export default function ProfileSheet({ profile, counts, onClose, focusPassword }) {
  const [email, setEmail] = useState("");
  const [joined, setJoined] = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data?.user?.email || "");
      setJoined(data?.user?.created_at || null);
    });
  }, []);

  useEffect(() => {
    const key = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  const row = (label, value) => (
    <div className="pf-row">
      <span>{label}</span>
      <b className="mono">{value}</b>
    </div>
  );

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" style={{ maxWidth: 460 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheethead">
          <div>
            <div className="eyebrow">Account</div>
            <div className="disp" style={{ fontSize: 17, marginTop: 2 }}>
              {profile?.journal_name || "Breakout Ledger"}
            </div>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="pf-card">
            {row("Signed in as", email || "—")}
            {row("Member since", joined ? fmtDate(joined) : "—")}
            {row("Account size", rupee(profile?.account_size))}
            {row("Default risk", `${profile?.default_risk_pct ?? "—"}%`)}
            {row("Trades logged", `${counts?.total ?? 0}`)}
          </div>

          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Password</div>
            <div className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
              The current one is asked for because a session on its own would let
              anyone who found this screen open lock you out of your own journal.
            </div>
            <PasswordChange autoFocus={focusPassword} />
          </div>

          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 16,
                        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button className="btn ghost sm" onClick={() => signOut()}>
              <LogOut size={13} />Sign out
            </button>
            <button className="btn ghost" onClick={onClose}>Close</button>
          </div>
        </div>

        <style jsx>{`
          .pf-card {
            border: 1px solid var(--rule); border-radius: 3px;
            background: var(--card); overflow: hidden;
          }
        `}</style>
        <style jsx global>{`
          .pf-row {
            display: flex; justify-content: space-between; align-items: baseline;
            gap: 14px; padding: 10px 14px; font-size: 12.5px; color: var(--ink2);
            border-bottom: 1px solid var(--rule);
          }
          .pf-row:last-child { border-bottom: 0; }
          .pf-row b { font-weight: 500; color: var(--ink); }
        `}</style>
      </div>
    </div>
  );
}
