"use client";

import { useEffect, useState } from "react";
import { X, LogOut, Trash2, Crown, Download } from "lucide-react";
import {
  supabase, reauthenticate, updatePassword, sendPasswordReset, signOut,
  exportEverything, signOutEverywhere, deleteMyAccount,
  saveNominee, setAnalyticsOptOut, saveJournalName,
} from "@/lib/db";
import { rupee } from "@/lib/format";
import { MIN_PASSWORD } from "@/lib/password";
import { RevealToggle, pwType } from "@/components/PasswordEye";
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
  // One switch for all three boxes on this form — see PasswordEye.
  const [reveal, setReveal] = useState(false);
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
      {/* The eye goes on the current-password box too, not only the new ones.
          Getting the existing password wrong is the commonest way this form
          fails, and it is the one field the person cannot simply retype from
          memory if they are unsure what they typed. */}
      <label className="f"><span>Current password</span>
        <div className="pw-wrap">
          <input className="in" type={pwType(reveal)} value={current}
                 autoComplete="current-password" autoFocus={autoFocus}
                 onChange={(e) => { setCurrent(e.target.value); setDone(false); }} />
          <RevealToggle on={reveal} onToggle={() => setReveal((v) => !v)} />
        </div></label>
      <label className="f"><span>New password</span>
        <input className="in" type={pwType(reveal)} value={next} autoComplete="new-password"
               onChange={(e) => { setNext(e.target.value); setDone(false); }} /></label>
      <label className="f"><span>Again</span>
        <input className="in" type={pwType(reveal)} value={confirm} autoComplete="new-password"
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
/**
 * Who may act for you if you cannot.
 *
 * Section 14 of the DPDP Act, and something the privacy policy has told
 * people they can do since the day it shipped — with nowhere in the app to do
 * it. A published right nobody can exercise is a representation being failed,
 * which is worse than a gap.
 *
 * Two fields and no more. A nominee is a third party who has agreed to
 * nothing here, so the app asks for the least that could identify them:
 * whoever is settling an estate will have the relationship and the documents,
 * and none of that needs to sit in this database in the meantime.
 */
/**
 * The journal's name, edited where it is displayed.
 *
 * It has always been shown as this sheet's heading and only editable over in
 * Setup, which is where account size and brokerage rates live — the settings
 * that decide how the journal COUNTS. A name counts nothing. Somebody wanting
 * to rename it looks at the name, and the name was the one thing here that
 * could not be touched.
 *
 * Inline rather than a section of its own: one field does not deserve a
 * heading, and putting it beside the thing it labels is what makes it
 * findable. Setup keeps its copy — this is a second door, not a move, so
 * nobody's habit breaks.
 */
function JournalName({ profile, onSaved }) {
  const current = profile?.journal_name || "Breakout Ledger";
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Reset when the profile changes underneath — a rename in Setup while this
  // sheet is open would otherwise leave the box holding the old name.
  useEffect(() => { setValue(current); }, [current]);

  const save = async () => {
    if (busy) return;
    const next = value.trim();
    // Nothing typed, or nothing changed. Closing quietly is the honest answer
    // to "save" when there is nothing to save.
    if (!next || next === current) { setEditing(false); setValue(current); return; }
    setBusy(true); setErr("");
    try {
      onSaved?.(await saveJournalName(next));
      setEditing(false);
    } catch (e) {
      setErr(e.message || "Could not rename that.");
    }
    setBusy(false);
  };

  if (!editing) {
    return (
      <div className="pf-name">
        <div className="disp" style={{ fontSize: 17, marginTop: 2 }}>{current}</div>
        <button className="lnk pf-rename" type="button" onClick={() => setEditing(true)}>
          Rename
        </button>
      </div>
    );
  }

  return (
    <div className="pf-name">
      <input
        className="in"
        value={value}
        autoFocus
        maxLength={60}
        aria-label="Journal name"
        onChange={(e) => setValue(e.target.value)}
        // Enter saves and Escape abandons, because this is one field and
        // reaching for a button to commit a single word is the slow way.
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") { setEditing(false); setValue(current); }
        }}
        style={{ maxWidth: 260 }}
      />
      <button className="btn sm" type="button" onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
      <button className="btn ghost sm" type="button"
              onClick={() => { setEditing(false); setValue(current); setErr(""); }}>
        Cancel
      </button>
      {err && <div className="warn" style={{ width: "100%", marginTop: 8 }}>{err}</div>}
    </div>
  );
}

function Nominee({ profile, onSaved }) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    setName(profile?.nominee_name || "");
    setContact(profile?.nominee_contact || "");
  }, [profile?.nominee_name, profile?.nominee_contact]);

  const has = !!profile?.nominee_name;
  const changed = (name.trim() !== (profile?.nominee_name || "")) ||
                  (contact.trim() !== (profile?.nominee_contact || ""));

  const save = async () => {
    if (busy) return;
    setBusy(true); setErr(""); setDone("");
    try {
      const { cleared, profile: updated } = await saveNominee({ name, contact });
      setDone(cleared ? "Nomination removed." : "Nominee saved.");
      // The updated row, not nothing — onSaved is setProfile.
      onSaved?.(updated);
      if (cleared) setOpen(false);
    } catch (e) {
      setErr(e.message || "Could not save that.");
    }
    setBusy(false);
  };

  return (
    <div style={{ marginTop: 18 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>Nominee</div>
      <p style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.6, margin: "0 0 10px" }}>
        Someone who may ask for your journal, or ask for it to be deleted, if you die
        or become unable to. Optional, and changeable whenever you like. We only store
        a name and one way to reach them.
      </p>

      {has && !open ? (
        <div className="pf-card">
          <div className="pf-row"><span>Nominated</span><b>{profile.nominee_name}</b></div>
          {profile.nominee_contact && (
            <div className="pf-row"><span>Contact</span><b className="mono">{profile.nominee_contact}</b></div>
          )}
          {/* Shown because a nomination made years ago is worth re-reading,
              and only the date tells you it is old. */}
          {profile.nominee_set_at && (
            <div className="pf-row">
              <span>Recorded</span><b className="mono">{fmtDate(new Date(profile.nominee_set_at))}</b>
            </div>
          )}
          <div style={{ padding: "10px 0 0" }}>
            <button className="btn ghost sm" onClick={() => setOpen(true)}>Change or remove</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9, maxWidth: 330 }}>
          <label className="f"><span>Their name</span>
            <input className="in" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="f"><span>Email or phone</span>
            <input className="in" value={contact} onChange={(e) => setContact(e.target.value)} /></label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn ghost sm" onClick={save} disabled={busy || !changed}>
              {busy ? "Saving…" : name.trim() ? "Save nominee" : "Remove nomination"}
            </button>
            {has && (
              <button className="btn ghost sm" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {err && <div className="warn" style={{ marginTop: 8 }}>{err}</div>}
      {done && <div className="hint" style={{ color: "var(--long)", marginTop: 8 }}>{done}</div>}
    </div>
  );
}

/**
 * Declining the two things collected about you rather than for you.
 *
 * Product events and crash reports are not needed to run a journal — the app
 * behaves identically without them. They exist because they are useful to
 * whoever is building it, which is exactly the processing somebody should be
 * able to refuse while keeping the service.
 *
 * Until now the only way to stop them was deleting the account, which is not
 * withdrawal but abandonment.
 *
 * Turning it off also erases what was already collected, and says how much.
 * A switch that stops future collection while keeping the existing pile
 * answers a different question from the one being asked.
 */
function AnalyticsChoice({ profile, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const off = !!profile?.analytics_opt_out;

  const toggle = async () => {
    if (busy) return;
    setBusy(true); setErr(""); setDone("");
    try {
      const { erased, remaining = [], profile: updated } = await setAnalyticsOptOut(!off);
      onSaved?.(updated);
      if (remaining.length) {
        /**
         * Said as a failure, not folded into the success line.
         *
         * Collection has stopped — that part worked — but rows the person
         * asked to be erased are still there, and quietly reporting the
         * erasure that did happen would leave them believing the rest went
         * too. This is what the screen said last time, incorrectly, when a
         * missing RLS policy meant nothing was deleted at all.
         */
        const left = remaining.reduce((a, r) => a + r.rows, 0);
        setErr(
          `Recording is off, but ${left} record${left === 1 ? "" : "s"} could not be ` +
          `deleted. Migration 035 may not have been run. Nothing new is being ` +
          `collected — try again, and tell us if it keeps failing.`
        );
      } else {
        setDone(
          !off
            ? erased
              ? `Turned off, and ${erased} record${erased === 1 ? "" : "s"} already collected were deleted.`
              : "Turned off. There was nothing collected to delete."
            : "Turned back on."
        );
      }
    } catch (e) {
      setErr(e.message || "Could not change that.");
    }
    setBusy(false);
  };

  return (
    <div style={{ marginTop: 18 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>Usage and crash records</div>
      <p style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.6, margin: "0 0 10px" }}>
        Which screens get used, and what breaks. Never a symbol, a price or anything
        from your journal. It only helps decide what to build next, so you can turn it
        off and the app works exactly the same.
      </p>
      <div className="pf-card">
        <div className="pf-row">
          <span>Recording</span>
          <b className={off ? "" : "pf-ok"}>{off ? "Off" : "On"}</b>
        </div>
        <div style={{ padding: "10px 0 0" }}>
          <button className="btn ghost sm" onClick={toggle} disabled={busy}>
            {busy ? "Saving…" : off ? "Turn it back on" : "Turn it off and delete what's collected"}
          </button>
        </div>
      </div>
      {err && <div className="warn" style={{ marginTop: 8 }}>{err}</div>}
      {done && <div className="hint" style={{ color: "var(--long)", marginTop: 8 }}>{done}</div>}
    </div>
  );
}

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
            {onlyPassword ? (
              <div className="disp" style={{ fontSize: 17, marginTop: 2 }}>
                Change your password
              </div>
            ) : (
              <JournalName profile={profile} onSaved={onProfileChange} />
            )}
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

              {/* Between exporting and deleting on purpose: these are the
                  middle ground — things you can change your mind about
                  without leaving. */}
              <Nominee profile={profile} onSaved={onProfileChange} />
              <AnalyticsChoice profile={profile} onSaved={onProfileChange} />

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
          /* JournalName is its own component function, so these have to be
             global for the same reason every rule below is — see the note
             above. */
          .pf-name {
            display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
          }
          /* Quiet until wanted. The name is what is being read here; the way
             to change it should be available without competing with it. */
          .pf-rename {
            font-size: 11.5px; color: var(--ink3);
          }
          .pf-name:hover .pf-rename { color: var(--ink); }
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
