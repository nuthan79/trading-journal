/**
 * Margin Trading Facility — what a position bought partly with the broker's
 * money costs to hold, and what the leverage did to the return.
 *
 * LEVERAGE IS THE BROKER'S OWN FIGURE: position value ÷ your money. At 2.35×,
 * ₹1,00,000 of yours buys ₹2,35,000 of stock and the broker funds the other
 * ₹1,35,000. That is how the MTF screen at the broker states it, so the number
 * can be copied across without converting anything.
 *
 * INTEREST IS QUOTED AS RUPEES PER LAKH PER DAY — ₹40 per lakh is 0.04% a day
 * — on the FUNDED amount only, never on your own money.
 *
 * SELLING PART OF IT STOPS THE INTEREST ON THAT PART. Each tranche is charged
 * from the entry date to the day it was sold; what is still held runs to
 * today. Counting the whole position to the last exit would bill a trader for
 * shares already gone, which on a position scaled out over weeks is most of
 * the interest.
 *
 * CALENDAR DAYS, counted from the dates as written. Weekends are days the money
 * is still borrowed.
 *
 * REFUSES AN ASSUMED ENTRY DATE, as every holding-period figure in this app
 * does: interest from a date the importer invented is a number that looks
 * measured and is not.
 */

const LAKH = 1e5;

/**
 * PLEDGE AND UNPLEDGE. Shares bought on MTF are pledged to the broker, and
 * unpledged to be sold: ₹18 once when the position is bought, ₹18 on every
 * sell — each sell is its own unpledge request. Flat fees, the figures this
 * journal's user pays; one place to change them if a broker's change.
 */
export const PLEDGE_FEE = 18;
export const UNPLEDGE_FEE = 18;

const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));

/* Parsed by hand and compared as UTC days, so the count cannot shift by one
   depending on the browser's timezone — the bug `new Date("YYYY-MM-DD")`
   brings everywhere else. */
const dayNo = (iso) => {
  const [y, m, d] = String(iso || "").slice(0, 10).split("-").map(Number);
  return y && m && d ? Date.UTC(y, m - 1, d) / 86400000 : NaN;
};
const daysBetween = (a, b) => Math.max(0, dayNo(b) - dayNo(a));

/** Is this trade on margin at all? Leverage of 1× borrows nothing. */
export const isMtf = (leverage) => Number.isFinite(num(leverage)) && num(leverage) > 1;

/**
 * THE ONE PLACE INTEREST IS WORKED OUT. Read by derivePosition (so P&L and R
 * are net of it), by realisationEvents (so each sell carries its own share into
 * the period tables) and by the form's figures. Three copies of this formula
 * would disagree the first time one of them was edited.
 *
 * Takes a trade row as stored — mtf_leverage, mtf_rate, entry_price,
 * entry_date, entry_date_source. Returns null for a trade not on margin, which
 * is every trade that has not been ticked, and costs them nothing.
 */
export function interestModel(t) {
  const L = num(t?.mtf_leverage);
  const r = num(t?.mtf_rate);
  const entry = num(t?.entry_price);
  if (!isMtf(L) || !(r > 0) || !(entry > 0)) return null;
  const known = !!t.entry_date && t.entry_date_source !== "assumed";
  const perShareDay = (entry * (1 - 1 / L) * r) / LAKH;
  return {
    perShareDay,
    /* False on an estimated entry date: no interest is charged against a date
       the importer invented, and the trade says so rather than guessing. */
    known,
    /** Interest on one sell: its shares, from entry to the day they went. */
    onSell: (e) => (known && e?.exit_date
      ? (num(e.quantity) || 0) * perShareDay * daysBetween(t.entry_date, e.exit_date)
      : 0),
    /* Fees do not depend on dates, so they apply even on an estimated one. */
    pledgeFee: PLEDGE_FEE,
    unpledgeFee: UNPLEDGE_FEE,
    /** Interest so far on what is still held. */
    onHeld: (qtyOpen, asOf) => (known && qtyOpen > 0
      ? qtyOpen * perShareDay * daysBetween(t.entry_date, asOf)
      : 0),
  };
}

/** The rate as a yearly percentage, for the hint beside the input. */
export const annualPct = (rate) => (Number.isFinite(num(rate)) ? (num(rate) * 365 * 100) / LAKH : NaN);

export function mtfFigures({
  entryPrice, quantity, entryDate, entryDateAssumed = false,
  exits = [], leverage, rate, riskAmt, pnl, asOf,
}) {
  const L = num(leverage);
  const r = num(rate);
  const entry = num(entryPrice);
  const qty = num(quantity);
  if (!isMtf(L) || !(entry > 0) || !(qty > 0)) return null;

  const position = entry * qty;
  const own = position / L;
  const funded = position - own;
  const fundedPerShare = entry * (1 - 1 / L);

  const sold = exits.reduce((a, e) => a + (num(e.quantity) || 0), 0);
  const openQty = Math.max(0, qty - sold);

  const hasRate = Number.isFinite(r) && r > 0;
  /* What the position costs to hold for one more day, on what is still held —
     and on the whole of it, which is the figure that frames the trade. */
  const perDayNow = hasRate ? (openQty * fundedPerShare * r) / LAKH : NaN;
  const perDayFull = hasRate ? (funded * r) / LAKH : NaN;

  let interest = NaN, why = "";
  if (!hasRate) why = "Add the interest rate to see what this costs";
  else if (!entryDate) why = "Needs an entry date";
  else if (entryDateAssumed) why = "Needs the real entry date — this one was estimated on import";
  else {
    const im = interestModel({
      mtf_leverage: L, mtf_rate: r, entry_price: entry, entry_date: entryDate,
      entry_date_source: entryDateAssumed ? "assumed" : "recorded",
    });
    interest = exits.reduce((a, e) => a + (num(e.quantity) > 0 ? im.onSell(e) : 0), 0)
      + im.onHeld(openQty, asOf);
  }

  /* The pledge on the way in, one unpledge per sell made so far. */
  const sells = exits.filter((e) => num(e.quantity) > 0).length;
  const fees = PLEDGE_FEE + UNPLEDGE_FEE * sells;

  const R = num(riskAmt);
  const P = num(pnl);
  const interestR = R > 0 && Number.isFinite(interest) ? interest / R : NaN;

  return {
    leverage: L, rate: r,
    position, own, funded,
    openQty, perDayNow, perDayFull,
    interest, interestR, why,
    fees, sells,
    /* Everything margin has cost so far, and as a share of the trade's R. */
    cost: Number.isFinite(interest) ? interest + fees : NaN,
    costR: R > 0 && Number.isFinite(interest) ? (interest + fees) / R : NaN,
    /* The frame a swing trader actually needs: how long can this be held
       before the borrowing has cost as much as the whole planned risk? */
    daysPerR: R > 0 && perDayFull > 0 ? R / perDayFull : NaN,
    /* How far the price of what is still held must rise just to pay the
       interest run up so far. */
    coverMovePct: openQty > 0 && Number.isFinite(interest)
      ? (interest / (openQty * entry)) * 100 : NaN,
    /* `pnl` arrives ALREADY net of interest — derivePosition takes it out —
       so it is divided as it stands. Subtracting interest again here was right
       for the first version, when P&L did not know about margin, and would
       now count it twice. */
    returnOnOwnPct: Number.isFinite(P) && own > 0 ? (P / own) * 100 : NaN,
    returnOnPositionPct: Number.isFinite(P) && position > 0 ? (P / position) * 100 : NaN,
  };
}
