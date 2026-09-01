/**
 * Display formatting. Indian conventions, because "17.70 L" reads faster to an
 * Indian trader than "₹1,770,000" does.
 */

export function inr(v, { compact = true, decimals = 2 } = {}) {
  if (v == null || !isFinite(v)) return "—";
  const neg = v < 0;
  const a = Math.abs(v);
  let out;

  if (!compact || a < 1e3) {
    out = new Intl.NumberFormat("en-IN", { maximumFractionDigits: a < 100 ? 2 : 0 }).format(a);
  } else if (a < 1e5) {
    // thousands get a k so a row of trade P&Ls stays scannable at a glance
    out = `${(a / 1e3).toFixed(1)}k`;
  } else if (a < 1e7) {
    out = `${(a / 1e5).toFixed(decimals)} L`;
  } else if (a < 1e12) {
    const cr = a / 1e7;
    /* Four-digit crore figures need grouping and lose their decimals: "₹1,093 Cr"
       is how this is written and read, "₹1093.3 Cr" is neither. */
    out = cr >= 1000
      ? `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(cr)} Cr`
      : `${cr.toFixed(decimals)} Cr`;
  } else if (a < 1e19) {
    /*
      Past a lakh crore the Cr tier stops being readable: a real projection
      printed "₹38822826.87 Cr", which is arithmetically fine and impossible to
      parse at a glance. Indian usage for figures this size — budgets, GDP,
      market cap — is lakh crore, so follow it.
    */
    out = `${(a / 1e12).toFixed(decimals)} Lakh Cr`;
  } else {
    /*
      THE GUARD THAT SHOULD NEVER FIRE.

      `toFixed()` returns exponential notation once the value reaches 1e21 —
      quietly, with no error — so a compounding projection put the literal
      string "₹2.1512646478529814e+28 Cr" on a public page. Nothing a trading
      journal legitimately measures lives up here, so this is a backstop rather
      than a tier: callers producing numbers this size have a problem the
      formatter cannot fix. But it must never emit raw JS again.
    */
    const [mant, exp] = a.toExponential(2).split("e+");
    out = `${mant} × 10^${exp}`;
  }
  return (neg ? "−" : "") + out;
}

/** With the rupee sign — for money amounts standing on their own. */
export const rupee = (v, opts) => (v == null || !isFinite(v) ? "—" : `₹${inr(v, opts)}`);

/**
 * A figure written out in full: 50,35,939.09 rather than 50.36 L.
 *
 * NOT a replacement for `inr`, and the scope of that was settled by trying it
 * the other way. The tiers exist because "17.70 L" reads faster than
 * "17,70,000", and five full figures side by side turn a summary strip into a
 * ledger — the version that converted all of them was built and reverted.
 *
 * What is left is the narrow case it was right for: a number somebody
 * RECONCILES rather than scans, against a broker app or a statement, where
 * rounding to two significant figures throws away the rupees being checked.
 * Today's move on the holdings strip is currently the only one.
 *
 * `compact: false` on `inr` was close but not this: it drops the decimals
 * entirely above ₹100, so a balance came out as 50,35,939 with the paise
 * silently gone.
 *
 * Returned in PARTS rather than as one string so a caller can set the decimals
 * smaller. At this length that is not decoration — 50,35,939.09 read at one
 * size makes the eye stop on the wrong group of digits.
 */
export function moneyParts(v) {
  if (v == null || !isFinite(v)) return null;
  const s = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Math.abs(v));
  const cut = s.lastIndexOf(".");
  return {
    neg: v < 0,
    /* The minus is the typographic one used everywhere else here, not a
       hyphen — it is the width of a digit, so a column of these stays aligned. */
    sign: v < 0 ? "−" : "",
    int: cut < 0 ? s : s.slice(0, cut),
    dec: cut < 0 ? "00" : s.slice(cut + 1),
  };
}

export function rfmt(v, dp = 2) {
  if (!isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(dp)}R`;
}

export function pct(v, dp = 1) {
  if (!isFinite(v)) return "—";
  return `${v.toFixed(dp)}%`;
}

export function signedPct(v, dp = 1) {
  if (!isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`;
}

export const days = (v) => (isFinite(v) ? `${Math.round(v)} d` : "—");

/**
 * A download filename that says what is in the file.
 *
 * "trades-2026-09-01.csv" is indistinguishable from every other export ever
 * taken, and two of them in a Downloads folder cannot be told apart — one may
 * be the whole book and the other twenty-seven trades from one saved view.
 *
 * SLUGGED HARD, because `label` can be a saved view's name and that is free
 * text somebody typed. A colon is legal in a view name and illegal in a
 * filename on Windows; a slash is legal and, on every platform, a path
 * separator. Anything outside a-z0-9 becomes a hyphen rather than being
 * escaped, which also spares the whole question of how a browser's download
 * handler treats a percent sign.
 *
 * THE STAMP IS LOCAL TIME, NOT ISO. It exists so a second export five minutes
 * later is a different file rather than silently becoming "(1)". A file saved
 * at nine in the morning that reads 0330 fails at exactly that job, so UTC is
 * the wrong clock here even though it is the right one everywhere else in
 * this app.
 */
export function exportFilename(label, { ext = "csv", prefix = "ledgerr",
                                        now = new Date() } = {}) {
  const slug = String(label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    /* A 60-char cut can land mid-word and leave a trailing hyphen. */
    .replace(/-+$/, "");
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
                `-${p(now.getHours())}${p(now.getMinutes())}`;
  return [prefix, slug, stamp].filter(Boolean).join("-") + `.${ext}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A date to read rather than to sort by. Tables keep ISO because a column of
 * them lines up and sorts as text; a date sitting alone in a sentence or under
 * a chart does neither, and "2025-05-21" is slower to take in than "21 May 25".
 *
 * Parsed by hand rather than through Date, which reads a bare YYYY-MM-DD as
 * UTC and can show the day before once the browser is west of Greenwich.
 */
export function dmy(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "—";
  return `${d} ${MONTHS[m - 1]} ${String(y).slice(2)}`;
}
