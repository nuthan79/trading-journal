/**
 * Features that are built and not shown.
 *
 * WHY THEY ARE FLAGS AND NOT BRANCHES. Each of these works, is probed, and is
 * held back for a reason that has nothing to do with readiness — two are
 * intended as paid features and one is not wanted for users yet. Kept on main
 * behind a constant, the code stays live and the probes keep running against
 * it. On a branch or deleted, the parts that would rot are exactly the ones
 * nothing else references: a column list, a window rule, a deck builder.
 *
 * Turning one on is one word. Each is gated in TWO places where a view is
 * involved — the control that opens it and the body that renders it — so no
 * stale piece of state can route somebody into a screen with no way back.
 *
 * Nothing is paid for while a flag is off: the chart wall's library is a
 * dynamic import that lands in its own chunk no route lists as eager.
 */

/**
 * The CSV download on Holdings. Not wanted for users yet.
 *
 * Lived as its own constant at the top of Holdings.jsx until this file
 * existed, and then stayed there — so "the one place features are held back"
 * was true of two flags out of three, which is the sort of claim that quietly
 * stops being worth reading.
 */
export const SHOW_HOLDINGS_CSV = false;

/** The wall of per-trade candlestick charts on Trades. Pro feature, later. */
export const SHOW_CHART_WALL = false;

/**
 * Deal winners and losers blind, and score the calls. Pro feature, later.
 *
 * Was briefly on to test against a real book of 36 charted trades, and is back
 * off. Independent of SHOW_CHART_WALL: the reveal renders a TradeChart
 * directly, so turning this on alone brings the "what happened" half with it.
 *
 * Needs migration 045, which is already applied to the live database.
 */
export const SHOW_CHART_DRILL = false;
