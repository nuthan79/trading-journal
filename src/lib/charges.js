/**
 * Transaction charges — Indian equity delivery.
 *
 * TWO DESIGN RULES, both of which matter more than the arithmetic:
 *
 * 1. RATES LIVE IN CONFIG, NOT IN CODE. Every figure below moves with a Union
 *    Budget or an exchange circular. Hardcoding them turns a rate change into a
 *    silent error that quietly misstates every trade logged afterwards. They are
 *    stored per user in profiles.charge_config so one edit fixes everything.
 *
 * 2. CHARGES ARE COMPUTED ONCE AND STORED, NEVER RECOMPUTED ON READ. If STT
 *    changes next April, recomputing a trade from 2025 with 2026 rates would
 *    rewrite history into something that never happened. The stored number is
 *    the record; this engine only ever proposes a value for a new entry.
 *
 * Rates verified July 2026. Re-check after each Budget.
 */

/* ------------------------------------------------------------------ */
/*  Rates                                                              */
/* ------------------------------------------------------------------ */

export const DEFAULT_CHARGE_CONFIG = {
  /* --- statutory: same for everyone, set by government and exchanges --- */
  sttPct: 0.1,            // % of turnover, charged on BOTH buy and sell for delivery
  exchangeNsePct: 0.00297, // % of turnover, both sides
  exchangeBsePct: 0.00375, // % of turnover, both sides
  sebiPct: 0.0001,        // % of turnover (₹10 per crore), both sides
  stampDutyPct: 0.015,    // % of turnover, BUY side only for delivery
  gstPct: 18,             // % on (brokerage + exchange fees + SEBI fees + DP)

  /* --- broker specific: yours will differ, set these from your contract note --- */
  brokerageModel: "zero", // "zero" | "flat" | "percent"
  brokerageFlat: 20,      // ₹ per executed order
  brokeragePct: 0.25,     // % of turnover, when model is "percent"
  brokerageCap: 20,       // ₹ ceiling per order for the percent model
  dpChargePerSell: 13.5,  // ₹ per sell per scrip, charged by the depository
};

/* ------------------------------------------------------------------ */
/*  The United States                                                  */
/* ------------------------------------------------------------------ */

/**
 * What a US equity trade costs, which is almost nothing and not quite zero.
 *
 * Commission at the retail brokers is $0 on stocks, so the whole bill on a
 * typical trade is two regulatory fees, both charged on the SELL side only,
 * both tiny — a few cents on a $10,000 sale. They are still modelled, for the
 * same reason the Indian ones are: a journal that rounds real costs to zero
 * reports a P&L nobody can reconcile against their broker.
 *
 * DATED RATE TABLES, not constants. Both of these change on announced dates,
 * and a trade is charged at the rate in force ON THE DAY IT TRADED — so a
 * fixed number would silently re-price history the moment it was edited. The
 * tables are read by date and the newest entry on or before it wins.
 *
 * THE ZERO ENTRIES ARE REAL, and are the reason this shape exists at all:
 * the SEC rate was $0.00 per million for the first half of FY2026, and FINRA
 * paused TAF collection entirely for the last quarter of calendar 2026. A
 * model without dates would charge fees during both windows that nobody paid.
 */
export const SEC_FEE_RATES = [
  /* Per $1,000,000 of the sale. sec.gov fee rate advisories. */
  { from: "2024-05-22", perMillion: 27.80 },
  { from: "2025-02-21", perMillion: 27.80 },
  { from: "2025-10-01", perMillion: 0 },      // FY2026 began at zero
  { from: "2026-04-04", perMillion: 20.60 },  // FY2026 adjustment
];

export const TAF_RATES = [
  /* FINRA Trading Activity Fee: per share sold, capped per trade. */
  { from: "2022-01-01", perShare: 0.000145, cap: 7.27 },
  { from: "2025-01-01", perShare: 0.000166, cap: 8.30 },
  { from: "2026-01-01", perShare: 0.000195, cap: 9.79 },
  { from: "2026-10-01", perShare: 0, cap: 0 },   // collection paused to 31 Dec 2026
];

const rateOn = (table, date) => {
  const d = String(date || "").slice(0, 10) || "9999-12-31";
  let found = table[0];
  for (const row of table) if (row.from <= d) found = row;
  return found;
};

export const DEFAULT_US_CHARGE_CONFIG = {
  /* "zero" | "flat" | "perShare" — what the broker charges to execute. */
  commissionModel: "zero",
  commissionFlat: 0,          // $ per order
  commissionPerShare: 0.005,  // $ per share, for the tiered brokers
  commissionMin: 1,           // $ floor on a per-share commission
  commissionCap: 1e15,        // a large finite sentinel, never Infinity — see forSave()
  commissionCapPct: 0,        // % of the trade value; 0 means no such ceiling
};

/**
 * IBKR IS FIRST because it is how most non-US traders reach the US market at
 * all — the others on this list barely open accounts outside the country.
 *
 * Its two plans are genuinely different bills. Lite is zero commission on US
 * stocks; Pro is tiered per share with a floor AND a ceiling expressed as a
 * share of the trade value, which is why `commissionCapPct` exists: on a
 * hundred shares of a $2 stock, a per-share minimum would otherwise charge
 * more than one percent of the whole trade.
 */
export const US_BROKER_PRESETS = {
  "IBKR Lite — zero commission": { commissionModel: "zero" },
  "IBKR Pro — $0.0035/share, $0.35 min": {
    commissionModel: "perShare", commissionPerShare: 0.0035,
    commissionMin: 0.35, commissionCap: 1e15, commissionCapPct: 1,
  },
  "Zero commission (Schwab, Fidelity, Robinhood)": { commissionModel: "zero" },
  "Per share $0.005, $1 minimum": {
    commissionModel: "perShare", commissionPerShare: 0.005, commissionMin: 1, commissionCap: 1e15,
  },
  "Flat $1 per order": { commissionModel: "flat", commissionFlat: 1 },
  "Flat $6.95 per order": { commissionModel: "flat", commissionFlat: 6.95 },
};

export const BROKER_PRESETS = {
  "Zero brokerage (Zerodha, Groww, Upstox delivery)": {
    brokerageModel: "zero", dpChargePerSell: 13.5,
  },
  "Flat ₹20 per order": {
    brokerageModel: "flat", brokerageFlat: 20, dpChargePerSell: 13.5,
  },
  "Percentage with ₹20 cap": {
    brokerageModel: "percent", brokeragePct: 0.25, brokerageCap: 20, dpChargePerSell: 13.5,
  },
  "Full service (0.3%, no cap)": {
    brokerageModel: "percent", brokeragePct: 0.3, brokerageCap: Infinity, dpChargePerSell: 20,
  },
};

const num = (v, fallback = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

/**
 * The rates nobody chooses — and nobody may override.
 *
 * STT, the exchange transaction fees, the SEBI turnover fee, stamp duty and
 * GST are set by the government and the exchanges. They are the same for
 * every trader in the country, so a settings box offering to change them was
 * an invitation to get them wrong: a user who types 0.01 for STT sees every
 * charge and every net P&L in their journal quietly understated, and nothing
 * on any screen would say why. They are maintained here and updated when a
 * budget moves them.
 *
 * What IS the user's stays theirs: the broker plan, its brokerage, and the
 * depository's per-sell fee — those genuinely differ from one contract note
 * to the next.
 */
export const STATUTORY_KEYS = [
  "sttPct", "exchangeNsePct", "exchangeBsePct", "sebiPct", "stampDutyPct", "gstPct",
];

const STATUTORY = Object.fromEntries(
  STATUTORY_KEYS.map((k) => [k, DEFAULT_CHARGE_CONFIG[k]]));

/**
 * Stored config, with the statutory rates put back.
 *
 * The override goes LAST on purpose: profiles written before this rule carry
 * whatever was typed into the old settings box, and reading them as-is would
 * keep computing new charges from a number the user can no longer see or
 * correct. Anything already computed and stored on a trade is untouched —
 * see the note at the top of this file about why charges are never
 * recomputed on read.
 */
export const mergeConfig = (partial) =>
  ({ ...DEFAULT_CHARGE_CONFIG, ...(partial || {}), ...STATUTORY });

/* ------------------------------------------------------------------ */
/*  One leg                                                            */
/* ------------------------------------------------------------------ */

function brokerageFor(turnover, cfg) {
  if (cfg.brokerageModel === "zero") return 0;
  if (cfg.brokerageModel === "flat") return num(cfg.brokerageFlat);
  const pct = (turnover * num(cfg.brokeragePct)) / 100;
  const cap = num(cfg.brokerageCap, Infinity);
  return Math.min(pct, cap);
}

/**
 * Charges on a single buy or sell.
 *
 * Note what is asymmetric, because it's the part people get wrong: stamp duty
 * is buy-side only, DP charges are sell-side only, and STT applies to both.
 */
/**
 * One leg of a US trade.
 *
 * Buy side: the commission, and nothing else — there is no stamp duty here.
 * Sell side: the commission plus the two regulatory fees, at the rates in
 * force on the day of the sale. No GST: services tax does not apply to a US
 * brokerage bill the way it does to an Indian one.
 *
 * Returned in the SAME SHAPE as the Indian leg, with the fields that do not
 * exist there left at zero, so everything downstream — the per-sell split,
 * the charges box, the CSV — reads one shape and not two.
 */
export const mergeUsConfig = (partial) => ({ ...DEFAULT_US_CHARGE_CONFIG, ...(partial || {}) });

function legChargesUS({ leg, price, quantity, date }, config) {
  const qty = num(quantity);
  const px = num(price);
  const turnover = px * qty;
  if (!(turnover > 0)) return null;

  /* The user's own plan — commission is the one US cost that is theirs. The
     two regulatory fees are not, and are not in the config at all. */
  const cfg = mergeUsConfig(config);
  /* The ceiling is whichever is smaller: a rupee-style absolute cap, or the
     percentage-of-trade-value one IBKR Pro applies. */
  const pctCap = num(cfg.commissionCapPct) > 0
    ? (turnover * num(cfg.commissionCapPct)) / 100 : Infinity;
  const commission = cfg.commissionModel === "flat" ? num(cfg.commissionFlat)
    : cfg.commissionModel === "perShare"
      ? Math.min(Math.max(qty * num(cfg.commissionPerShare), num(cfg.commissionMin)),
                 num(cfg.commissionCap, 1e15), pctCap)
      : 0;

  const sec = rateOn(SEC_FEE_RATES, date);
  const taf = rateOn(TAF_RATES, date);
  /* Sell side only, both of them — a buy pays neither. */
  const secFee = leg === "sell" ? (turnover / 1e6) * num(sec.perMillion) : 0;
  const tafFee = leg === "sell" ? Math.min(qty * num(taf.perShare), num(taf.cap)) : 0;

  const total = commission + secFee + tafFee;
  return {
    leg, exchange: "US", turnover,
    /* The Indian names, kept: `brokerage` is what the broker charged, whatever
       the country calls it. `stt`, `stampDuty`, `dp` and `gst` have no US
       equivalent and stay at zero rather than being absent. */
    stt: 0, exchangeFee: 0, sebi: 0, stampDuty: 0, dp: 0, gst: 0,
    brokerage: commission, secFee, taf: tafFee,
    total: Math.round(total * 100) / 100,
  };
}

export function legCharges({ leg, exchange = "NSE", price, quantity, date, region }, config) {
  /* Which country's bill this is. Named explicitly where the caller knows,
     inferred from the venue otherwise, and India when neither says — which is
     every trade written before regions existed. */
  const country = String(region || "").toUpperCase() === "US"
    || ["NASDAQ", "NYSE", "AMEX", "ARCA", "BATS", "IEXG"].includes(String(exchange).toUpperCase())
    ? "US" : "IN";
  if (country === "US") return legChargesUS({ leg, price, quantity, date }, config);

  const cfg = mergeConfig(config);
  const qty = num(quantity);
  const px = num(price);
  const turnover = px * qty;

  if (!(turnover > 0)) return null;

  const exchangePct =
    exchange === "BSE" ? num(cfg.exchangeBsePct) : num(cfg.exchangeNsePct);

  const stt = (turnover * num(cfg.sttPct)) / 100;
  const exchangeFee = (turnover * exchangePct) / 100;
  const sebi = (turnover * num(cfg.sebiPct)) / 100;
  const stampDuty = leg === "buy" ? (turnover * num(cfg.stampDutyPct)) / 100 : 0;
  const brokerage = brokerageFor(turnover, cfg);
  const dp = leg === "sell" ? num(cfg.dpChargePerSell) : 0;

  // GST applies to the service fees, not to the statutory taxes
  const gst = ((brokerage + exchangeFee + sebi + dp) * num(cfg.gstPct)) / 100;

  const total = stt + exchangeFee + sebi + stampDuty + brokerage + dp + gst;

  return {
    leg, exchange, turnover,
    stt, exchangeFee, sebi, stampDuty, brokerage, dp, gst,
    /* Zero in India, so every consumer can read one shape. */
    secFee: 0, taf: 0,
    total: Math.round(total * 100) / 100,
  };
}

/* ------------------------------------------------------------------ */
/*  A whole trade                                                      */
/* ------------------------------------------------------------------ */

/**
 * Both sides of a round trip.
 *
 * This is what belongs in the charges box when a trade is closed: the buy leg
 * and every sell leg added together. Charging only the sell side — the intuitive
 * mistake, since that's the moment you're filling the field in — misses stamp
 * duty and half the STT, which on delivery is most of the bill.
 *
 * `exits` accepts either the tranche rows from trade_exits, or nothing at all,
 * in which case it falls back to the single exit recorded on the trade. That
 * means this works whether or not the partial-exit migration has run.
 */
export function tradeCharges(trade, config) {
  const cfg = mergeConfig(config);
  const exchange = trade.exchange || "NSE";
  const qty = num(trade.quantity);

  /* The trade says which country and which day; both matter in the US, where
     the regulatory rates are dated and a sale is charged at the rate in force
     when it happened. */
  const region = trade.region;

  const buy = legCharges(
    { leg: "buy", exchange, price: num(trade.entry_price), quantity: qty,
      date: trade.entry_date, region },
    cfg
  );

  const rawExits = Array.isArray(trade.exits) && trade.exits.length
    ? trade.exits
    : num(trade.exit_price) > 0
    ? [{ price: trade.exit_price, quantity: qty }]
    : [];

  const sells = rawExits
    .map((e) =>
      legCharges(
        { leg: "sell", exchange, price: num(e.price), quantity: num(e.quantity),
          date: e.exit_date || trade.exit_date, region },
        cfg
      )
    )
    .filter(Boolean);

  const sellTotal = sells.reduce((a, s) => a + s.total, 0);
  const total = (buy?.total || 0) + sellTotal;

  const sum = (k) =>
    (buy?.[k] || 0) + sells.reduce((a, s) => a + (s[k] || 0), 0);

  return {
    buy,
    sells,
    // itemised across both sides, for the breakdown panel
    breakdown: {
      stt: round2(sum("stt")),
      exchangeFee: round2(sum("exchangeFee")),
      sebi: round2(sum("sebi")),
      stampDuty: round2(sum("stampDuty")),
      brokerage: round2(sum("brokerage")),
      dp: round2(sum("dp")),
      gst: round2(sum("gst")),
      /* Zero on an Indian trade, and the whole bill on a US one. */
      secFee: round2(sum("secFee")),
      taf: round2(sum("taf")),
    },
    buyTotal: round2(buy?.total || 0),
    sellTotal: round2(sellTotal),
    total: round2(total),
    // What this bill costs you as a fraction of the position — useful sanity
    // check, and it rises sharply on small positions
    pctOfTurnover: buy?.turnover
      ? (total / (buy.turnover + sells.reduce((a, s) => a + s.turnover, 0))) * 100
      : NaN,
    computedAt: new Date().toISOString(),
    ratesUsed: {
      sttPct: cfg.sttPct, stampDutyPct: cfg.stampDutyPct, gstPct: cfg.gstPct,
      exchangePct: exchange === "BSE" ? cfg.exchangeBsePct : cfg.exchangeNsePct,
      sebiPct: cfg.sebiPct, brokerageModel: cfg.brokerageModel,
      dpChargePerSell: cfg.dpChargePerSell,
    },
  };
}

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Charges on the buy leg alone — what to show while a position is still open.
 * Half the eventual bill is already incurred at this point, and it's honest to
 * reflect that rather than showing zero until the exit.
 */
export function entryCharges(trade, config) {
  return legCharges(
    {
      leg: "buy",
      exchange: trade.exchange || "NSE",
      price: num(trade.entry_price),
      quantity: num(trade.quantity),
      date: trade.entry_date,
      region: trade.region,
    },
    config
  );
}

export const CHARGE_LABELS = {
  stt: "STT",
  secFee: "SEC fee",
  taf: "FINRA activity fee",
  exchangeFee: "Exchange transaction",
  sebi: "SEBI turnover",
  stampDuty: "Stamp duty",
  brokerage: "Brokerage",
  dp: "DP charges",
  gst: "GST",
};
