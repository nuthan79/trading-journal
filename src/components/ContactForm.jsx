"use client";

import { useState } from "react";
import { BRAND } from "@/lib/brand";

/**
 * Write to us.
 *
 * THE ADDRESS IS SHOWN AS WELL AS THE FORM. Some people would rather use their
 * own mail client, some are writing precisely because something on the site is
 * broken, and a form is a poor thing to depend on in that case. Offering both
 * costs a line.
 *
 * ON SUCCESS THE FORM IS REPLACED, not merely annotated. A form still sitting
 * there with a green tick beside it invites a second send, and duplicate
 * messages are how a one-person inbox stops being read.
 */
export default function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");   // honeypot, see the route
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && message.trim().length >= 10;

  const submit = async (e) => {
    e?.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, message, website }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setErr(data.error || "Could not send that just now.");
      else setSent(true);
    } catch {
      setErr("Could not reach the server. Check your connection and try again.");
    }
    setBusy(false);
  };

  if (sent) {
    return (
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="disp" style={{ fontSize: 16 }}>Message sent</div>
        <p style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--ink2)", margin: 0 }}>
          Thanks — it went to <b>{BRAND.contactEmail}</b>, and a reply will come to{" "}
          <b>{email.trim()}</b>. This is a one-person operation, so give it a day or two.
        </p>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={submit}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label className="f"><span>Your name (optional)</span>
        <input className="in" value={name} maxLength={100}
               onChange={(e) => setName(e.target.value)} /></label>

      <label className="f"><span>Your email</span>
        <input className="in" type="email" value={email} maxLength={200} required
               autoComplete="email"
               onChange={(e) => setEmail(e.target.value)} />
        <div className="hint">So there&apos;s somewhere to reply to.</div></label>

      <label className="f"><span>Message</span>
        <textarea className="in" rows={7} value={message} maxLength={4000} required
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="A question, something that went wrong, or something you wish it did." />
      </label>

      {/* Hidden from people, irresistible to bots. Not type="hidden" — plenty
          of them skip those; an off-screen text input gets filled. */}
      <input
        type="text" name="website" tabIndex={-1} autoComplete="off"
        aria-hidden="true" value={website}
        onChange={(e) => setWebsite(e.target.value)}
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
      />

      {err && <div className="warn">{err}</div>}

      <button className="btn" type="submit" disabled={!valid || busy}
              style={{ alignSelf: "flex-start" }}>
        {busy ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
