/**
 * Where each broker keeps the file the importer reads — click by click.
 *
 * THE BARRIER WAS NEVER THE IMPORT. The start screen named the reports ("the
 * tax P&L or capital gains report") and left a new user to find them, which on
 * a broker's site means knowing which of five similarly named menus holds the
 * one this app can read.
 *
 * TAKEN FROM EACH BROKER'S OWN HELP PAGES, checked 2026-09-18, not written from
 * memory: a step that sends somebody to a menu that no longer exists is worse
 * than no step. Brokers move these; when one does, this is the only file to
 * change. Sources:
 *   Zerodha tax P&L   support.zerodha.com/category/console/reports/taxation/articles/i-need-a-profit-and-loss-report-for-a-tax-audit-where-can-i-get-this-from
 *   Zerodha holdings  support.zerodha.com/category/console/portfolio/console-holdings/articles/holding-report
 *   Zerodha tradebook support.zerodha.com/category/console/reports/other-queries/articles/where-can-i-see-all-the-trades-i-ve-taken-for-a-particular-period
 *   ICICI Direct      icicidirect.com/faqs/my-account/how-to-download-equity-p-l-statement-on-icici-direct
 *   Groww             groww.in/help/stocks,-f&o,-ipo-&-mtf/sx-reports/what-is-a-capital-gain-or-tax-p-l-report--20
 *   Dhan              dhan.co/support/statements-and-ledger/my-statements/how-to-view-or-download-your-tax-report/
 *
 * ONE ENTRY PER FILE THE IMPORTER ACTUALLY READS — see brokers/*.js. Each says
 * what the file is FOR in the user's words (closed trades, what you hold now),
 * because the report names are the broker's, not theirs.
 */
export const BROKER_STEPS = [
  {
    id: "zerodha",
    label: "Zerodha",
    files: [
      {
        what: "Closed trades",
        name: "Tax P&L",
        steps: [
          "Log in to Console — console.zerodha.com",
          "Reports → Tax P&L",
          "Pick the financial year, then the arrow",
          "Download, as XLSX",
        ],
        note: "One file per financial year — import each year you want.",
      },
      {
        what: "What you hold now",
        name: "Holdings",
        steps: [
          "Log in to Console",
          "Portfolio → Holdings",
          "XLSX, beside Download",
        ],
      },
      {
        what: "Buy dates for what you hold",
        name: "Tradebook — optional",
        steps: [
          "Log in to Console",
          "Reports → Tradebook",
          "Segment: Equity, pick the dates, then the arrow",
          "Download, as XLSX",
        ],
        note: "Up to 365 days per file. It only dates positions already imported.",
      },
    ],
  },
  {
    id: "icicidirect",
    label: "ICICI Direct",
    files: [
      {
        what: "Closed trades",
        name: "Equity P&L Statement",
        steps: [
          "Log in at icicidirect.com",
          "Stocks → Statements & Reports → All Reports",
          "Statements → P&L Statement",
          "Pick the dates, then Download",
        ],
      },
    ],
  },
  {
    id: "groww",
    label: "Groww",
    files: [
      {
        what: "Closed trades",
        name: "Stocks capital gains",
        steps: [
          "Profile → Reports",
          "Under Tax: Stocks – Capital gain",
          "Pick the financial year, then View",
          "Download the report",
        ],
        note: "One file per financial year.",
      },
    ],
  },
  {
    id: "dhan",
    label: "Dhan",
    files: [
      {
        what: "Closed trades",
        name: "Tax report",
        steps: [
          "Log in at web.dhan.co",
          "Profile (top right) → Journal by Dhan",
          "Tax Saving → Tax Report",
          "Pick the financial year, then download as Excel",
        ],
      },
    ],
  },
];
