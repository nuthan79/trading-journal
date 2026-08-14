"use client";

import { BRAND } from "@/lib/brand";

/**
 * The page a stranger sees.
 *
 * Until now the logged-out state of this app was the sign-in card and nothing
 * else — which is fine for the one person who built it and useless the moment
 * a link gets shared, because a visitor arrives at a password box for a product
 * they cannot see.
 *
 * TAKES THE SIGN-IN FORM AS A PROP rather than rendering its own. Every piece
 * of auth state lives in the app layout, and a second copy of that form here
 * would be a second place for the magic-link flow to drift.
 *
 * IT SAYS THAT THE EMAIL LINK IS THE WAY IN. There is no password sign-up in
 * this app — `signInWithPassword` only ever signs an existing user in, and it
 * is `signInWithOtp` that creates the account. A visitor typing their email
 * into a box labelled "Sign in" has no way to know it will work, so the copy
 * says it plainly. That also makes outgoing email the single point of failure
 * for every new account, which is worth remembering.
 *
 * LIGHT, on the app's own paper. The obvious reference for this category is a
 * dark trading dashboard; this is deliberately the opposite, and it uses the
 * same palette, the same two typefaces and the same tabular numerals as the
 * journal behind it — so that signing in feels like walking further into the
 * same building rather than through a door onto a different street.
 */
/** Illustrative only — see the note at the section that draws these. */
const SAMPLE = [
  { s: "KTKBANK",  p: "Flat base",     d: "31d", r: 3.1 },
  { s: "TITAN",    p: "VCP",           d: "24d", r: 2.4 },
  { s: "GOLDIAM",  p: "Cup & handle",  d: "12d", r: 0.8 },
  { s: "DIVISLAB", p: "VCP",           d: "9d",  r: -0.6 },
  { s: "CMPDI",    p: "Pullback",      d: "4d",  r: -1.0 },
];
const SAMPLE_MAX = Math.max(...SAMPLE.map((t) => Math.abs(t.r)));

export default function Landing({ signIn, view = "signin", switchAuthView }) {
  const signup = view === "signup";

  return (
    <div className="lp">
      <header className="lp-top">
        <div className="lp-brand">
          <span className="disp lp-word">{BRAND.name}</span>
          <span className="lp-mark" aria-hidden="true" />
        </div>
        <a className="lp-navlink" href="#start">Sign in</a>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <div className="eyebrow">NSE &amp; BSE · swing trading</div>
          <h1 className="disp lp-h1">Know which of your setups actually pay.</h1>
          <p className="lp-lede">{BRAND.blurb}</p>
          <ul className="lp-ticks">
            <li>Charges worked out to the paisa — STT, stamp duty, DP, GST</li>
            <li>Import the trades you have already made</li>
            <li>Your notes and your chart, kept with the trade</li>
          </ul>
        </div>

        <div className="lp-hero-form" id="start">
          <div className="lp-formhead">
            <div className="disp lp-formtitle">
              {signup ? "Create your journal" : "Start your journal"}
            </div>
            {/* The way to the other form lives HERE, as a link, rather than
                at the foot of the card. It used to be bold text pointing at a
                button three hundred pixels further down — and the end of a
                sentence is where a reader has already stopped. */}
            <p className="lp-formnote">
              {signup ? (
                <>
                  An email and a password of your choosing. Nothing to verify, nothing to
                  pay, and you can export or delete everything whenever you like.{" "}
                  <button type="button" className="lnk lp-swap"
                          onClick={() => switchAuthView?.("signin")}>
                    Already have one? Sign in
                  </button>
                </>
              ) : (
                <>
                  Already have one? Sign in below. New here?{" "}
                  <button type="button" className="lnk lp-swap"
                          onClick={() => switchAuthView?.("signup")}>
                    Create an account
                  </button>{" "}
                  — it takes about a minute.
                </>
              )}
            </p>
          </div>
          {signIn}
        </div>
      </section>

      <section className="lp-band">
        <div className="lp-band-in">
          <div className="lp-band-copy">
            <div className="eyebrow">The whole idea</div>
            <h2 className="disp lp-h2">One number that makes two trades comparable.</h2>
            <p className="lp-body">
              R is your profit divided by the risk you took to get it. Rupees alone
              cannot tell you whether a trade was good, because they say nothing about
              what you put on the line. R can.
            </p>
            <p className="lp-body">
              Once every trade carries one, the questions worth asking start to have
              answers: which base pattern pays, whether entering further above the
              pivot costs you, what a thin breakout is really worth.
            </p>
          </div>

          {/* Sample figures, not anyone's trades — the point is the arithmetic. */}
          <div className="lp-demo" role="img"
               aria-label="Two example trades: a ₹8,000 profit on ₹4,000 of risk is +2.0R, and a ₹40,000 profit on ₹40,000 of risk is +1.0R.">
            <div className="lp-demo-head">
              <span>Trade</span><span>Profit</span><span>Risk taken</span><span>R</span>
            </div>
            <div className="lp-demo-row">
              <span>Tight stop</span>
              <span className="mono">₹8,000</span>
              <span className="mono lp-dim">₹4,000</span>
              <span className="mono lp-r lp-good">+2.0R</span>
            </div>
            <div className="lp-demo-row">
              <span>Wide stop</span>
              <span className="mono">₹40,000</span>
              <span className="mono lp-dim">₹40,000</span>
              <span className="mono lp-r">+1.0R</span>
            </div>
            <p className="lp-demo-note">
              The second trade made five times the money. The first one was the better
              trade, and only R says so.
            </p>
          </div>
        </div>
      </section>

      {/* Sample rows, not anyone's book. The page described the product for
          six paragraphs without ever showing it, and a journal is a thing you
          look at — the R column doing its job across a handful of trades
          argues better than another sentence about R doing its job. */}
      <section className="lp-sec">
        <div className="eyebrow">What it looks like</div>
        <h2 className="disp lp-h2">Every trade, against the risk you took on it.</h2>

        <div className="lp-book" role="img"
             aria-label="An example journal: five trades with their base pattern, holding period and R multiple, ranging from minus 1.0R to plus 3.1R.">
          <div className="lp-book-head">
            <span>Symbol</span><span>Pattern</span><span>Held</span><span className="lp-num">R</span><span />
          </div>
          {SAMPLE.map((t) => (
            <div className="lp-book-row" key={t.s}>
              <span className="lp-sym">{t.s}</span>
              <span className="lp-dim">{t.p}</span>
              <span className="lp-dim">{t.d}</span>
              <span className={`mono lp-num lp-rv ${t.r >= 0 ? "lp-good" : "lp-bad"}`}>
                {t.r >= 0 ? "+" : ""}{t.r.toFixed(1)}R
              </span>
              {/* Zero in the middle, so a loss reads as a direction and not
                  just a smaller number. */}
              <span className="lp-track">
                <i className={t.r >= 0 ? "lp-bar lp-bar-up" : "lp-bar lp-bar-dn"}
                   style={{ width: `${(Math.abs(t.r) / SAMPLE_MAX) * 50}%` }} />
              </span>
            </div>
          ))}
          <p className="lp-book-note">
            Example figures. Two of these five lost money and the book is still well
            ahead — which is the shape a breakout system is supposed to have, and the
            thing you cannot see in a list of rupee amounts.
          </p>
        </div>
      </section>

      <section className="lp-sec">
        <div className="eyebrow">What it does</div>
        <h2 className="disp lp-h2">Built around the parts you would otherwise do in a spreadsheet.</h2>

        <div className="lp-grid">
          <Feature title="Charges, computed">
            STT, exchange fees that differ between NSE and BSE, SEBI turnover, stamp
            duty on the buy, GST, DP charges on the sell, and your own broker’s
            brokerage. Your P&amp;L is after all of it. Override any figure and it
            stays overridden.
          </Feature>

          <Feature title="Import what you have already traded">
            Bring in a tax P&amp;L file from your broker and start with your history rather than
            a blank page. Entry, exit, quantity and charges come across.
          </Feature>

          <Feature title="Sells in tranches">
            Sell a third into strength and let the rest run. Each sell keeps its own
            date, price, reason and cost, and the position’s R follows.
          </Feature>

          <Feature title="Where your edge is">
            Your trades sliced by base pattern, distance from the pivot, breakout
            volume, stop width, relative strength and holding period — with bands that
            adapt to your own data instead of thresholds someone else picked.
          </Feature>

          <Feature title="A diary that keeps the chart">
            Paste a TradingView snapshot with the note. Write about a stock while it is
            still a watchlist idea, and tie that note to the trade when you take it.
          </Feature>

          <Feature title="Capital, honestly">
            How much of your account was actually working on any given day, against the
            Nifty 500 — so a flat month reads as cash on the sidelines or as a market
            that gave nothing, and you can tell which.
          </Feature>
        </div>
      </section>

      <section className="lp-sec lp-sec-tight">
        <div className="lp-india">
          <div>
            <div className="eyebrow">Made for this market</div>
            <h2 className="disp lp-h2">Rupees, and the Indian financial year.</h2>
            <p className="lp-body">
              Not a US tool with a currency dropdown. Amounts are in rupees and read in
              thousands, lakh and crore. Periods run April to March. The charge rates
              are the Indian statutory ones, and the symbol list is NSE and BSE equity.
            </p>
          </div>
          <div className="lp-figs">
            <div className="lp-fig"><b className="mono">₹12.87 L</b><span>position size</span></div>
            <div className="lp-fig"><b className="mono">+1.09R</b><span>on the trade</span></div>
            <div className="lp-fig"><b className="mono">FY 27</b><span>Apr–Mar</span></div>
          </div>
        </div>
      </section>

      <section className="lp-sec lp-close">
        <h2 className="disp lp-h2">Start with your next trade, or your last hundred.</h2>
        <a className="btn lp-cta" href="#start">Open a journal</a>
      </section>

      <footer className="lp-foot">
        <div className="lp-foot-in">
          <span className="disp lp-word lp-foot-word">{BRAND.name}</span>
          <nav className="lp-foot-nav">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            {/* The page, not a mailto — see the note in the contact route. */}
            <a href="/contact">Contact</a>
          </nav>
        </div>
        <p className="lp-foot-fine">
          {BRAND.name} is a record-keeping tool. It does not give investment advice,
          recommend securities, or execute orders.
        </p>
      </footer>

      {/* Global, and prefixed. A plain `<style jsx>` would not reach anything
          rendered by Feature() below — different component function, no scoping
          class — and the feature grid is most of this page. */}
      <style jsx global>{`
        .lp {
          --lp-gutter: 24px;
          background: var(--paper);
          color: var(--ink);
          min-height: 100vh;
        }
        .lp section, .lp .lp-top, .lp .lp-foot-in, .lp .lp-band-in {
          max-width: 1060px; margin: 0 auto; padding-left: var(--lp-gutter);
          padding-right: var(--lp-gutter);
        }

        .lp-top {
          display: flex; align-items: center; justify-content: space-between;
          padding-top: 22px; padding-bottom: 22px;
        }
        .lp-brand { display: inline-flex; align-items: center; gap: 9px; }
        .lp-word { font-size: 19px; letter-spacing: 0.01em; }
        /* A small brass square instead of a logo nobody has drawn yet. It reads
           as deliberate; a stretched wordmark would not. */
        .lp-mark {
          width: 7px; height: 7px; background: var(--brass); border-radius: 1px;
          display: inline-block;
        }
        .lp-navlink {
          font-size: 12px; font-weight: 600; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--ink2); text-decoration: none;
          border-bottom: 1px solid transparent; padding-bottom: 2px;
        }
        .lp-navlink:hover { color: var(--ink); border-bottom-color: var(--brass); }

        .lp-hero {
          display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 56px;
          align-items: start; padding-top: 44px; padding-bottom: 76px;
        }
        .lp-h1 {
          font-size: 46px; line-height: 1.08; margin: 12px 0 0;
          letter-spacing: -0.005em; max-width: 15ch;
        }
        .lp-lede {
          font-size: 16px; line-height: 1.65; color: var(--ink2);
          margin: 18px 0 0; max-width: 48ch;
        }
        .lp-ticks { list-style: none; margin: 24px 0 0; padding: 0; }
        .lp-ticks li {
          position: relative; padding-left: 20px; margin-bottom: 9px;
          font-size: 13.5px; color: var(--ink2);
        }
        .lp-ticks li::before {
          content: ""; position: absolute; left: 0; top: 7px;
          width: 8px; height: 8px; border-radius: 50%;
          border: 1.5px solid var(--long);
        }

        .lp-hero-form { position: sticky; top: 24px; }
        .lp-formhead { margin-bottom: 14px; }
        .lp-formtitle { font-size: 17px; }
        .lp-formnote {
          font-size: 12.5px; line-height: 1.6; color: var(--ink2); margin: 6px 0 0;
        }
        .lp-formnote b { color: var(--ink); font-weight: 600; }

        /* The one panel that changes colour, so the idea at the centre of the
           product gets its own room rather than being section four of nine. */
        .lp-band { background: #E4EAE7; border-block: 1px solid var(--rule); }
        .lp-band-in {
          display: grid; grid-template-columns: 1fr 1fr; gap: 52px;
          align-items: center; padding-top: 60px; padding-bottom: 60px;
        }
        .lp-h2 {
          font-size: 27px; line-height: 1.2; margin: 10px 0 0; max-width: 22ch;
        }
        .lp-body {
          font-size: 14.5px; line-height: 1.7; color: var(--ink2); margin: 16px 0 0;
          max-width: 52ch;
        }

        .lp-demo {
          background: var(--card); border: 1px solid var(--rule); border-radius: 3px;
          padding: 18px 20px 16px;
        }
        .lp-demo-head, .lp-demo-row {
          display: grid; grid-template-columns: 1.2fr 1fr 1fr 0.8fr;
          gap: 10px; align-items: baseline;
        }
        .lp-demo-head {
          font-size: 10px; font-weight: 600; letter-spacing: 0.12em;
          text-transform: uppercase; color: var(--ink3);
          padding-bottom: 10px; border-bottom: 1px solid var(--rule);
        }
        .lp-demo-head span:not(:first-child),
        .lp-demo-row span:not(:first-child) { text-align: right; }
        .lp-demo-row {
          padding: 13px 0; border-bottom: 1px solid var(--rule); font-size: 13.5px;
        }
        .lp-dim { color: var(--ink3); }
        .lp-r { font-size: 15px; }
        .lp-good { color: var(--long); font-weight: 500; }
        .lp-demo-note {
          font-size: 12px; line-height: 1.6; color: var(--ink3); margin: 14px 0 0;
        }

        /* The sample journal. Same card, same tabular numerals and same two
           outcome colours as the real trade sheet — the point is that this is
           what you will actually be looking at, so it should not be a prettier
           invention of it. */
        .lp-book {
          margin-top: 30px; background: var(--card); border: 1px solid var(--rule);
          border-radius: 3px; padding: 6px 20px 16px;
        }
        .lp-book-head, .lp-book-row {
          display: grid; grid-template-columns: 1.1fr 1.2fr 0.5fr 0.7fr 1.6fr;
          gap: 14px; align-items: center;
        }
        .lp-book-head {
          font-size: 10px; font-weight: 600; letter-spacing: 0.12em;
          text-transform: uppercase; color: var(--ink3);
          padding: 12px 0 10px; border-bottom: 1px solid var(--rule);
        }
        .lp-book-row {
          padding: 13px 0; border-bottom: 1px solid var(--rule); font-size: 13.5px;
        }
        .lp-book-row:last-of-type { border-bottom: 0; }
        .lp-sym { font-weight: 600; letter-spacing: 0.01em; }
        .lp-num { text-align: right; }
        .lp-rv { font-size: 14.5px; font-weight: 500; }
        .lp-bad { color: var(--short); }
        /* Zero sits at the centre so the losses point the other way. A bar
           that only ever grew rightwards would make a loss look like a small
           win, which is the exact confusion R exists to remove. */
        .lp-track {
          position: relative; height: 7px; background: #EEF2F0;
          border-radius: 2px; overflow: hidden;
        }
        .lp-track::before {
          content: ""; position: absolute; left: 50%; top: 0; bottom: 0;
          width: 1px; background: var(--grid);
        }
        .lp-bar { position: absolute; top: 0; bottom: 0; border-radius: 2px; }
        .lp-bar-up { left: 50%; background: var(--long); }
        .lp-bar-dn { right: 50%; background: var(--short); }
        .lp-book-note {
          font-size: 12px; line-height: 1.65; color: var(--ink3);
          margin: 16px 0 0; max-width: 62ch;
        }

        .lp-sec { padding-top: 72px; padding-bottom: 12px; }
        .lp-sec-tight { padding-top: 56px; }

        .lp-grid {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px;
          margin-top: 34px;
        }
        .lp-card {
          background: var(--card); border: 1px solid var(--rule); border-radius: 3px;
          padding: 20px 20px 22px;
        }
        .lp-card h3 {
          font-family: 'Archivo', sans-serif; font-stretch: 125%; font-weight: 600;
          font-size: 15px; margin: 0 0 8px; letter-spacing: 0.01em;
        }
        .lp-card p {
          font-size: 13px; line-height: 1.65; color: var(--ink2); margin: 0;
        }

        .lp-india {
          display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 48px;
          align-items: center; background: var(--card);
          border: 1px solid var(--rule); border-radius: 3px; padding: 34px 36px;
        }
        .lp-figs { display: grid; gap: 14px; }
        .lp-fig {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 16px; border-bottom: 1px solid var(--rule); padding-bottom: 11px;
        }
        .lp-fig:last-child { border-bottom: 0; padding-bottom: 0; }
        .lp-fig b { font-size: 22px; font-weight: 500; }
        .lp-fig span { font-size: 11.5px; color: var(--ink3); }

        .lp-close { text-align: center; padding-top: 76px; padding-bottom: 84px; }
        .lp-close .lp-h2 { max-width: none; margin: 0 auto; }
        .lp-cta {
          margin-top: 24px; text-decoration: none; padding: 12px 22px; font-size: 12.5px;
        }

        .lp-foot { border-top: 1px solid var(--rule); background: var(--card); }
        .lp-foot-in {
          display: flex; align-items: center; justify-content: space-between;
          gap: 20px; flex-wrap: wrap; padding-top: 24px; padding-bottom: 10px;
        }
        .lp-foot-word { font-size: 15px; color: var(--ink2); }
        .lp-foot-nav { display: flex; gap: 22px; }
        .lp-foot-nav a {
          font-size: 12.5px; color: var(--ink2); text-decoration: none;
          border-bottom: 1px solid transparent; padding-bottom: 2px;
        }
        .lp-foot-nav a:hover { color: var(--ink); border-bottom-color: var(--brass); }
        .lp-foot-fine {
          max-width: 1060px; margin: 0 auto; padding: 0 var(--lp-gutter) 26px;
          font-size: 11.5px; color: var(--ink3); line-height: 1.6;
        }

        @media (max-width: 900px) {
          .lp-hero, .lp-band-in, .lp-india { grid-template-columns: 1fr; gap: 36px; }
          .lp-hero { padding-top: 30px; padding-bottom: 52px; }
          .lp-hero-form { position: static; }
          .lp-h1 { font-size: 34px; max-width: none; }
          .lp-h2 { max-width: none; }
          .lp-grid { grid-template-columns: repeat(2, 1fr); }
          .lp-india { padding: 26px 22px; }
        }
        @media (max-width: 600px) {
          .lp { --lp-gutter: 18px; }
          /* The pattern and the bar are the two that can go. Symbol, holding
             period and R still say what the row is for. */
          .lp-book-head, .lp-book-row { grid-template-columns: 1.2fr 0.6fr 0.8fr; gap: 10px; }
          .lp-book-head span:nth-child(2), .lp-book-row span:nth-child(2),
          .lp-track { display: none; }
          .lp-book { padding: 6px 14px 14px; }
          .lp-h1 { font-size: 29px; }
          .lp-h2 { font-size: 22px; }
          .lp-grid { grid-template-columns: 1fr; }
          .lp-sec { padding-top: 52px; }
          .lp-demo-head, .lp-demo-row { grid-template-columns: 1fr 1fr 1fr 0.7fr; gap: 6px; }
          .lp-demo { padding: 14px 14px 12px; }
        }
      `}</style>
    </div>
  );
}

function Feature({ title, children }) {
  return (
    <div className="lp-card">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
