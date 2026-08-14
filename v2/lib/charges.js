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

export const mergeConfig = (partial) => ({ ...DEFAULT_CHARGE_CONFIG, ...(partial || {}) });

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
export function legCharges({ leg, exchange = "NSE", price, quantity }, config) {
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

  const buy = legCharges(
    { leg: "buy", exchange, price: num(trade.entry_price), quantity: qty },
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
        { leg: "sell", exchange, price: num(e.price), quantity: num(e.quantity) },
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
    },
    config
  );
}

export const CHARGE_LABELS = {
  stt: "STT",
  exchangeFee: "Exchange transaction",
  sebi: "SEBI turnover",
  stampDuty: "Stamp duty",
  brokerage: "Brokerage",
  dp: "DP charges",
  gst: "GST",
};
