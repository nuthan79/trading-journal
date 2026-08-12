import { BRAND } from "@/lib/brand";

/**
 * The contact form's other end.
 *
 * WHY A ROUTE AND NOT A mailto: LINK. A mailto only works for someone whose
 * browser has a desktop mail client wired up, which is a shrinking minority —
 * everyone on Gmail in a tab gets a dead link or an empty window they close.
 * The people most likely to be writing are the ones something went wrong for,
 * and losing them at that moment is the worst time to lose them.
 *
 * WHY NOT A DATABASE TABLE. Storing messages would need an insert policy loose
 * enough for a signed-out visitor, which is an open write endpoint on a public
 * URL. Email has a recipient fixed in server code, so the worst an abuser
 * achieves is filling one inbox — not writing rows into the same database that
 * holds everybody's trades.
 *
 * THE KEY IS SERVER-SIDE. RESEND_API_KEY has no NEXT_PUBLIC_ prefix, so it is
 * never compiled into anything the browser receives. Use a *separate* key from
 * the one in Supabase's SMTP settings: revoking one should not silently break
 * password recovery for every user.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Long enough for a real question, short enough that nobody pastes a novel
 *  or a payload into it. */
const MAX = { name: 100, email: 200, message: 4000 };
const MIN_MESSAGE = 10;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Deliberately loose. The address only has to be plausible enough to reply to,
// and every strict regex ever written rejects somebody's real address.
const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected JSON." }, 400);
  }

  const name = String(body?.name ?? "").trim().slice(0, MAX.name);
  const email = String(body?.email ?? "").trim().slice(0, MAX.email);
  const message = String(body?.message ?? "").trim().slice(0, MAX.message);

  /**
   * The honeypot, and why it answers success.
   *
   * `website` is hidden from people and irresistible to the bots that fill
   * every field they find. Telling one it failed teaches whoever wrote it to
   * try again differently; a cheerful 200 that quietly sends nothing does not.
   */
  if (String(body?.website ?? "").trim()) return json({ ok: true });

  if (!looksLikeEmail(email)) {
    return json({ error: "That email address doesn't look right." }, 400);
  }
  if (message.length < MIN_MESSAGE) {
    return json({ error: "Tell us a little more than that." }, 400);
  }

  const to = process.env.CONTACT_TO || BRAND.contactEmail;
  const key = process.env.RESEND_API_KEY;

  if (!key || !to) {
    // Said plainly rather than pretending to have sent it. A form that
    // swallows messages is worse than one that admits it is not connected.
    return json(
      { error: "The contact form isn't configured yet. Please email us directly." },
      503
    );
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      // Must be the verified domain — a visitor's address here would be
      // spoofing, and would fail SPF and DMARC on the way out.
      from: `${BRAND.name} contact <${to}>`,
      to: [to],
      /**
       * The field and the raw header, both.
       *
       * The point is that hitting reply answers the person who wrote, rather
       * than writing back to our own contact box — which is what happened:
       * replies addressed contact@ledgerr.app and would have gone nowhere.
       * `reply_to` alone did not survive the trip, and from outside there is
       * no way to tell whether Resend dropped the field or Porkbun stripped
       * the header while forwarding. Setting an explicit header as well
       * removes the question.
       *
       * Only these two, both documented. The SDK's camelCase `replyTo` is not
       * a REST field, and an unknown key risks a 422 that would take the whole
       * form down to fix a reply address.
       */
      reply_to: email,
      headers: { "Reply-To": email },
      subject: `${BRAND.name} — message from ${name || email}`,
      text: `From: ${name || "(no name)"} <${email}>\n\n${message}`,
      html:
        `<p><b>From:</b> ${escapeHtml(name || "(no name)")} ` +
        `&lt;${escapeHtml(email)}&gt;</p>` +
        `<pre style="white-space:pre-wrap;font:inherit">${escapeHtml(message)}</pre>`,
    }),
  });

  if (!res.ok) {
    // Never the provider's raw error: it can quote the request, and the
    // request has somebody's address in it.
    return json({ error: "Could not send that just now. Please try again." }, 502);
  }

  return json({ ok: true });
}
