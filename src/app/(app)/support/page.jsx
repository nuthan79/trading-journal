"use client";

import { useState } from "react";
import ContactForm from "@/components/ContactForm";
import { BRAND } from "@/lib/brand";

/**
 * Ask for help.
 *
 * This is the one thing the settings page had that nothing else did. The rest
 * of it — profile, setup, importing, the plan — were panels pointing at places
 * that already existed, which is scaffolding rather than a feature. So the
 * scaffolding went and this stayed, on its own route.
 *
 * The questions below are the ones this app actually generates. A generic FAQ
 * is worse than none: it answers nothing and signals that nobody has been
 * asked anything yet.
 */

const FAQ = [
  {
    q: "Why is a trade missing from my statistics?",
    a: "Almost always a missing stop. Without one there is no 1R, and anything " +
       "measured in R has nothing to divide by — so the trade sits in the sheet " +
       "but not in expectancy, the R distribution or the drawdown. The Stops page " +
       "lists every one still waiting.",
  },
  {
    q: "Can I import from a broker other than Zerodha?",
    a: "Not yet. Each broker's tax report has its own columns and sections, and an " +
       "adapter written from a guess produces numbers that look right and are not. " +
       "Send the file through the form above and it can be added properly.",
  },
  {
    q: "Why don't my charges match my contract note exactly?",
    a: "They are computed from the statutory rates and the broker settings in Setup, " +
       "so a different brokerage plan will differ. Any trade's figure can be " +
       "overridden by typing it, and an overridden figure is never recalculated.",
  },
  {
    q: "What happened to the sample data?",
    a: "It disappears the moment you log a trade of your own, and does not come " +
       "back. None of it was ever saved — it was generated in your browser so the " +
       "charts had something to show, and it never counted towards your figures.",
  },
  {
    q: "Is my data used for anything else?",
    a: "No. It is not sold, not shared, and not used to train anything. You can take " +
       "the whole lot as one file from My profile, or delete the account outright.",
  },
];

export default function SupportPage() {
  const [open, setOpen] = useState(null);

  return (
    <div className="sec sp">
      <div className="eyebrow">Support</div>
      <h1 className="disp sp-h1">Ask, or tell us what&rsquo;s wrong.</h1>
      <p className="sp-lede">
        {BRAND.name} is built and run by one person, so replies take a day or two —
        but they do come. If something is broken, saying what you were doing when it
        happened is worth more than anything else you can write.
      </p>

      <ContactForm />

      <div className="eyebrow sp-faqhead">Common questions</div>
      <div className="sp-faq">
        {FAQ.map((f, i) => (
          <div key={f.q} className="sp-q">
            <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
              <span>{f.q}</span><i>{open === i ? "−" : "+"}</i>
            </button>
            {open === i && <p>{f.a}</p>}
          </div>
        ))}
      </div>

      <style jsx>{`
        .sp { max-width: 640px; }
        .sp-h1 { font-size: 24px; margin: 7px 0 10px; }
        .sp-lede {
          font-size: 14px; line-height: 1.7; color: var(--ink2);
          margin: 0 0 20px; text-wrap: pretty;
        }
        .sp-faqhead { margin: 34px 0 10px; }
        .sp-faq { border-top: 1px solid var(--rule); }
        .sp-q { border-bottom: 1px solid var(--rule); }
        .sp-q button {
          display: flex; justify-content: space-between; align-items: center; gap: 14px;
          width: 100%; background: none; border: 0; padding: 14px 2px;
          font: inherit; font-size: 13.5px; color: var(--ink);
          text-align: left; cursor: pointer;
        }
        .sp-q button i { font-style: normal; font-size: 17px; color: var(--ink3); }
        .sp-q p {
          font-size: 13px; line-height: 1.7; color: var(--ink2);
          margin: 0 0 15px; max-width: 66ch;
        }
      `}</style>
    </div>
  );
}
