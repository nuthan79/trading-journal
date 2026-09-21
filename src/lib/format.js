/**
 * Display formatting — in the currency of the book being read.
 *
 * Indian conventions are the default and the origin of this file: "17.70 L"
 * reads faster to an Indian trader than "₹1,770,000" does, and no
 * international formatter produces the lakh/crore ladder. A US book wants the
 * other one — $1.2K, $3.4M — and the same figures otherwise.
 *
 * HOW THE CURRENCY ARRIVES, and why not as an argument. There are 142 places
 * that print money in this app. Threading a region through all of them would
 * be 142 chances to miss one, and a missed one prints dollars with a rupee
 * sign — the failure you cannot see in a screenshot. So the active book is set
 * ONCE, by the app layout that already loads the profile, and every formatter
 * reads it. A region is a separate book (see lib/regions.js), so everything on
 * screen at any moment belongs to the same one, which is exactly the condition
 * that makes a single module-level answer correct rather than lazy.
 *
 * `money()` follows the book. `rupee()` is always rupees, for the places that
 * are about India whatever you are trading — the statutory charge rates, the
 * broker presets, the learn pages.
 *
 * NAMES THAT DO NOT LIE. `rupee()` returning "$1.2K" would be the kind of
 * thing that is true in the code and false in every reader's head, so the
 * currency-following one is called `money()` and the rupee one kept its name.
 */
import { region as regionInfo, activeRegion, setActiveRegion } from "./regions";

/* The open book lives in regions.js — the symbol search and the quote source
   ask it the same question. Re-exported here because every caller that
   formats money imports from this file. */
export { setActiveRegion, activeRegion };

/**
 * The ladders. India goes thousand → lakh → crore → lakh crore; the US goes
 * K → M → B → T. Each tier is where a trader in that country would stop
 * writing digits, which is the whole point of abbreviating at all.
 */
const LADDERS = {
  lakhCrore: [
    { at: 1e5, div: 1e3, suffix: "k", dp: 1 },
    { at: 1e7, div: 1e5, suffix: " L" },
    { at: 1e12, div: 1e7, suffix: " Cr", group: true },
    { at: 1e19, div: 1e12, suffix: " Lakh Cr" },
  ],
  thousandMillion: [
    { at: 1e6, div: 1e3, suffix: "K", dp: 1 },
    { at: 1e9, div: 1e6, suffix: "M" },
    { at: 1e12, div: 1e9, suffix: "B" },
    { at: 1e19, div: 1e12, suffix: "T" },
  ],
};

const styleOf = (id) => {
  const r = regionInfo(id || activeRegion());
  return { locale: r.locale, sign: r.sign, ladder: LADDERS[r.tiers] || LADDERS.lakhCrore };
};

export function amount(v, { compact = true, decimals = 2, region } = {}) {
  if (v == null || !isFinite(v)) return "—";
  const { locale, ladder } = styleOf(region);
  const neg = v < 0;
  const a = Math.abs(v);
  let out;

  const tier = compact && a >= 1e3 ? ladder.find((t) => a < t.at) : null;

  if (!tier) {
    if (a >= 1e19) return (neg ? "−" : "") + hugeGuard(a);
    out = new Intl.NumberFormat(locale, { maximumFractionDigits: a < 100 ? 2 : 0 }).format(a);
  } else {
    const scaled = a / tier.div;
    /* Four-digit crore figures need grouping and lose their decimals: "₹1,093 Cr"
       is how this is written and read, "₹1093.3 Cr" is neither. */
    out = tier.group && scaled >= 1000
      ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(scaled)}${tier.suffix}`
      : `${scaled.toFixed(tier.dp ?? decimals)}${tier.suffix}`;
  }
  return (neg ? "−" : "") + out;
}

/** India's name for it, kept because most of this app is about India. */
export const inr = (v, opts) => amount(v, opts);

function hugeGuard(a) {
  {
    /*
      Past a lakh crore the Cr tier stops being readable: a real projection
      printed "₹38822826.87 Cr", which is arithmetically fine and impossible to
      parse at a glance. Indian usage for figures this size — budgets, GDP,
      market cap — is lakh crore, so follow it.
    */
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
    return `${mant} × 10^${exp}`;
  }
}

/**
 * A money figure in the currency of the book being read.
 *
 * This is the one to use for anything a user's own trades produced. It is
 * rupees today for every user, and dollars for a US book the moment there is
 * one, without the call site changing.
 */
export const money = (v, opts) =>
  (v == null || !isFinite(v) ? "—" : `${styleOf(opts?.region).sign}${amount(v, opts)}`);

/**
 * Rupees, always — for the parts of the app that are about India whatever the
 * user is trading: the statutory charge rates, the broker presets, the pledge
 * fee, the learn pages.
 */
export const rupee = (v, opts) =>
  (v == null || !isFinite(v) ? "—" : `₹${amount(v, { ...opts, region: "IN" })}`);

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
export function moneyParts(v, { region } = {}) {
  if (v == null || !isFinite(v)) return null;
  const s = new Intl.NumberFormat(styleOf(region).locale, {
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

/**
 * Every digit of a figure, grouped the Indian way: 5,88,000 rather than 5.88 L.
 *
 * The compact tiers are what make a table scannable, and they are staying —
 * but they round, and rounding is exactly what somebody checking a number
 * against their broker cannot have. "₹5.88 L" is anywhere in a ₹500 band.
 * So the full figure lives in the hover instead of on the page.
 *
 * PAISE ONLY WHEN THERE ARE ANY. A P&L total lands on whole rupees far more
 * often than not, and "₹5,88,000.00" spends two characters saying nothing.
 * A price does carry them, and there they are the point.
 */
export function exact(v, { region } = {}) {
  if (v == null || !isFinite(v)) return "—";
  const { locale, sign } = styleOf(region);
  const a = Math.abs(v);
  const s = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(a);
  /* SIGN INSIDE THE RUPEE, matching `rupee()` — "₹−23,800" under a cell
     reading "₹−23.8k". `moneyParts` writes it the other way round, and a
     tooltip that reorders the two characters of the figure it is expanding
     reads for a moment like a different number. */
  return `${sign}${v < 0 ? "−" : ""}${s}`;
}

/**
 * The hover text for a money figure — the exact rupees, plus whatever else
 * that particular number wanted to say.
 *
 * RETURNS undefined WHEN THE PAGE ALREADY SHOWS EVERY DIGIT. Below a thousand
 * `rupee()` is not abbreviating anything, so "₹450" would open a tooltip
 * reading "₹450" — a hover that teaches the user their hovers are worthless,
 * on the majority of the small figures in the app. Compared as strings rather
 * than by a size threshold, because the tiers are the formatter's business and
 * this must not hold a second opinion about where they start.
 *
 * `note` is for a cell that already had a title of its own. It gets folded in
 * here rather than left on the parent element, because two nested titles means
 * the browser shows whichever one the pointer happens to be over, and the
 * charges hover on Net P&L is not something to lose to a stray pixel.
 */
export function moneyTitle(v, note, { region } = {}) {
  if (v == null || !isFinite(v)) return note || undefined;
  const full = exact(v, { region });
  const hidden = full !== money(v, { region });
  if (!hidden) return note || undefined;
  return note ? `${full} · ${note}` : full;
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
  /* THE PREFIX IS SLUGGED TOO, because it stopped being a constant. It is the
     user's own name for their journal now — "Nuthan Ledger", or anything else
     they typed into Settings — so it arrives with spaces, capitals and
     whatever punctuation they felt like, exactly as the label does. */
  const clean = (v, max) => String(v ?? "")
    .toLowerCase()
    /* Apostrophes are DROPPED, not turned into a separator, so a possessive
       survives as one word: "Nuthan's Ledger" is nuthans-ledger and not
       nuthan-s-ledger, which reads as two names badly joined. Both the curly
       and the straight one, because a name typed on a phone gets the curly. */
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    /* A cut can land mid-word and leave a trailing hyphen. */
    .replace(/-+$/, "");
  const slug = clean(label, 60);
  prefix = clean(prefix, 40) || "ledgerr";
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
                `-${p(now.getHours())}${p(now.getMinutes())}`;
  return [prefix, slug, stamp].filter(Boolean).join("-") + `.${ext}`;
}

/**
 * Exported so a month name is spelled ONE way across the app.
 *
 * The alternative is toLocaleString(..., { month: "short" }), which gives
 * "Sept" for September under some ICU builds and "Sep" under others — four
 * letters where every date in the table says three, and a value that can
 * differ between the server and the browser, which is one of the causes React
 * lists for a hydration mismatch.
 */
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The short month a date falls in — the same word `dmy` would print.
 *
 * Takes a Date OR a stored "YYYY-MM-DD", and reads the string form by hand
 * for the reason `dmy` does: `new Date("2026-09-01")` is UTC midnight, and
 * every getter reads it back in the local zone, so west of Greenwich that
 * date is August. A helper handed a date string is the obvious way for that
 * bug to arrive, so it cannot.
 */
export const monthShort = (d) => {
  if (typeof d === "string") {
    const m = Number(String(d).slice(5, 7));
    return MONTHS[m - 1] || "";
  }
  return MONTHS[new Date(d).getMonth()] || "";
};

/**
 * YYYY-MM-DD for today, in the browser's own timezone.
 *
 * NOT `new Date().toISOString().slice(0, 10)`, which is the UTC day. India is
 * UTC+5:30 and therefore always ahead, so between midnight and half past five
 * in the morning that expression returns YESTERDAY — a chart attached at one
 * in the morning filed under the previous day, on the one screen that lists
 * by date. West of Greenwich it fails in the other direction, at night.
 *
 * Takes `now` so a probe can put the clock somewhere the two disagree, the
 * same way `exportFilename` does. There is no other way to test this: the bug
 * only exists during a few hours of the day.
 */
export function today(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

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

/**
 * The annualised-return tile, in words — label, figure, and the sentence under
 * the hover.
 *
 * Here rather than in the component that first needed it because two screens
 * show this number and they must not describe it differently. A user who
 * reads "CAGR" on the Dashboard and "XIRR" on Performance for one book has
 * been told the app cannot make up its mind.
 *
 * Takes what `annualisedReturn()` returns and adds no arithmetic of its own.
 */
export function describeAnnualised(a) {
  if (!a) return { label: "CAGR", value: "—", hint: "Not enough history yet" };

  if (!isFinite(a.rate)) {
    return {
      label: "CAGR",
      value: "—",
      hint: a.method === "too-short"
        ? `Needs ${a.minDays} days of history — annualising a shorter record `
          + "says more about the arithmetic than about the trading"
        : a.method === "no-capital"
        ? "Set your account size in Settings and this fills in"
        : "Not enough history yet",
      short: a.method === "too-short" ? "needs 90 days" : "not enough history",
    };
  }

  const span = a.years >= 1
    ? `${a.years.toFixed(1)} years`
    : `${Math.round(a.days)} days`;
  const marked = a.marked ? ", open positions at market" : "";

  return {
    label: a.method === "xirr" ? "XIRR" : "CAGR",
    value: signedPct(a.rate * 100),
    tone: a.rate > 0 ? "pos" : a.rate < 0 ? "neg" : "",
    /* The label already says CAGR, which already means a year. */
    short: `over ${span}`,
    hint: a.method === "xirr"
      ? `Money-weighted over ${span}, counting ${a.flows} deposit`
        + `${a.flows === 1 ? "" : "s"} or withdrawal${a.flows === 1 ? "" : "s"}${marked}`
      : `Compounded over ${span}${marked}`
        + ". No deposits or withdrawals recorded, so this is also the XIRR",
  };
}
