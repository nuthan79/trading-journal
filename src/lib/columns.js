/**
 * What each table column means, in a sentence, for its header's hover.
 *
 * ONE MAP FOR BOTH TABLES, keyed by the sort key each header already uses. SL %
 * appears on Trades and on Holdings; written twice, the two definitions would
 * drift, and a column that means one thing on one screen and something subtly
 * different on the next is worse than one with no hover at all.
 *
 * Every line here was checked against the arithmetic that fills the column
 * (positions.js derivePosition, and the rows memo in Holdings.jsx) — a hover
 * that describes the number wrongly is the one thing worse than none.
 *
 * Plain words first. The term of art comes second, if at all, so somebody who
 * has never heard "Weinstein stage" still learns what the column is for.
 */
export const COLUMN_HINTS = {
  /* ---- shared ------------------------------------------------------- */
  /* Two levels of one classification, so they are worded as a pair: the
     second says it sits under the first, or the column reads as a rival
     answer to the same question. */
  sector: "What business the company is in — NSE's own classification in an "
    + "Indian book, Nasdaq's in a US one. Four names from one sector is one "
    + "idea with four tickers on it",
  industry: "The narrower group inside the sector — Petroleum Products within "
    + "Oil Gas & Consumable Fuels. Blank where the exchange publishes no "
    + "classification, which is every ETF and a few recent listings",
  entry_date: "The day you bought",
  entry_price: "The price you bought at",
  slPct: "How far your stop sat from your entry, as a percentage of the entry price",

  /* ---- Trades ------------------------------------------------------- */
  exit_date: "The day of the last sell. On a position sold in parts, the final one",
  heldDays: "Calendar days from entry to the last sell — or to today, if still held. "
    + "Blank when the entry date was estimated on import",
  stop_loss: "The stop you set at entry. The distance to it is what one R is worth",
  quantity: "Shares bought",
  exposure: "What the position cost: entry price × shares bought",
  avgExitPrice: "Average sell price. Sold in parts, each sell counts by the shares in it",
  exitPct: "How far the average sell price was from your entry",
  pnl: "Profit or loss after charges — and after MTF on a margin trade, unless you chose not to deduct it in Setup. For a position still held, includes what the unsold shares are "
    + "worth at the last price",
  r: "Profit or loss divided by the risk you took at entry. +2R means you made twice "
    + "what you risked; −1R means the stop was hit",
  charges: "Brokerage, STT, exchange and SEBI fees, stamp duty, GST and DP charges on this "
    + "trade — worked out by the app, or taken from your broker's file on import. Already "
    + "deducted from P&L. MTF is not in it",
  margin: "MTF on this trade — the interest with the pledge and unpledge charges. "
    + "Deducted from P&L and R, unless you chose not to in Setup",
  riskAmt: "Rupees between entry and stop, across the whole position. This is one R",
  pattern: "The base the stock broke out of — VCP, cup, flat base, pullback",
  distPivot: "How far above the pivot you actually bought. Small is tight, large is chasing",
  vol_pct_avg: "Volume on the breakout day as a share of the 30-day average. "
    + "100% is an ordinary day; below 100% is a thin breakout",
  weinstein_stage: "Weinstein stage at entry: 1 basing, 2 advancing, 3 topping, 4 declining. "
    + "Stage 2 is where breakouts are meant to happen",
  rs_rank: "Relative strength at entry, 1 to 99. How the stock had done against the "
    + "rest of the market — higher is stronger",
  mfe: "MFE — the best R the position reached while you held it, on closing prices",
  mae: "MAE — the worst R the position reached while you held it, on closing prices",

  /* ---- Holdings ----------------------------------------------------- */
  days: "Calendar days held so far",
  qtyOpen: "Shares you still hold",
  openPct: "How much of the original position you still hold",
  stop: "Where your stop is now",
  toStop: "How far the price is from your stop, as a percentage of today's price",
  buyValue: "What the shares you still hold cost: entry price × shares held",
  openRiskAmt: "What you would lose on the shares still held if the stop were hit now. "
    + "Zero once the stop has moved past your entry, or you have marked it at breakeven",
  netRiskR: "Open risk in R, less any profit already banked from part-sells. "
    + "At zero or below, this position can no longer cost you money overall",
  mark: "Current market price, from the last refresh",
  changePct: "How far the price has moved since you bought — not today's move",
  realisedPnl: "Profit already taken from part-sells, after charges and any MTF",
  unrealisedPnl: "What the shares still held are up or down at the current price, "
    + "less MTF so far",
  atR: "Where the price sits in R: how many times your original risk it has moved from entry",
};
