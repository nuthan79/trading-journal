/**
 * Tranched positions.
 *
 * ONE DECISION GOVERNS EVERYTHING HERE: 1R is fixed at entry, on the full
 * position, using the stop you set when you opened it.
 *
 *     1R = |entry − initial_stop| × original_quantity
 *
 * It never moves. Not when you trail the stop, not when you sell a third into
 * strength. That is the money you actually put at risk when you took the trade,
 * and it is the only denominator that keeps expectancy comparable across trades
 * you scaled out of and trades you didn't.
 *
 * The tempting alternative — recomputing risk as the position shrinks — makes
 * every R figure drift after the fact and quietly rewards you for the act of
 * selling rather than for the outcome.
 */

const n = (v) => (v === "" || v == null ? NaN : Number(v));
const sum = (a) => a.reduce((x, y) => x + y, 0);

/**
 * Full picture of a position, open, partial or closed.
 *
 * `t.exits` is an array of { exit_date, quantity, price, reason, charges }.
 * A trade with no exits behaves exactly as it did before this existed, so old
 * code paths and old rows keep working.
 */
export function derivePosition(t, accountSize) {
  const dir = t.side === "short" ? -1 : 1;
  const entry = n(t.entry_price);
  const qty = n(t.quantity);                                    // original size
  const initialStop = n(t.initial_stop_loss ?? t.stop_loss);    // defines 1R
  const currentStop = n(t.stop_loss ?? t.initial_stop_loss);    // for live distance

  const exits = [...(t.exits || [])].sort(
    (a, b) => new Date(a.exit_date) - new Date(b.exit_date)
  );

  /* ---- risk, fixed at entry ---------------------------------------- */
  const riskPerShare = Math.abs(entry - initialStop);
  const riskAmt = riskPerShare * qty;                            // 1R, immutable
  const riskPct = accountSize > 0 ? (riskAmt / accountSize) * 100 : NaN;
  const exposure = entry * qty;

  /* ---- stop width -------------------------------------------------- */
  // How far the stop sits from entry, as a percent of entry. Fixed at entry
  // and worth watching: a stop much beyond ~10% needs a correspondingly
  // larger winner to pay for it, and usually says more about the entry or the
  // base than about how much room the trade needs.
  const slPct = entry > 0 ? (riskPerShare / entry) * 100 : NaN;

  // Where the stop is NOW, signed against entry. Positive means still below
  // entry and genuinely at risk; negative means trailed above entry, so the
  // remaining position can no longer lose money.
  const slPctCurrent =
    entry > 0 ? ((entry - currentStop) / entry) * 100 * dir : NaN;
  const stopAboveEntry = isFinite(slPctCurrent) && slPctCurrent < 0;

  /* ---- how much is still on ---------------------------------------- */
  const qtyExited = sum(exits.map((e) => n(e.quantity) || 0));
  const qtyOpen = Math.max(0, qty - qtyExited);
  const status =
    qtyExited <= 0 ? "open" : qtyOpen > 1e-6 ? "partial" : "closed";
  const pctClosed = qty > 0 ? (qtyExited / qty) * 100 : NaN;

  /* ---- realised ---------------------------------------------------- */
  const exitCharges = sum(exits.map((e) => n(e.charges) || 0));
  const tradeCharges = n(t.charges) || 0;                        // entry-side / legacy
  const charges = exitCharges + tradeCharges;

  const grossRealised = sum(
    exits.map((e) => (n(e.price) - entry) * n(e.quantity) * dir)
  );
  const realisedPnl = qtyExited > 0 ? grossRealised - charges : NaN;
  const realisedR = riskAmt > 0 && isFinite(realisedPnl) ? realisedPnl / riskAmt : NaN;
  const avgExitPrice = qtyExited > 0
    ? sum(exits.map((e) => n(e.price) * n(e.quantity))) / qtyExited
    : NaN;

  /* ---- unrealised on whatever is left ------------------------------ */
  const mark = n(t.last_price);
  const hasMark = isFinite(mark);
  const unrealisedPnl =
    qtyOpen > 0 && hasMark ? (mark - entry) * qtyOpen * dir : NaN;
  const unrealisedR =
    riskAmt > 0 && isFinite(unrealisedPnl) ? unrealisedPnl / riskAmt : NaN;

  /* ---- combined ---------------------------------------------------- */
  const pnl =
    status === "closed"
      ? realisedPnl
      : (isFinite(realisedPnl) ? realisedPnl : 0) +
        (isFinite(unrealisedPnl) ? unrealisedPnl : 0) || NaN;
  const r = riskAmt > 0 && isFinite(pnl) ? pnl / riskAmt : NaN;

  /* ---- risk still live --------------------------------------------- */
  // Once you've banked profit and trailed the stop, what remains at risk is
  // not the original 1R. This is the number that belongs in "open risk".
  const openRiskAmt =
    qtyOpen > 0 ? Math.abs(entry - currentStop) * qtyOpen : 0;
  const bankedAgainstRisk =
    riskAmt > 0 && isFinite(realisedPnl) ? realisedPnl / riskAmt : 0;
  // Negative means the remainder can no longer produce a losing trade overall
  const netRiskR = riskAmt > 0 ? openRiskAmt / riskAmt - Math.max(0, bankedAgainstRisk) : NaN;
  const isRiskFree = isFinite(netRiskR) && netRiskR <= 0;

  /* ---- entry context ----------------------------------------------- */
  const pivot = n(t.pivot_price);
  const distPivot = pivot > 0 ? ((entry - pivot) / pivot) * 100 * dir : NaN;

  /* ---- timing ------------------------------------------------------ */
  const firstExit = exits.length ? exits[0].exit_date : null;
  const lastExit = exits.length ? exits[exits.length - 1].exit_date : null;
  const endRef = status === "closed" && lastExit ? new Date(lastExit) : new Date();
  const heldDays = t.entry_date
    ? Math.round((endRef - new Date(t.entry_date)) / 86400000)
    : NaN;

  return {
    // sizing
    riskPerShare, riskAmt, riskPct, exposure,
    slPct, slPctCurrent, stopAboveEntry,
    // state
    status, qtyExited, qtyOpen, pctClosed, exitsCount: exits.length,
    // money
    realisedPnl, realisedR, avgExitPrice, charges,
    unrealisedPnl, unrealisedR, mark, hasMark,
    pnl, r,
    // live risk
    openRiskAmt, netRiskR, isRiskFree, currentStop, initialStop,
    // context
    distPivot, heldDays, firstExit, lastExit,
    exits,
  };
}

/**
 * Was scaling out worth it?
 *
 * For each fully-closed trade with more than one tranche, compares what you
 * actually made against what the same position would have returned held whole
 * to the final exit price. Positive means the scale-out protected you;
 * negative means it clipped a runner.
 *
 * This is the question that matters most in a breakout system, because the
 * whole approach is funded by a small number of large winners. Selling a third
 * at +2R feels responsible and is sometimes exactly right — but if it is
 * systematically costing you more than it saves, that shows up here and
 * nowhere else.
 */
export function scaleOutEffect(closedTrades) {
  const scaled = closedTrades.filter(
    (t) => (t.exits?.length || 0) > 1 && isFinite(t.r) && t.riskAmt > 0
  );
  if (scaled.length < 6) return null;

  const rows = scaled.map((t) => {
    const dir = t.side === "short" ? -1 : 1;
    const entry = n(t.entry_price);
    const finalPrice = n(t.exits[t.exits.length - 1].price);
    const heldWholeR = ((finalPrice - entry) * n(t.quantity) * dir) / t.riskAmt;
    return {
      id: t.id,
      symbol: t.symbol,
      actualR: t.r,
      heldWholeR,
      diff: t.r - heldWholeR,
      tranches: t.exits.length,
    };
  });

  const diffs = rows.map((x) => x.diff);
  const avgDiff = sum(diffs) / diffs.length;
  const helped = rows.filter((x) => x.diff > 0.05).length;
  const hurt = rows.filter((x) => x.diff < -0.05).length;

  // Split by outcome: scaling out of losers and winners are different acts
  const onWinners = rows.filter((x) => x.heldWholeR > 0);
  const onLosers = rows.filter((x) => x.heldWholeR <= 0);

  return {
    trades: rows.length,
    avgDiffR: +avgDiff.toFixed(2),
    totalDiffR: +sum(diffs).toFixed(1),
    helped, hurt,
    avgDiffOnWinners: onWinners.length
      ? +(sum(onWinners.map((x) => x.diff)) / onWinners.length).toFixed(2)
      : null,
    avgDiffOnLosers: onLosers.length
      ? +(sum(onLosers.map((x) => x.diff)) / onLosers.length).toFixed(2)
      : null,
    verdict:
      avgDiff > 0.15 ? "protective" : avgDiff < -0.15 ? "costly" : "neutral",
    rows,
  };
}

/**
 * A finding for the review page, in the same shape as the others in
 * analysis.js so it drops straight into reviewFindings().
 */
export function scaleOutFinding(closedTrades) {
  const s = scaleOutEffect(closedTrades);
  if (!s) return null;

  const ev = {
    scaledTrades: s.trades,
    avgDifferenceR: s.avgDiffR,
    totalDifferenceR: s.totalDiffR,
    timesHelped: s.helped,
    timesHurt: s.hurt,
    avgOnWinners: s.avgDiffOnWinners,
    avgOnLosers: s.avgDiffOnLosers,
  };

  if (s.verdict === "costly") {
    return {
      id: "scale-out-costly",
      severity: "warning",
      title: "Scaling out is clipping your winners",
      detail:
        `Across ${s.trades} trades you scaled out of, taking partials returned ${s.avgDiffR}R per trade ` +
        `less than holding the whole position to your final exit would have — ${s.totalDifferenceR ?? s.totalDiffR}R in total. ` +
        `It helped on ${s.helped} and hurt on ${s.hurt}. In a breakout system the outsized winners fund everything ` +
        `else, so trimming them systematically changes the arithmetic of the whole approach. ` +
        `Worth separating the two motives: selling to reduce risk after a move is defensible; selling because ` +
        `an open profit feels uncomfortable is the thing to fix.`,
      evidence: ev,
    };
  }
  if (s.verdict === "protective") {
    return {
      id: "scale-out-good",
      severity: "good",
      title: "Scaling out is earning its place",
      detail:
        `Partial exits added ${s.avgDiffR}R per trade over holding whole across ${s.trades} scaled trades ` +
        `(${s.totalDiffR}R total). You're banking strength before it gives back.`,
      evidence: ev,
    };
  }
  return {
    id: "scale-out-neutral",
    severity: "watch",
    title: "Scaling out is roughly break-even",
    detail:
      `Across ${s.trades} scaled trades, taking partials came out within ${Math.abs(s.avgDiffR)}R per trade of ` +
      `holding whole. It isn't costing you, but it isn't adding either — so treat it as a risk-management ` +
      `preference rather than a return driver, and judge it on whether it keeps you in trades you'd otherwise exit early.`,
    evidence: ev,
  };
}
