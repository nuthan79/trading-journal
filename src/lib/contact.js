/**
 * What the contact form will accept, in ONE place.
 *
 * The form and the route that receives it each carried their own copy of the
 * minimum, and two copies of a rule are two rules eventually. Worse here than
 * usual: the client copy decides whether the button works at all, so if it
 * ever crept above the server's, messages the server would happily take could
 * not be sent, and nothing anywhere would report a fault.
 *
 * WHY A MINIMUM AT ALL, AND WHY IT IS THIS LOW. It is a floor against a stray
 * keystroke and an accidental send, not a quality filter. It used to be ten
 * characters, and a real user trying to ask for US access typed "i need US" —
 * nine — and met a dead grey button with no explanation. He reported the form
 * as broken, which from where he sat it was. A rule that silently refuses a
 * legitimate message costs more than the junk it prevents, especially on the
 * one page somebody reaches BECAUSE something is already wrong.
 */
export const MIN_MESSAGE = 4;

export const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());

/**
 * Why this cannot be sent yet, in words, or "" when it can.
 *
 * Returned rather than a boolean because the button no longer disables itself:
 * a control that is dead and silent is the failure above. The caller shows
 * this, so the reason and the refusal cannot disagree.
 */
export function whyNotSendable({ email = "", message = "" } = {}) {
  if (!String(email).trim()) return "Add an email address, so there's somewhere to reply to.";
  if (!looksLikeEmail(email)) return "That email address doesn't look right.";
  if (String(message).trim().length < MIN_MESSAGE) return "Tell us what's wrong, or what you need.";
  return "";
}
