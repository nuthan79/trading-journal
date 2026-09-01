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

/** The wall of per-trade candlestick charts on Trades. Pro feature, later. */
export const SHOW_CHART_WALL = false;

/**
 * Deal winners and losers blind, and score the calls.
 *
 * ON, for testing on a real book — 36 closed trades carry a chart. Intended as
 * a paid feature, so expect this to go back to false; the code is written to
 * be switched either way rather than removed.
 *
 * Note this does NOT depend on SHOW_CHART_WALL. The drill's reveal renders a
 * TradeChart directly, so the "what happened" half works while the wall on
 * Trades stays hidden.
 */
export const SHOW_CHART_DRILL = true;
