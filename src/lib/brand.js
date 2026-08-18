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

  /**
   * The public address. Blank hides every reference rather than mailing
   * nowhere — and makes the legal pages say plainly that they are unfinished.
   *
   * Lowercase deliberately. Mail routing ignores case, but this string is
   * printed on three public pages and copied into people's address books, and
   * a capitalised local part reads as a typo to anyone who notices.
   */
  contactEmail: "contact@ledgerr.app",

  /**
   * Who answers a privacy grievance, by name.
   *
   * The DPDP Act requires a readily available means of redress and the contact
   * details of somebody able to answer questions about how data is processed.
   * An address alone satisfies the letter of that; a name is what makes it
   * feel answerable to the person writing, which is the point of the right.
   *
   * BLANK IS A WORKING STATE, NOT A BROKEN ONE. Left empty the policy names
   * the role instead of a person and still gives the address, so the page is
   * complete and honest either way — unlike `contactEmail`, whose absence
   * genuinely does leave nowhere to write and lights the unfinished banner.
   *
   * This is a real person's name on a public page, so changing it is a
   * decision about somebody rather than a config tweak: whoever is named here
   * is who a stranger writes to about their data, and who is expected to
   * answer within `grievanceDays`.
   */
  grievanceOfficer: "Bavya J R",

  /**
   * Days to respond to a grievance, stated publicly.
   *
   * A promise, so it is deliberately one that can be kept by one person with
   * a day job. The DPDP rules contemplate ninety days as an outer limit;
   * saying thirty and meaning it is worth more than saying seven and missing.
   */
  grievanceDays: 30,
};
