/**
 * The product's name, in one place.
 *
 * WORKING NAME. Nothing here is settled — the domain isn't bought and the name
 * may not survive it. That is exactly why it is a constant rather than a string
 * typed into a headline, a page title, a footer and an email template: when the
 * name changes it changes here, and the only thing anyone has to remember is
 * that this file exists.
 *
 * Kept free of JSX so it can be imported by server components, metadata
 * exports and route handlers as well as by the marketing page.
 */
export const BRAND = {
  name: "LedgeRR",

  /** One line, used under the logo and as the meta description's opening. */
  tagline: "A swing trading journal that measures everything in R",

  /**
   * The long description — for <meta>, for link previews, and for the hero.
   * Written to be read by somebody who has never heard of the app and is
   * deciding in about four seconds whether to keep reading.
   */
  blurb:
    "Log your NSE and BSE swing trades, and see what your setups actually earn. " +
    "Every trade is measured in R, so a ₹8,000 win on a tight stop and a ₹40,000 " +
    "win on a wide one finally compare.",

  /** The canonical host. Used for absolute URLs in link previews. */
  domain: "ledgerr.app",

  /** Where "Contact" points. Blank hides the link rather than mailing nowhere. */
  contactEmail: "nuthann@gmail.com",
};
