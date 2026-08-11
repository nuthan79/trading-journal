"use client";

/**
 * Events for the people who do not have an account yet.
 *
 * THIS IS THE HALF track() CANNOT SEE. user_events needs a user_id, so it can
 * only describe somebody who already signed up — and the most useful number a
 * landing page produces is about the ones who didn't. Two hundred arrived,
 * thirty opened the form, nine finished: the interesting figure is the gap
 * between the last two, and nothing in the database can compute it.
 *
 * Vendor-neutral for the same reason Analytics.jsx is: the shape is the same
 * across the privacy-friendly providers, and the one that is configured is the
 * one that gets called. With none of them loaded — a developer's machine, a
 * deployment that never chose a provider, a visitor running an ad blocker —
 * this does nothing at all and says nothing about it.
 *
 * COUNTS AND ENUMS ONLY, the same rule as 016. Never an email address, never
 * anything typed into a form. These land with a third party rather than in our
 * own database, so the bar is higher here, not lower.
 */
export function pageEvent(name, data) {
  try {
    if (typeof window === "undefined") return;

    if (window.umami?.track) {
      window.umami.track(name, data);
    } else if (typeof window.plausible === "function") {
      window.plausible(name, data ? { props: data } : undefined);
    }
  } catch {
    /* analytics that can break the page is worse than no analytics */
  }
}
