import { noStopOnRecord } from "./stops";
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
 * First of these that is a usable number.
 *
 * Not `a ?? b`: that falls through only on null and undefined, so an empty
 * string sails past it and lands in n(), which returns NaN — and the fallback
 * never runs. The trade form carries "" for a field the user hasn't filled,
 * so a stop chain written with `??` silently produced a NaN 1R and blanked
 * the risk preview while the position value beside it went on working.
 */
const firstNum = (...vals) => {
  for (const v of vals) {
    const x = n(v);
    if (isFinite(x)) return x;
  }
  return NaN;
};

/**
 * Full picture of a position, open, partial or closed.
 *
 * `t.exits` is an array of { exit_date, quantity, price, reason, charges }.
 * A trade with no exits behaves exactly as it did before this existed, so old
 * code paths and old rows keep working.
 */
/**
 * THREE STATUSES, TWO STATES. A part-sold position is OPEN.
 *
 * `status` has three values — open, partial, closed — because the schema needs
 * to know a position was sold down. But there are only two states a screen
 * ever asks about: is size still on the table, or is this finished? A part-sold
 * position still has shares, still has risk running, and still wants a mark.
 *
 * WHY THIS IS A FUNCTION AND NOT A COMPARISON. The rule was written out by
 * hand in six places — the mark-on-load pass, the open list, the topbar count,
 * the position derivation, TradeForm and Holdings — and the seventh got it
 * wrong: the Trades screen's Open tab tested `status === "open"` alone, so a
 * part-sold position appeared in neither Open nor Closed and fell out of the
 * screen entirely while sitting in plain view on Holdings.
 *
 * Same shape as hasRealStop in stops.js, one file later. A rule with more than
 * one copy has a wrong copy; it is only a question of which screen finds it.
 *
 * The SQL twin is `.in("status", ["open", "partial"])` in db.js, which cannot
 * import this and has to be changed alongside it.
 */
export const isOpen = (t) => !!t && (t.status === "open" || t.status === "partial");

/** Finished. Nothing left on the table. */
export const isClosed = (t) => !!t && t.status === "closed";

/** Sold down but not out — the state that has to be asked for by name. */
export const isPartial = (t) => !!t && t.status === "partial";

/**
 * An import the app noticed might be a second copy of a position already here.
 *
 * Two conditions, and both have to be read together — which is exactly why
 * this is one function rather than the test written out wherever it is needed.
 * A trade keeps `possible_duplicate_of` forever as a record of what was
 * noticed; the flag stops showing once it is acknowledged. Testing only the
 * pointer would relight every flag anybody has ever dismissed.
 *
 * The pointer also nulls itself when the position it names is deleted (046),
 * which is the other way this resolves: the trader removed the duplicate.
 */
export const isFlagged = (t) =>
  !!t?.possible_duplicate_of && !t?.duplicate_ack_at;

/**
 * A closed position broken into the moments it actually paid out.
 *
 * WHY THIS EXISTS. `exit_date` on a trade is its LAST tranche — migration 007
 * mirrors it there for convenience — and every period table asked that one
 * date where the money landed. So a position sold across a financial-year
 * boundary had its whole result credited to the later year: on one real book,
 * ₹5.77 lakh net sitting in the wrong FY across 48 tranches. The totals were
 * never wrong, only the buckets, which is exactly the kind of wrong that
 * survives a reconciliation.
 *
 * THE TRANCHES SUM TO THE POSITION, EXACTLY, AND EACH ONE IS RIGHT ON ITS OWN.
 * Two different requirements, and the second is easy to lose while satisfying
 * the first — see the note on the charge below. The parts must add back to
 * `realisedPnl` to the rupee, or a year's rows stop summing to the all-time
 * total, which is the one figure three screens already agree on. And each part
 * must match what the trade detail panel shows for that same sell, or the
 * periods and the drill-down disagree with no way to tell which is right.
 *
 * R per tranche is the tranche's P&L over the position's 1R. Risk is fixed at
 * entry for the whole position, so these sum to `realisedR` with no weighting
 * to argue about.
 */
export function realisationEvents(t) {
  const exits = t?.exits || [];
  if (!exits.length) return [];

  /**
   * ALL OR NOTHING. A tranche with no date cannot be placed in a period and a
   * tranche with no price cannot be valued — and dropping one silently is
   * money vanishing from every total built on these. Measured on a fixture:
   * one undated tranche took ₹2,000 out of a ₹3,500 position and the periods
   * stopped summing to the book.
   *
   * So if any part of the position cannot be split honestly, none of it is.
   * The caller falls back to whole-trade attribution, which is where it was
   * before and is at worst in the wrong period rather than absent.
   */
  const usable = exits.every((e) =>
    e.exit_date && isFinite(n(e.price)) && isFinite(n(e.quantity)));
  const total = n(t.realisedPnl);
  if (!usable || !isFinite(total)) return [];

  const entry = n(t.entry_price);
  const dir = t.side === "short" ? -1 : 1;
  const gross = exits.map((e) => (n(e.price) - entry) * n(e.quantity) * dir);
  const grossSum = sum(gross);

  /**
   * EACH SELL PAYS ITS OWN CHARGE. ONLY WHAT IS LEFT OVER IS SPREAD.
   *
   * The total is derived rather than read — grossSum − realisedPnl is what the
   * position actually paid, whatever `charges` means on the object handed in,
   * which on a DERIVED trade is the sum of both kinds. Reading that field
   * directly is what made the first version subtract exit charges twice.
   *
   * But deriving the total is not a licence to forget the parts. The second
   * version spread the whole thing pro-rata by quantity, which sums correctly
   * and is WRONG per sell: WABAG's three tranches carry ₹162, ₹97.17 and
   * ₹24.86 of their own, and spreading ₹284.03 by quantity moved ₹7.55 off the
   * first sell onto the other two. The trade detail panel shows each sell's
   * real charge, so the periods and the drill-down would have disagreed about
   * the same tranche by a few rupees, for ever, with no way to tell which was
   * right.
   *
   * So a tranche pays its own charge, and only the REMAINDER — the entry-side
   * and legacy figure on the trade row, which belongs to no single sell — is
   * spread by quantity. The last tranche takes what is left of it, so the sum
   * is exact to the paisa. When every charge is already on the tranches, as it
   * is on an imported book, the remainder is zero and each sell is untouched.
   */
  const chargeTotal = grossSum - total;
  const ownSum = sum(exits.map((e) => n(e.charges) || 0));
  const spare = chargeTotal - ownSum;
  const qtyOut = sum(exits.map((e) => n(e.quantity) || 0));
  const risk = n(t.riskAmt);

  let allocated = 0;
  return exits.map((e, i) => {
    const q = n(e.quantity) || 0;
    const last = i === exits.length - 1;
    const extra = last ? spare - allocated
      : spare * (qtyOut > 0 ? q / qtyOut : 1 / exits.length);
    allocated += extra;
    const charge = (n(e.charges) || 0) + extra;
    const pnl = gross[i] - charge;
    return {
      date: String(e.exit_date).slice(0, 10),
      pnl,
      /* What this sell cost, carried alongside what it made — so a period can
         report its charges the same way it reports its money, split on the
         same dates, rather than being handed a position-level figure that
         belongs to no single period. */
      charge,
      /* Risk is fixed at entry for the whole position, so these sum to
         realisedR with no weighting to argue about. */
      r: risk > 0 ? pnl / risk : NaN,
      qty: q,
      trade: t,
    };
  });
}

export function derivePosition(t, accountSize) {
  const dir = t.side === "short" ? -1 : 1;
  const entry = n(t.entry_price);
  const qty = n(t.quantity);                                    // original size
  /**
   * One stop. It sets 1R and it is the live distance, because it is the same
   * number.
   *
   * There were two: initial_stop_loss defined 1R and stop_loss was where the
   * stop stood now, so trailing could never rebase R. That is worth having in
   * a journal that follows a stop as it moves. This one does not — trailing
   * happens at the broker, and the stop written here is the risk that was
   * taken. The only reason it ever changes is that it was wrong.
   *
   * Reading stop_loss first is what makes an old row heal itself: a trade
   * still carrying a stale initial_stop_loss from before this shows the stop
   * the trader last set, rather than the one they had already corrected.
   */
  /**
   * NO STOP ON RECORD MEANS NO STOP HERE, WHATEVER THE COLUMN STILL HOLDS.
   *
   * `stop_loss` keeps the importer's leftover number when a trade is marked
   * this way — the column is nullable but there was no reason to erase what
   * was there, and erasing it would lose the number somebody might later
   * recognise. But reading it produces a 1R, and from that an R, an SL% and a
   * risk figure on a trade whose whole point is that none of those are known.
   *
   * That shipped: the trades table showed "no stop" beside a stop price of
   * 6928.17, a 7.0% SL and −0.27R on the same row, and the footer went on
   * totalling R over 1185 trades that had just been declared unmeasurable.
   * The findings had already excluded them, so the screens disagreed with
   * each other about the same trade.
   *
   * An ASSUMED stop still computes, deliberately — that is what the bulk fill
   * is for, so the plots work at all while the real numbers are recovered.
   * The two states differ here precisely because they mean different things.
   */
  const stop = noStopOnRecord(t) ? NaN : firstNum(t.stop_loss, t.initial_stop_loss);

  // Exit tranches, oldest first.
  //
  // If the trade_exits table doesn't exist yet — this file can ship ahead of
  // its migration — fall back to the single exit recorded on the trade row
  // itself. Without this a closed trade would show no tranches, therefore
  // nothing sold, therefore "open" with no R, silently, for every closed
  // trade in the journal.
  const rawExits = t.exits;
  const exits =
    Array.isArray(rawExits) && rawExits.length
      ? [...rawExits].sort((a, b) => new Date(a.exit_date) - new Date(b.exit_date))
      : t.status === "closed" && n(t.exit_price) > 0
      ? [{
          exit_date: t.exit_date,
          quantity: qty,
          price: n(t.exit_price),
          reason: t.exit_reason,
          charges: 0,          // already counted in t.charges below
          synthetic: true,     // came from the legacy columns, not a tranche row
        }]
      : [];

  /* ---- risk, fixed at entry ---------------------------------------- */
  const riskPerShare = Math.abs(entry - stop);
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
    entry > 0 ? ((entry - stop) / entry) * 100 * dir : NaN;
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

  /**
   * How far the price moved between entry and the average exit, signed so a
   * short that fell is positive.
   *
   * The price move, not the return: charges are not in it, and neither is the
   * part of the position still open. Sitting beside the exit price that is
   * what it is read as — "sold at 902.50, which was eighteen percent up" —
   * where the money question is already answered by P&L two columns over.
   *
   * Guarded on entry, because shares that arrived free have an entry of zero
   * and every percentage against nothing is infinite.
   */
  const exitPct =
    entry > 0 && isFinite(avgExitPrice)
      ? ((avgExitPrice - entry) / entry) * 100 * dir
      : NaN;

  /* ---- unrealised on whatever is left ------------------------------ */
  const mark = n(t.last_price);
  const hasMark = isFinite(mark);
  const unrealisedPnl =
    qtyOpen > 0 && hasMark ? (mark - entry) * qtyOpen * dir : NaN;
  const unrealisedR =
    riskAmt > 0 && isFinite(unrealisedPnl) ? unrealisedPnl / riskAmt : NaN;

  /* ---- combined ---------------------------------------------------- */
  // Careful with the zero case: `0 || NaN` evaluates to NaN, so a partial
  // position whose banked profit exactly offsets its open loss would report
  // no result at all. Decide on whether anything is known, not on truthiness.
  const knowsRealised = isFinite(realisedPnl);
  const knowsUnrealised = isFinite(unrealisedPnl);
  const pnl =
    status === "closed"
      ? realisedPnl
      : knowsRealised || knowsUnrealised
      ? (knowsRealised ? realisedPnl : 0) + (knowsUnrealised ? unrealisedPnl : 0)
      : NaN;
  const r = riskAmt > 0 && isFinite(pnl) ? pnl / riskAmt : NaN;

  /* ---- risk still live --------------------------------------------- */
  // Once you've banked profit and trailed the stop, what remains at risk is
  // not the original 1R. This is the number that belongs in "open risk".
  // A stop trailed past entry isn't risk, it's a floor under a gain, so the
  // distance to it must not be counted as money still on the line.
  /**
   * Acknowledging the breakeven flag says the broker stop has been moved to
   * entry, and a position stopped at entry cannot lose. So it stops counting.
   *
   * This is the one thing the acknowledgement changes, and it changes nothing
   * else: stop_loss is untouched, so 1R, stop width and every R already
   * recorded stay exactly as they were. That separation is the point. The risk
   * TAKEN at entry is history and must not move; the risk STILL RUNNING is a
   * fact about now, and the trader has just told us what it is.
   *
   * Without this the dial argued with the flag — a hollow flag saying nothing
   * left to lose beside a dial counting a full R against it.
   */
  const atBreakeven = !!t.breakeven_ack_at;
  const openRiskAmt =
    qtyOpen > 0 && !stopAboveEntry && !atBreakeven
      ? Math.abs(entry - stop) * qtyOpen
      : 0;
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
  // Assumed dates do not count days — see the note in calc.js and migration
  // 036. Both paths compute this, so both have to refuse it, or the number
  // reappears depending on which one rendered the screen.
  const heldDays = t.entry_date && t.entry_date_source !== "assumed"
    ? Math.round((endRef - new Date(t.entry_date)) / 86400000)
    : NaN;

  return {
    // sizing
    riskPerShare, riskAmt, riskPct, exposure,
    slPct, slPctCurrent, stopAboveEntry,
    // state
    status, qtyExited, qtyOpen, pctClosed, exitsCount: exits.length,
    // money
    realisedPnl, realisedR, avgExitPrice, exitPct, charges,
    unrealisedPnl, unrealisedR, mark, hasMark,
    pnl, r,
    // live risk
    openRiskAmt, netRiskR, isRiskFree, stop,
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

  /**
   * The split IS the finding, so it is the chart.
   *
   * One average hides two opposite acts. Selling part of a loser banks
   * something before it gets worse; selling part of a winner gives up the tail
   * that funds the whole method. A single "scaling out costs 0.4R" number
   * averages a defensible habit with a costly one — two bars keep them apart,
   * and they nearly always point opposite ways.
   */
  const shared = {
    lede: "Every trade you sold in pieces, compared against what the same " +
          "position would have returned held whole to your final exit. Above " +
          "the line the partials protected you; below it they cost you.",
    chart: {
      type: "bars",
      unit: "R",
      rows: [
        ...(s.avgDiffOnWinners != null
          ? [{ label: "On your winners", value: s.avgDiffOnWinners }] : []),
        ...(s.avgDiffOnLosers != null
          ? [{ label: "On your losers", value: s.avgDiffOnLosers }] : []),
      ],
      axisNote: "R gained or given up per trade by taking partials",
    },
    figures: [
      { value: `${s.avgDiffR > 0 ? "+" : "\u2212"}${Math.abs(s.avgDiffR)}R`, label: "per scaled trade" },
      { value: `${s.helped} / ${s.hurt}`, label: "helped / hurt" },
      { value: `${s.trades}`, label: "trades scaled out of" },
    ],
  };

  if (s.verdict === "costly") {
    return {
      ...shared,
      id: "scale-out-costly",
      severity: "warning",
      title: "Scaling out is clipping your winners",
      verdict:
        "Separate the two motives before changing anything. Selling to cut " +
        "risk after a move is defensible; selling because an open profit feels " +
        "uncomfortable is the one costing you here.",
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
      ...shared,
      id: "scale-out-good",
      severity: "good",
      title: "Scaling out is earning its place",
      verdict:
        "Worth keeping as it is. This is the rarer outcome — for most breakout " +
        "records the partials cost more than they save.",
      detail:
        `Partial exits added ${s.avgDiffR}R per trade over holding whole across ${s.trades} scaled trades ` +
        `(${s.totalDiffR}R total). You're banking strength before it gives back.`,
      evidence: ev,
    };
  }
  return {
    ...shared,
    id: "scale-out-neutral",
    severity: "watch",
    title: "Scaling out is roughly break-even",
    verdict:
      "Judge it on whether it keeps you in trades you would otherwise close " +
      "early, not on the return — on the return it is doing nothing either way.",
    detail:
      `Across ${s.trades} scaled trades, taking partials came out within ${Math.abs(s.avgDiffR)}R per trade of ` +
      `holding whole. It isn't costing you, but it isn't adding either — so treat it as a risk-management ` +
      `preference rather than a return driver, and judge it on whether it keeps you in trades you'd otherwise exit early.`,
    evidence: ev,
  };
}
