"use client";

/**
 * Whose browser storage this is.
 *
 * TWO ACCOUNTS, ONE BROWSER. `localStorage` belongs to the origin, not to the
 * person signed in, so every preference and every draft this app kept was
 * shared by every account used in that browser. Reported from the column
 * picker: two accounts set up with different columns, and signing out of one
 * and into the other showed the first one's choice.
 *
 * The columns were the mild half. Drafts are restored AUTOMATICALLY — the app
 * opens the trade form and says "Restored an unsaved trade" — so a half-typed
 * trade, or an unsaved Setup with somebody's broker rates and account size in
 * it, would open by itself inside the next account to sign in on that machine.
 * On a shared computer that is one person's data appearing in another's
 * session, unasked.
 *
 * SCOPED AT THE STORAGE BOUNDARY, NOT AT THE CALL SITES. The hooks that touch
 * storage run all over the app, and a rule applied in twenty places is applied
 * in nineteen eventually. `scopedKey` is called inside useColumnPrefs,
 * useAutosave and the handful of remembered folds, so nothing above them has
 * to know, exactly as `activeRegion` works for the formatters.
 *
 * WHY A MODULE-LEVEL HOLDER rather than threading the id through props: the
 * same reason regions.js holds the active book. The app layout renders nothing
 * until the session resolves, so by the time any screen reads storage the id
 * is known — and it is set during the layout's render, before any child of it
 * runs an initializer.
 *
 * NOT EVERYTHING SHOULD BE SCOPED. `splitCache` stays shared on purpose: a
 * 10:1 split is a fact about the stock and about nobody's account, so two
 * people on one machine may as well answer it once. `FirstWeek` already builds
 * its own key from the user id and keeps it.
 */

let currentUser = null;

/** Told once by the app layout, during render. */
export function setStorageUser(id) {
  currentUser = id ? String(id) : null;
}

export function storageUser() {
  return currentUser;
}

/**
 * The key this account should read and write.
 *
 * Signed out there is no account to separate, and "anon" keeps that case
 * working rather than throwing — the first-run draft is written before a
 * profile exists. The suffix is a marker as well as a scope: `sweepLegacy`
 * below recognises the unscoped keys by its absence.
 */
export const scopedKey = (name) => `${name}::${currentUser || "anon"}`;

/**
 * The keys written before any of this, removed once.
 *
 * Not a pattern match — an explicit list. A sweep that guessed from a prefix
 * would eventually take something nobody thought about, and this runs in
 * everybody's browser exactly once with no way to undo it.
 *
 * Two reasons it runs at all rather than leaving them. They are unreadable
 * now, so they are litter that never expires; and, more to the point, the
 * drafts among them are the very ones sitting in a shared browser today. A
 * fix that stops NEW leaks while leaving the existing one on disk is half a
 * fix.
 *
 * The cost is one reset: saved column choices go back to their defaults on the
 * next visit, once. Carrying them over would mean guessing which account they
 * belonged to, and guessing wrong is how the bug started.
 */
/* `ledgerr:show-as` is NOT here. The rupee/dollar view is per browser on
   purpose — how you are reading the screen, not whose journal it is — so
   it has no unscoped version to clean up. */
const LEGACY_EXACT = [
  "ledgerr:headline-numbers-open",
  "ledgerr:form-setup-open",
  "ledgerr:holdings-columns",          // the pre-region column key
  "diary-draft-v1",
  "trade-draft-v1",
  "settings-draft-v1",
  "first-run-draft-v1",
];
const LEGACY_PREFIX = "ledgerr:columns:";

export function sweepLegacy() {
  try {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.includes("::")) continue;      // already scoped, leave it
      if (LEGACY_EXACT.includes(k) || k.startsWith(LEGACY_PREFIX)) doomed.push(k);
    }
    /* Collected first: removing while iterating by index skips entries. */
    for (const k of doomed) localStorage.removeItem(k);
    return doomed.length;
  } catch {
    return 0;                                     // private mode, nothing to sweep
  }
}
