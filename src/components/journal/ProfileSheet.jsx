"use client";

import { useEffect, useRef, useState } from "react";
import { X, LogOut, Camera, Trash2 } from "lucide-react";
import {
  supabase, reauthenticate, updatePassword, sendPasswordReset, signOut,
  uploadAvatar, removeAvatar,
} from "@/lib/db";
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

const MAX_UPLOAD = 8 * 1024 * 1024;

/** The picture, and the two things you can do to it. */
function AvatarPicker({ profile, avatar, onChanged }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const initials = ((profile?.journal_name || "?").trim().slice(0, 2)).toUpperCase();

  const choose = async (e) => {
    const file = e.target.files?.[0];
    // Cleared straight away so picking the same file twice still fires change.
    e.target.value = "";
    if (!file) return;

    if (!/^image\//.test(file.type)) { setErr("That needs to be an image."); return; }
    if (file.size > MAX_UPLOAD) { setErr("That image is over 8 MB — pick a smaller one."); return; }

    setBusy(true); setErr("");
    try {
      onChanged(await uploadAvatar(file));
    } catch (e2) {
      setErr(e2.message?.includes("Bucket not found")
        ? "Migration 010 hasn't been run — supabase/010_avatars.sql creates the bucket this needs."
        : e2.message || "Could not save that picture.");
    }
    setBusy(false);
  };

  const clear = async () => {
    setBusy(true); setErr("");
    try {
      onChanged(await removeAvatar());
    } catch (e2) {
      setErr(e2.message || "Could not remove it.");
    }
    setBusy(false);
  };

  return (
    <div className="pf-av">
      <button className="pf-av-img" onClick={() => fileRef.current?.click()} disabled={busy}
              aria-label={avatar ? "Change picture" : "Add a picture"}>
        {avatar ? <img src={avatar} alt="" /> : <span>{initials}</span>}
        <span className="pf-av-over"><Camera size={15} /></span>
      </button>

      <div className="pf-av-side">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn ghost sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? "Working…" : avatar ? "Change picture" : "Add a picture"}
          </button>
          {avatar && (
            <button className="btn ghost sm danger" onClick={clear} disabled={busy}>
              <Trash2 size={13} />Remove
            </button>
          )}
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          Cropped square and shrunk to 256px in the browser, so a photo off a phone
          doesn&apos;t get uploaded at full size.
        </div>
        {err && <div className="warn" style={{ marginTop: 8 }}>{err}</div>}
      </div>

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={choose} />
    </div>
  );
}

export default function ProfileSheet({ profile, avatar, counts, onClose, focusPassword, onProfileChange }) {
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
          <AvatarPicker profile={profile} avatar={avatar} onChanged={onProfileChange} />

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
        {/* Global: AvatarPicker is its own component function, and a scoped
            block only reaches elements rendered by the component that declares
            it. Scoped, every one of these silently did nothing. */}
        <style jsx global>{`
          .pf-av { display: flex; align-items: flex-start; gap: 16px; }
          .pf-av-side { min-width: 0; flex: 1 1 auto; }
          .pf-av-img {
            position: relative; width: 72px; height: 72px; flex: none;
            border-radius: 50%; border: 1px solid var(--rule);
            background: var(--card); cursor: pointer; padding: 0;
            display: flex; align-items: center; justify-content: center;
            overflow: hidden;
          }
          .pf-av-img span:first-child {
            font-family: 'Archivo', sans-serif; font-size: 22px;
            font-weight: 700; color: var(--ink3);
          }
          .pf-av-img :global(img) {
            width: 100%; height: 100%; object-fit: cover; display: block;
          }
          /* Only on hover: a camera badge sitting there permanently would
             read as part of the picture rather than a thing to press. */
          .pf-av-over {
            position: absolute; inset: 0; display: flex;
            align-items: center; justify-content: center;
            background: rgba(19, 28, 26, 0.5); color: #fff;
            opacity: 0; transition: opacity 0.15s ease;
          }
          .pf-av-img:hover .pf-av-over { opacity: 1; }
          .pf-av-img:disabled { opacity: 0.6; cursor: default; }
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
