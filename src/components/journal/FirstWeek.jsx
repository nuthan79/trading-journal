"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Upload, Plus, X } from "lucide-react";
import { firstWeek } from "@/lib/firstweek";

/**
 * Three steps for a new journal, on the Dashboard, until they are done.
 *
 * The rules for WHEN live in lib/firstweek.js, where they can be tested. This
 * only draws them and remembers a dismissal.
 *
 * DISMISSED IN THIS BROWSER, not in the database. It is a nudge, not a
 * setting: if it comes back once on a second device it costs one click, and a
 * column plus a migration for that would be more machinery than the card.
 * Keyed by user, so two people sharing a laptop do not dismiss it for each
 * other. Every storage call is guarded — private windows and blocked site
 * data throw on access, and the card must still render (or not) correctly.
 */
const keyFor = (userId) => `ledgerr:first-week-hidden:${userId || "anon"}`;

export default function FirstWeek({ trades, needStops, assumedStops, diary,
                                    onboardedAt, userId, onNewTrade }) {
  /* Starts hidden and is revealed after the stored flag is read, rather than
     flashing on and then vanishing for somebody who dismissed it last week. */
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    let stored = false;
    try { stored = localStorage.getItem(keyFor(userId)) === "1"; } catch {}
    setHidden(stored);
  }, [userId]);

  const fw = firstWeek({ trades, needStops, assumedStops, diary, onboardedAt });
  if (hidden || !fw.show) return null;

  const dismiss = () => {
    try { localStorage.setItem(keyFor(userId), "1"); } catch {}
    setHidden(true);
  };

  const [s1, s2, s3] = fw.steps;

  /* The .sec wrapper is drawn here rather than by the Dashboard, so a hidden
     or finished card leaves no empty section — and no stray gap — behind. */
  return (
    <div className="sec">
    <section className="fw" aria-label="Getting started">
      <div className="fw-head">
        <div>
          <div className="eyebrow">Your first week</div>
          <p className="fw-lede">Three things make this journal worth having. {fw.doneCount} of 3 done.</p>
        </div>
        <button className="btn ghost sm" onClick={dismiss}><X size={12} />Hide this</button>
      </div>

      <ol className="fw-steps">
        <li data-done={s1.done ? 1 : 0}>
          <span className="fw-mark">{s1.done ? <Check size={13} /> : "1"}</span>
          <div>
            <b>Bring in your trades</b>
            <p>Import a year from your broker&apos;s tax P&amp;L, or log one trade you
              still remember clearly.</p>
            {!s1.done && (
              <div className="fw-acts">
                <Link href="/import" className="btn sm"><Upload size={12} />Import</Link>
                <button className="btn ghost sm" onClick={onNewTrade}><Plus size={12} />Log a trade</button>
              </div>
            )}
          </div>
        </li>

        <li data-done={s2.done ? 1 : 0}>
          <span className="fw-mark">{s2.done ? <Check size={13} /> : "2"}</span>
          <div>
            <b>Give each trade its real stop</b>
            <p>The stop you actually used. Every R figure here is measured from it, so a
              guessed one quietly bends them all.</p>
            {!s2.done && s1.done && s2.pending > 0 && (
              <div className="fw-acts">
                <Link href="/stops" className="btn sm">
                  {s2.pending} to fill in
                </Link>
              </div>
            )}
          </div>
        </li>

        <li data-done={s3.done ? 1 : 0}>
          <span className="fw-mark">{s3.done ? <Check size={13} /> : "3"}</span>
          <div>
            <b>Write one diary entry</b>
            <p>What you felt and why you took the trade. In a year it explains the numbers.</p>
            {!s3.done && (
              <div className="fw-acts">
                <Link href="/diary" className="btn ghost sm">Open the diary</Link>
              </div>
            )}
          </div>
        </li>
      </ol>

      <style jsx>{`
        .fw { border: 1px solid var(--brass); background: var(--card);
              border-radius: 3px; padding: 16px 20px 18px; }
        .fw-head { display: flex; justify-content: space-between; align-items: flex-start;
                   gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
        .fw-lede { margin: 4px 0 0; font-size: 13.5px; color: var(--ink2); }
        /* Three across, filling the width, so the card reads as one row of
           steps rather than a narrow column with the right half empty. */
        .fw-steps { list-style: none; margin: 0; padding: 0; display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
        .fw-steps li { display: flex; gap: 12px; align-items: flex-start;
                       border-top: 1px solid var(--rule); padding-top: 12px; }
        .fw-steps li[data-done="1"] b { color: var(--ink3); text-decoration: line-through; }
        .fw-steps li[data-done="1"] p { color: var(--ink3); }
        .fw-mark { flex: none; width: 24px; height: 24px; border-radius: 50%;
                   border: 1px solid var(--rule); display: inline-flex; align-items: center;
                   justify-content: center; font-size: 12px; font-weight: 600; color: var(--ink2); }
        li[data-done="1"] .fw-mark { background: var(--long); border-color: var(--long); color: #fff; }
        .fw-steps b { font-size: 14px; font-weight: 600; color: var(--ink); }
        .fw-steps p { margin: 4px 0 0; font-size: 12.5px; line-height: 1.55; color: var(--ink2); }
        .fw-acts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }

      `}</style>
    </section>
    </div>
  );
}
