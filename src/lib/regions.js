/**
 * Which market a book belongs to.
 *
 * PHASE 1: this file describes the regions and nothing reads it yet. The
 * switch is behind `SHOW_REGIONS` in flags.js, and every trade in every
 * database is `IN` until somebody turns it on.
 *
 * A REGION IS A SEPARATE BOOK, not a filter over a shared one. India and the
 * US each keep their own account size, capital ledger, equity curve and
 * totals, and no screen ever adds a rupee to a dollar. The alternative —
 * one blended portfolio — needs an exchange rate on every figure, and then a
 * closed Indian trade's P&L moves whenever the dollar does, which is simply
 * untrue: the trade made what it made. What DOES compare across markets is R
 * and win rate, because they are ratios, and that is how the two books will
 * eventually be read side by side.
 *
 * WHAT A REGION DECIDES, and therefore what belongs in this table rather than
 * scattered through the app: the currency and how it is abbreviated, the
 * exchanges, how a ticker is spelled for the quote source, the benchmark
 * index, where the financial year starts, and whether margin funding (MTF) is
 * a thing that exists there at all.
 *
 * `IN` IS ALWAYS THE FALLBACK. A row with no region, a profile from before
 * the migration, an undefined — all of them are India, because every trade
 * written before this file existed was. That is what lets the code go in
 * ahead of the migration and change nothing.
 */

export const REGIONS = [
  {
    id: "IN",
    label: "India",
    /* The money. `lakhCrore` picks the k/L/Cr ladder over k/M/B — the one
       thing about Indian figures that no international library gets right. */
    currency: "INR",
    sign: "₹",
    tiers: "lakhCrore",
    locale: "en-IN",
    exchanges: ["NSE", "BSE"],
    defaultExchange: "NSE",
    /* Yahoo wants a suffix here and a bare ticker in the US. Already true in
       quotes.js; stated here so one table answers "what is different". */
    tickerSuffix: { NSE: ".NS", BSE: ".BO" },
    /* April to March. `fiscalStartMonth` is 1-based, so 4 is April. */
    fiscalStartMonth: 4,
    fiscalLabel: "FY",
    timeZone: "Asia/Kolkata",
    /* Margin funding as a broker product, with pledge fees and a per-lakh
       daily rate. It has no equivalent in the US, where margin is an interest
       rate on a balance — a different model, not a different number. */
    hasMtf: true,
  },
  {
    id: "US",
    label: "United States",
    currency: "USD",
    sign: "$",
    tiers: "thousandMillion",
    locale: "en-US",
    exchanges: ["NASDAQ", "NYSE", "AMEX"],
    defaultExchange: "NASDAQ",
    /* Bare tickers: AAPL is AAPL. */
    tickerSuffix: { NASDAQ: "", NYSE: "", AMEX: "" },
    /* The calendar year. An American trader's "FY26" is 2026. */
    fiscalStartMonth: 1,
    fiscalLabel: "",
    timeZone: "America/New_York",
    hasMtf: false,
  },
];

export const DEFAULT_REGION = "IN";

const BY_ID = new Map(REGIONS.map((r) => [r.id, r]));

/** The region's description, or India's — never undefined. */
export const region = (id) => BY_ID.get(String(id || "").toUpperCase()) || BY_ID.get(DEFAULT_REGION);

/**
 * The region a row belongs to.
 *
 * Reads the column when it is there and answers India when it is not, which
 * is every row written before migration 052 and every row in a database where
 * it has not been run. Both are genuinely Indian trades, so this is a fact,
 * not a guess.
 */
export const regionOf = (row) => {
  const id = String(row?.region || "").toUpperCase();
  return BY_ID.has(id) ? id : DEFAULT_REGION;
};

/** The region this user last had selected. */
export const currentRegion = (profile) => regionOf(profile);

/** Is this a market where a stock can be bought on margin funding? */
export const hasMtf = (id) => region(id).hasMtf;

/**
 * The account size and risk % for a region.
 *
 * India keeps the columns it has always had; anything else lives under its id
 * in `region_settings`. So a user who only trades India reads exactly the same
 * values from exactly the same places as before this existed.
 */
export function regionSettings(profile, id = currentRegion(profile)) {
  if (regionOf({ region: id }) === DEFAULT_REGION) {
    return {
      account_size: profile?.account_size ?? 0,
      default_risk_pct: profile?.default_risk_pct ?? 0.75,
      charge_config: profile?.charge_config ?? null,
    };
  }
  const all = profile?.region_settings;
  const mine = (all && typeof all === "object" ? all[id] : null) || {};
  return {
    account_size: mine.account_size ?? 0,
    default_risk_pct: mine.default_risk_pct ?? profile?.default_risk_pct ?? 0.75,
    charge_config: mine.charge_config ?? null,
  };
}

/**
 * A patch that saves one region's settings without disturbing another's.
 *
 * India writes the top-level columns; everything else merges into the jsonb,
 * because a whole-object write would drop the other regions' settings the
 * first time two markets existed at once.
 */
export function regionSettingsPatch(profile, id, next) {
  if (regionOf({ region: id }) === DEFAULT_REGION) return { ...next };
  const all = (profile?.region_settings && typeof profile.region_settings === "object")
    ? profile.region_settings : {};
  return { region_settings: { ...all, [id]: { ...(all[id] || {}), ...next } } };
}
