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

/* The Trades section in Setup — Import trades and Add missing stops. Hidden
   since Import got its own tab and the stops queue is linked from the top bar:
   two ways in to each, and Setup is for settings. Built and working; set true
   to bring it back. */
export const SHOW_SETUP_TRADES = false;

/**
 * The region switch — India, the US, and whatever follows.
 *
 * ON since Phase 5. The dropdown sits beside New trade, every screen shows
 * one book, and the choice is remembered on the profile. Turning it OFF again
 * pins the whole app to India, which is what every existing row is: the
 * filter falls back to IN, the switch disappears, and nothing else changes.
 *
 * A REGION IS A SEPARATE BOOK — see the note in regions.js. Nothing in the
 * app may ever total across two currencies, flag on or off.
 */
export const SHOW_REGIONS = true;

/**
 * The last ten closed trades, beside the last seven days, on Process.
 *
 * ON, unlike the rest of this file — a trial the user asked for and will keep
 * or drop after living with it. It is a flag anyway so that dropping it is
 * one word here rather than an edit to Review.jsx, and so the probes keep
 * running against it either way.
 *
 * The two strips answer the same questions of different samples. A week is
 * the calendar's idea of recent and goes quiet when you do; ten trades is
 * always ten trades, and the dates it spans say how fast you have been
 * trading without being asked.
 */
export const SHOW_LAST_TEN = true;

/**
 * The Position size grouping on Analysis → What works.
 *
 * OFF because it misleads. Position size is not an independent choice — it is
 * risk divided by stop width, exactly, on every trade — so the tab invites a
 * reader to conclude that big positions pay, when the honest question is
 * whether the RISK was right. "Risk % of capital" and "Risk in rupees" ask
 * that directly and are the two the user should be deciding on.
 *
 * Built, probed and kept: the concentration question it was meant to answer —
 * that risk-based sizing assumes the stop holds — is real and may yet get a
 * home somewhere it does not read as an edge claim. Unhide, never rebuild.
 */
export const SHOW_POSITION_SIZE_DIM = false;

/**
 * The "Your exits end in very different places" card on Analysis → Process.
 *
 * OFF because the spread it reports is a definition, not a finding. You record
 * "sold into strength" BECAUSE the trade was working and "stop hit" BECAUSE it
 * was not, so grouping outcomes by the reason recorded for the exit is
 * grouping outcomes by the outcome. On the book that prompted this: sold into
 * strength +4.34R at 100% won, stop hit −0.97R at 5% won — a 5.53R spread that
 * could not have come out any other way.
 *
 * Kept because the question underneath is real and answerable: among the
 * reasons that ARE alternatives to each other on the same trade — trailing
 * stop, 20 SMA, discretionary — which lets the most run? That needs the
 * reasons partitioned into the ones you chose and the ones that chose you,
 * which nothing records yet. Unhide when it does.
 */
export const SHOW_EXIT_METHOD_CARD = false;
