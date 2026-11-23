/**
 * When prices were last asked for, shared by everything that asks.
 *
 * The layout marks open positions as the app loads, and Holdings refreshes
 * them every few minutes while the market is open. Without one clock between
 * them, landing on Holdings straight after a load would ask twice for the
 * same prices inside a minute — the server caches quotes for 60 seconds, so
 * the second request buys nothing and spends the shared Yahoo allowance.
 *
 * Module state, so it lives for the page load: a fresh visit starts at zero.
 */
let last = 0;

/** Every five minutes while the market is open. A swing journal's prices are
    for unrealised P&L and distance to stop, not for entries. */
export const LIVE_EVERY_MS = 5 * 60 * 1000;

export const noteMarked = (at = Date.now()) => { last = at; };
export const markedAgo = (now = Date.now()) => now - last;
