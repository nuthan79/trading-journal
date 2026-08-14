"use client";

import { useEffect, useState } from "react";
import { RevealToggle, pwType } from "@/components/PasswordEye";
import { passwordScore, PASSWORD_LABELS, MIN_PASSWORD } from "@/lib/password";

const GOOGLE_ON = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "1";

/**
 * Signing in, and — new — signing up.
 *
 * Lifted out of the app layout when the marketing page needed the same form in
 * its hero. Every piece of auth state still lives in the layout and this owns
 * nothing, because the layout is what holds the Supabase session.
 *
 * TWO WAYS IN, ORDERED BY HOW LIKELY THEY ARE TO WORK. Google first: it sends
 * no email, so nothing about it can be rate-limited, land in spam, or be typed
 * wrong. Then a password, which at least fails immediately and out loud.
 *
 * THE MAGIC LINK IS GONE. It was here because it was once the only way to
 * create an account at all — signInWithPassword only ever admits a user who
 * already exists. Now that sign-up and Google both work, it is a third route
 * to what two already do, and the only one whose failure is silent: a link
 * that lands in spam looks exactly like an app that ignored you. Anyone who
 * signed up by link and never set a password gets in through "Forgot your
 * password?", which issues one.
 *
 * "Check your email" is a state of this form rather than a separate screen, so
 * the way back to the form can reach the same state that got you here.
 */
export default function SignInCard({
  view = "signin", switchAuthView,
  linkSent, sentKind, email, setEmail, password, setPassword,
  authErr, busy,
  signInPassword, signUpPassword, signInGoogle,
  sendReset, resetToEmailForm,
}) {
  if (linkSent) {
    return (
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div className="disp" style={{ fontSize: 15 }}>Check your email</div>
          <p style={{ fontSize: 13, color: "var(--ink2)", lineHeight: 1.6, margin: "6px 0 0" }}>
            {sentKind === "reset" ? (
              <>
                If <b>{email}</b> has an account, a link to set a new password is on its
                way. Open it from any browser or mail app. It works once and expires
                shortly, so ask again if it&apos;s been a while.
              </>
            ) : (
              <>
                Your account is made. Confirm <b>{email}</b> using the link we just sent,
                and you&apos;re in. Open it from any browser or mail app.
              </>
            )}
          </p>
        </div>

        {authErr && <div className="warn">{authErr}</div>}

        <button className="btn ghost" onClick={resetToEmailForm}>
          Use a different email
        </button>
      </div>
    );
  }

  const signup = view === "signup";

  /**
   * Local, because neither ever leaves this card. The repeat is a check on
   * what was typed, not a second value to store, and the agreement is a gate
   * rather than something the sign-up call takes. Keeping them out of the
   * layout keeps the auth state to the things auth actually needs.
   */
  const [confirm, setConfirm] = useState("");
  const [agreed, setAgreed] = useState(false);
  /**
   * One switch for both password fields, not one each.
   *
   * The reason anybody reveals a password is to find the typo they just made,
   * and on a sign-up form the typo is as likely to be in the repeat box as in
   * the first. Two separate eyes would mean noticing that, then hunting for
   * the second control. Nothing is revealed that the person at the keyboard
   * did not just type themselves.
   */
  const [reveal, setReveal] = useState(false);
  useEffect(() => { setConfirm(""); setAgreed(false); }, [view]);

  const shortPassword = password.length > 0 && password.length < MIN_PASSWORD;
  const score = passwordScore(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const matched = confirm.length > 0 && confirm === password;

  const canSubmit = signup
    ? !!email && password.length >= MIN_PASSWORD && confirm === password && agreed
    : !!email && !!password;

  const submit = () => {
    if (!canSubmit || busy) return;
    if (signup) signUpPassword();
    else signInPassword();
  };

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {GOOGLE_ON && (
        <>
          <button className="btn ghost" onClick={signInGoogle} disabled={busy}
                  style={{ justifyContent: "center" }}>
            <GoogleMark />
            Continue with Google
          </button>
          <div className="sic-or"><span>or</span></div>
        </>
      )}

      <label className="f"><span>Email</span>
        <input className="in" type="email" value={email} autoComplete="username"
               onChange={(e) => setEmail(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && submit()} /></label>

      <label className="f"><span>Password</span>
        <div className="pw-wrap">
          <input className="in" type={pwType(reveal)} value={password}
                 autoComplete={signup ? "new-password" : "current-password"}
                 onChange={(e) => setPassword(e.target.value)}
                 onKeyDown={(e) => e.key === "Enter" && submit()} />
          <RevealToggle on={reveal} onToggle={() => setReveal((v) => !v)} />
        </div>
        {signup && (
          <>
            {/* Five segments, filled to the score. Shown only once there is
                something to judge — an empty bar beside an empty field reads
                as a failure before anyone has typed. */}
            {password.length > 0 && (
              <div className="sic-meter" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <i key={i} data-on={i <= score ? 1 : 0} data-s={score} />
                ))}
                <span data-s={score}>{PASSWORD_LABELS[score]}</span>
              </div>
            )}
            <div className="hint" style={shortPassword ? { color: "var(--short)" } : undefined}>
              At least {MIN_PASSWORD} characters. Pick something you don&apos;t use elsewhere.
            </div>
          </>
        )}
      </label>

      {signup && (
        <label className="f"><span>Repeat password</span>
          {/* Follows the same switch. No second eye — see `reveal` above. */}
          <input className="in" type={pwType(reveal)} value={confirm}
                 autoComplete="new-password"
                 onChange={(e) => setConfirm(e.target.value)}
                 onKeyDown={(e) => e.key === "Enter" && submit()} />
          {mismatch && <div className="hint" style={{ color: "var(--short)" }}>Those two don&apos;t match.</div>}
          {matched && <div className="hint" style={{ color: "var(--long)" }}>Passwords match.</div>}
        </label>
      )}

      {/* Consent recorded at the moment it is given, rather than a line of
          small print claiming that using the site implies it. The DPDP Act
          wants consent to be a positive act; an unticked box is one. */}
      {signup && (
        <label className="sic-agree">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>
            I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Use</a>{" "}
            and acknowledge the <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.
          </span>
        </label>
      )}

      {!signup && (
        <button type="button" className="lnk" onClick={sendReset} disabled={busy || !email}
                title={email ? "" : "Enter your email first"}>
          Forgot your password?
        </button>
      )}

      {authErr && <div className="warn">{authErr}</div>}

      <button className="btn" onClick={submit} disabled={busy || !canSubmit}>
        {busy ? (signup ? "Creating…" : "Signing in…") : signup ? "Create account" : "Sign in"}
      </button>

      <div style={{ fontSize: 11.5, color: "var(--ink3)", lineHeight: 1.6 }}>
        {signup
          ? "Your journal is private to you. You can export everything, or delete it, whenever you want."
          : "Forgotten it? The reset link above sets a new one."}
      </div>

      {/* The swap between signing in and signing up moved to the intro above
          this card, where somebody is still reading. Nothing here replaces it —
          two links doing the same thing on one screen is how a reader ends up
          unsure which is the real one. */}

      <style jsx>{`
        /* A rule with the word sitting in it, rather than a bare divider —
           it has to read as "another way in", not as the end of the card. */
        .sic-or {
          display: flex; align-items: center; gap: 10px;
          font-size: 11px; color: var(--ink3); margin: -2px 0;
        }
        .sic-or::before, .sic-or::after {
          content: ""; flex: 1; height: 1px; background: var(--rule);
        }
        .sic-swap {
          border-top: 1px solid var(--rule); padding-top: 13px;
          font-size: 12.5px; color: var(--ink3);
        }

        .sic-meter {
          display: flex; align-items: center; gap: 4px; margin-top: 7px;
        }
        .sic-meter i {
          flex: 1; height: 3px; border-radius: 2px; background: var(--rule);
        }
        /* Rust only at the bottom of the range. Amber in the middle rather
           than a second red, because "fair" is not a failure and colouring it
           like one trains people to ignore the bar entirely. */
        .sic-meter i[data-on="1"][data-s="0"],
        .sic-meter i[data-on="1"][data-s="1"] { background: var(--short); }
        .sic-meter i[data-on="1"][data-s="2"] { background: var(--brass); }
        .sic-meter i[data-on="1"][data-s="3"],
        .sic-meter i[data-on="1"][data-s="4"] { background: var(--long); }
        .sic-meter span {
          font-size: 11px; min-width: 62px; text-align: right; color: var(--ink3);
        }
        .sic-meter span[data-s="0"], .sic-meter span[data-s="1"] { color: var(--short); }
        .sic-meter span[data-s="2"] { color: var(--brass); }
        .sic-meter span[data-s="3"], .sic-meter span[data-s="4"] { color: var(--long); }

        .sic-agree {
          display: flex; align-items: flex-start; gap: 9px;
          font-size: 12px; line-height: 1.55; color: var(--ink2); cursor: pointer;
        }
        .sic-agree input { margin-top: 2px; flex: none; accent-color: var(--ink); }
        .sic-agree a { color: var(--ink); text-underline-offset: 2px; }
      `}</style>
      <style jsx global>{`
        .sic-swaplink { font-size: 12.5px !important; color: var(--ink) !important; }
        .sic-swaplink:hover { border-bottom-color: var(--brass) !important; }
      `}</style>
    </div>
  );
}

/** Google's mark, inline — the CSP blocks a remote asset and a bare button
 *  reads as unofficial next to every other app's version of this. */
function GoogleMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l-.1.3 6.5 5 .5.1c4.1-3.8 6.6-9.4 6.6-15.7" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-.3
        .1-6.7 5.2-.1.3C7.9 41 15.4 46 24 46" />
      <path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.7-2.9-.7-4.4 0-1.5.3-3 .7-4.4v-.3l-6.8-5.3-.2.1C2.9 17 2 20.4 2 24s.9 7 2.5 10z" />
      <path fill="#EA4335" d="M24 9.5c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 3.4 29.9 1 24 1 15.4 1 7.9 6 4.5 14l7 5.4C13.3 14.1 18.2 9.5 24 9.5" />
    </svg>
  );
}
