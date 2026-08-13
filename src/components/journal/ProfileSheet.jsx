"use client";

import { useEffect, useState } from "react";
import { X, LogOut, Trash2, Crown, Download } from "lucide-react";
import {
  supabase, reauthenticate, updatePassword, sendPasswordReset, signOut,
  exportEverything, signOutEverywhere, deleteMyAccount,
} from "@/lib/db";
import { rupee } from "@/lib/format";
import { MIN_PASSWORD } from "@/lib/password";
import AvatarChoice from "./AvatarChoice";

/**
 * The account, as opposed to the journal's settings.
 *
 * Who you are signed in as, and the password that gets you back. Setup is for
 * how the journal counts — account size, risk, broker charges — and mixing the
 * two put a password field in the middle of a form that autosaves every
 * keystroke to localStorage.
 */


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


/**
 * What this account is entitled to, said honestly.
 *
 * Reads `profiles.plan` rather than asking a payment provider, which is the
 * whole point of 031: an app that gates on "is there an active subscription"
 * cannot give anybody anything for nothing without faking a payment. Here a
 * complimentary account is simply a value, and it says so — "Complimentary"
 * rather than a "Paid" that nobody paid, because someone you gave the app to
 * should be able to see that is what happened.
 */
function Subscription({ profile }) {
  const [asked, setAsked] = useState(false);

  const plan = profile?.plan || "free";
  const until = profile?.plan_until ? new Date(profile.plan_until) : null;
  const lapsed = !!until && until.getTime() < Date.now();

  const label = plan === "comp" ? "Complimentary" : plan === "paid" ? "Paid" : "Free";
  // Nothing is charged yet, so nothing can have lapsed in a way that matters.
  const status = lapsed ? "Expired" : "Active";

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Subscription</div>
      <div className="pf-card">
        <div className="pf-row"><span>Plan</span><b className="mono">{label}</b></div>
        <div className="pf-row">
          <span>Status</span>
          <b className={`mono ${lapsed ? "" : "pf-ok"}`}>{status}</b>
        </div>
        <div className="pf-row">
          <span>{plan === "comp" ? "Until" : "Renews"}</span>
          <b className="mono">{until ? fmtDate(until) : "—"}</b>
        </div>
      </div>

      {plan === "comp" ? (
        <div className="pf-plan">
          <Crown size={14} />
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <b>This one is on us</b>
            <div className="pf-plan-sub">
              {until
                ? `Complimentary access until ${fmtDate(until)}. Nothing to pay, and no card is held.`
                : "Complimentary access, with no end date. Nothing to pay, and no card is held."}
            </div>
          </div>
        </div>
      ) : (
        <div className="pf-plan">
          <Crown size={14} />
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <b>Free while this is being built</b>
            <div className="pf-plan-sub">
              {asked
                ? "Billing isn't live yet. When it is, renewal happens here and " +
                  "nothing you've logged is ever locked behind it — an expired " +
                  "plan still reads and exports."
                : "Nothing to pay for yet."}
            </div>
          </div>
          <button className="btn ghost sm" onClick={() => setAsked(true)} disabled={asked}>
            Extend subscription
          </button>
        </div>
      )}
    </div>
  );
}

const fmtDate = (d) => {
  const x = new Date(d);
  return isFinite(x)
    ? x.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";
};

/**
 * The picture as it currently stands, beside the ways to change it.
 *
 * The uploading, the presets and the clearing all moved into AvatarChoice when
 * first run started offering the same thing — this keeps only the large
 * preview, because a face is worth seeing at a size the 42px chooser can't
 * give it. It is display, not a control: the actions are all one component
 * along, and a preview that also opened a file dialog gave the same job two
 * places to be done from.
 */
function AvatarPicker({ profile, avatar, onChanged }) {
  const initials = ((profile?.journal_name || "?").trim().slice(0, 2)).toUpperCase();

  return (
    <div className="pf-av">
      <div className="pf-av-img" aria-hidden="true">
        {avatar ? <img src={avatar} alt="" /> : <span>{initials}</span>}
      </div>

      {/* The shared chooser — the same ten faces offered during first run, so
          changing your mind later is the same decision in the same shape
          rather than a different screen with different options. It owns the
          upload and the clearing too, which is why nothing but the preview
          above is left here. */}
      <div className="pf-av-side">
        <AvatarChoice profile={profile} avatar={avatar} onChanged={onChanged} />
      </div>
    </div>
  );
}

/**
 * Take everything and go.
 *
 * Built in the browser rather than fetched from a route, because the data is
 * already reachable from here under the same row-level security that guards
 * every other read — a server endpoint would be a second place to get that
 * wrong, for a file the client can assemble itself.
 *
 * The filename carries the date. Somebody who exports twice a year wants to
 * know which one they are looking at without opening it.
 */
function ExportEverything() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const run = async () => {
    setBusy(true); setErr("");
    try {
      const data = await exportEverything();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `journal-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on the next tick rather than immediately: Safari has not
      // always finished reading the blob by the time click() returns.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setErr(e.message || "Could not build the export.");
    }
    setBusy(false);
  };

  return (
    <>
      <button className="btn ghost sm" onClick={run} disabled={busy}>
        <Download size={13} />{busy ? "Building…" : "Export everything"}
      </button>
      {err && <div className="warn" style={{ marginTop: 8 }}>{err}</div>}
    </>
  );
}

/**
 * Sign out of the other browsers too.
 *
 * Separate from Sign out rather than replacing it, because they answer
 * different questions. Sign out is "I'm done here". This one is "I left myself
 * signed in somewhere I shouldn't have" — and the person asking it is usually
 * not at that machine, which is the whole point.
 *
 * It says "shortly" rather than "now" on purpose. Supabase revokes the refresh
 * tokens, so the other sessions die when their access token next expires
 * instead of the instant this is pressed, and an "everywhere" that quietly
 * takes an hour is worse than one that says so.
 */
function SignOutEverywhere() {
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (!window.confirm(
      "Sign out of every browser and device?\n\n" +
      "You'll be signed out here immediately. Other sessions stop working shortly after."
    )) return;
    setBusy(true);
    try { await signOutEverywhere(); } catch { /* the local session goes regardless */ }
  };

  return (
    <button className="btn ghost sm" onClick={go} disabled={busy}>
      <LogOut size={13} />{busy ? "Signing out…" : "Sign out everywhere"}
    </button>
  );
}

/**
 * Closing the account.
 *
 * THE GATE IS TYPING THE EMAIL, not a checkbox and not a second "are you
 * sure". Both of those are clicked through by muscle memory; copying your own
 * address back is the smallest thing that cannot be done by accident, and it
 * is the confirmation people already recognise from every other service that
 * deletes things properly.
 *
 * The export is offered in the same breath rather than mentioned afterwards.
 * Someone leaving still wants their record of eleven months of trading, and
 * the moment they find out otherwise is the moment it is gone.
 */
function DangerZone({ email }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const matches = typed.trim().toLowerCase() === (email || "").toLowerCase() && !!email;

  const go = async () => {
    if (!matches || busy) return;
    setBusy(true); setErr("");
    try {
      await deleteMyAccount();
      // Straight out. The layout gates on the session, so clearing it is what
      // returns the browser to the landing page — and there is no longer an
      // account for any other screen to describe.
      window.location.href = "/";
    } catch (e) {
      setErr(e.message || "Could not delete the account.");
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="btn ghost sm danger" onClick={() => setOpen(true)}>
        <Trash2 size={13} />Delete my account
      </button>
    );
  }

  return (
    <div style={{ border: "1px solid var(--short)", borderRadius: 2, padding: 14, background: "#FBF0ED" }}>
      <div className="disp" style={{ fontSize: 14, color: "#7A2E1C" }}>
        This deletes everything, permanently.
      </div>
      <p style={{ fontSize: 12.5, lineHeight: 1.65, color: "#7A2E1C", margin: "8px 0 0" }}>
        Every trade, sell, diary entry, chart, capital flow and setting goes, and so
        does the account itself. It cannot be undone and we cannot get it back for
        you. <b>Export first if you might want any of it.</b>
      </p>

      <label className="f" style={{ display: "block", marginTop: 12 }}>
        <span>Type <b>{email}</b> to confirm</span>
        <input className="in" value={typed} autoComplete="off" spellCheck={false}
               onChange={(e) => setTyped(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && go()} />
      </label>

      {err && <div className="warn" style={{ marginTop: 10 }}>{err}</div>}

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <button className="btn ghost sm" onClick={() => { setOpen(false); setTyped(""); setErr(""); }}>
          Keep my account
        </button>
        <button className="btn sm" onClick={go} disabled={!matches || busy}
                style={matches ? { background: "var(--short)", borderColor: "var(--short)" } : undefined}>
          {busy ? "Deleting…" : "Delete permanently"}
        </button>
      </div>
    </div>
  );
}

export default function ProfileSheet({ profile, avatar, counts, onClose, onlyPassword, onProfileChange }) {
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
            <div className="eyebrow">{onlyPassword ? "Password" : "My profile"}</div>
            <div className="disp" style={{ fontSize: 17, marginTop: 2 }}>
              {onlyPassword ? "Change your password" : profile?.journal_name || "Breakout Ledger"}
            </div>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>

        {/* Two entries in the menu, so two screens. Showing the same sheet for
            both left the password form sitting under the profile and made the
            second entry look like it had done nothing. */}
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
          {onlyPassword ? (
            <>
              <div className="hint" style={{ marginTop: 0 }}>
                The current one is asked for because a session on its own would let
                anyone who found this screen open lock you out of your own journal.
              </div>
              <PasswordChange autoFocus />
            </>
          ) : (
            <>
              <AvatarPicker profile={profile} avatar={avatar} onChanged={onProfileChange} />

              <div className="pf-card">
                {row("Signed in as", email || "—")}
                {row("Member since", joined ? fmtDate(joined) : "—")}
                {row("Account size", rupee(profile?.account_size))}
                {row("Default risk", `${profile?.default_risk_pct ?? "—"}%`)}
                {row("Trades logged", `${counts?.total ?? 0}`)}
              </div>

              <Subscription profile={profile} />
            </>
          )}

          {!onlyPassword && (
            <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 16, marginTop: 4 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Your data</div>
              <p style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.6, margin: "0 0 11px" }}>
                Every trade, sell, diary entry and capital flow in one file, with your
                settings and the events recorded about you. Nothing is held back and
                nothing is summarised.
              </p>
              <ExportEverything />

              <div style={{ marginTop: 18 }}>
                <DangerZone email={email} />
              </div>
            </div>
          )}

          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 16,
                        display: "flex", justifyContent: "space-between",
                        alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn ghost sm" onClick={() => signOut()}>
                <LogOut size={13} />Sign out
              </button>
              {!onlyPassword && <SignOutEverywhere />}
            </div>
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
          /* A preview now, not a button — the hover camera badge and the
             disabled state went with the click handler. */
          .pf-av-img {
            width: 72px; height: 72px; flex: none;
            border-radius: 50%; border: 1px solid var(--rule);
            background: var(--card);
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
          .pf-ok { color: var(--long); }
          .pf-plan {
            display: flex; align-items: flex-start; gap: 10px; margin-top: 10px;
            padding: 11px 13px; border: 1px solid var(--brass); border-radius: 3px;
            background: #FDFAF3; font-size: 12px; color: #6B4E13;
          }
          .pf-plan > svg { color: var(--brass); flex: none; margin-top: 1px; }
          .pf-plan-sub { color: var(--ink2); margin-top: 3px; line-height: 1.55; }
          .pf-plan button { flex: none; align-self: center; }
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
