/**
 * How good is this password, roughly.
 *
 * NOT A SECURITY CONTROL. Nothing here decides whether a password is accepted
 * — length does that, and the real defence is that Supabase stores a bcrypt
 * hash and rate-limits sign-in attempts. This exists to tell somebody, while
 * they are still typing, that "vedu1979" is the sort of thing that gets
 * guessed. A meter that appears after rejection is a lecture; one that moves
 * as you type is a nudge.
 *
 * DELIBERATELY SIMPLE. A real estimator (zxcvbn and friends) is several
 * hundred kilobytes of dictionaries, which is a lot to ship to everyone who
 * visits in order to grade a field they may never fill in. This catches the
 * things that actually matter at this scale: too short, one kind of character,
 * a plain dictionary word, a year on the end.
 */

const COMMON = [
  "password", "qwerty", "welcome", "admin", "letmein", "trading", "trader",
  "money", "profit", "stocks", "market", "india", "abcd", "1234",
];

/** 0–4. The bar is drawn from this, and the words come from LABELS. */
export function passwordScore(pw) {
  const v = String(pw || "");
  if (!v) return 0;

  const lower = v.toLowerCase();
  // A dictionary word with a year stuck on the end is the single most common
  // shape, and character-class counting scores it far too generously.
  const stripped = lower.replace(/[0-9!@#$%^&*_\-.]+$/g, "");
  if (COMMON.some((c) => stripped.includes(c) || lower.includes(c))) {
    return v.length >= 14 ? 2 : 1;
  }

  let score = 0;
  if (v.length >= 8) score += 1;
  if (v.length >= 12) score += 1;
  if (v.length >= 16) score += 1;

  const classes =
    (/[a-z]/.test(v) ? 1 : 0) + (/[A-Z]/.test(v) ? 1 : 0) +
    (/[0-9]/.test(v) ? 1 : 0) + (/[^A-Za-z0-9]/.test(v) ? 1 : 0);
  if (classes >= 3) score += 1;

  // All one character, or a straight run, however long.
  if (/^(.)\1+$/.test(v) || /^(?:0123|1234|abcd|qwer)/i.test(v)) score = Math.min(score, 1);

  return Math.max(0, Math.min(4, score));
}

export const PASSWORD_LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"];

/**
 * Eight, not Supabase's six.
 *
 * The reset page has always asked for eight, so six at sign-up meant a
 * password could be created that could not be re-entered when changing it —
 * a rule that only appears once you are already locked out of your own form.
 */
export const MIN_PASSWORD = 8;
