"use client";

/**
 * Can you tell your own winners from your own losers?
 *
 * The deck is mixed and the outcome is hidden until a call is made — see
 * lib/drill.js for why a deck of winners would have been worse than nothing.
 *
 * THE CARD IS BLINDED. No symbol, no date, no P&L until you have answered.
 * Without that the drill tests memory: the ticker comes back before the eye
 * has finished the chart, and a trade from March is recalled rather than read.
 *
 * THE ANSWER SIDE IS TWO PICTURES. What you SAW is the chart you attached at
 * the time; what HAPPENED is the same stock drawn from stored bars with your
 * entry, stop and every exit marked. No other journal can show that pair,
 * because none of them hold both halves.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, X, RotateCcw, Eye } from "lucide-react";
import { rupee, rfmt, dmy, pct } from "@/lib/format";
import { chartUrl, apiFetch, listDrillCards, saveDrillSession } from "@/lib/db";
import { eligible, buildDeck, deckHealth, score, verdict, reveal,
         MIN_CALLS, STALE_DAYS } from "@/lib/drill";
import { windowsFor, barsFor, hasBars } from "@/lib/candles";
import { tickerFor } from "@/lib/bars";
import TradeChart from "./TradeChart";

const HAND = 10;

export default function ChartDrill({ trades = [], diary = [] }) {
  const cards = useMemo(() => eligible(trades, diary), [trades, diary]);
  const health = useMemo(() => deckHealth(cards), [cards]);

  const [reviews, setReviews] = useState({});
  const [deck, setDeck] = useState([]);
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [shown, setShown] = useState(false);      // has this card been revealed
  const [img, setImg] = useState(null);
  const [imgErr, setImgErr] = useState(false);
  const [bars, setBars] = useState(null);
  const [seed, setSeed] = useState(1);
  const saved = useRef(false);

  useEffect(() => { listDrillCards().then(setReviews).catch(() => {}); }, []);

  const start = useCallback((s) => {
    setDeck(buildDeck(cards, { size: HAND, seed: s, reviews }));
    setAt(0); setAnswers([]); setShown(false); setImg(null); setBars(null);
    saved.current = false;
  }, [cards, reviews]);

  /* Waits for the reviews to land so the first hand is ordered by them rather
     than dealt at random and reordered on a later visit. */
  useEffect(() => { if (cards.length) start(seed); }, [cards, seed, start]);

  const card = deck[at] || null;
  const done = deck.length > 0 && at >= deck.length;

  /* The picture, fetched per card. Signed storage URLs expire, so they are got
     when the card comes up rather than all at once at the start. */
  useEffect(() => {
    let dead = false;
    setImg(null); setImgErr(false);
    if (!card?.entry?.image_path) { setImgErr(true); return; }
    /**
     * A CARD THAT CANNOT LOAD ITS PICTURE MUST SAY SO.
     *
     * A signed storage URL is minted per card and can fail — an expired
     * session, a deleted object, a bucket that has moved. The first version
     * swallowed both the null and the rejection, so the card sat on "Loading
     * the chart…" for ever with the Take and Pass buttons live underneath it:
     * a drill you could answer without seeing anything, which would quietly
     * poison the score with calls made on a blank rectangle.
     */
    chartUrl(card.entry.image_path)
      .then((u) => { if (dead) return; if (u) setImg(u); else setImgErr(true); })
      .catch(() => { if (!dead) setImgErr(true); });
    return () => { dead = true; };
  }, [card]);

  /* The outcome chart, fetched only on reveal — before the call it would be
     the answer, sitting on screen. */
  useEffect(() => {
    let dead = false;
    if (!shown || !card || bars) return;
    const t = card.trade;
    if (!tickerFor(t.symbol, t.exchange)) return;
    (async () => {
      try {
        const res = await apiFetch("/api/bars", {
          method: "POST", body: JSON.stringify({ want: windowsFor([t]) }),
        });
        const payload = await res.json().catch(() => null);
        if (!dead && payload?.bars) setBars(payload.bars);
      } catch { /* the numbers below still tell the outcome */ }
    })();
    return () => { dead = true; };
  }, [shown, card, bars]);

  const call = (called) => {
    if (!card || shown) return;
    setAnswers((a) => [...a, { card, called }]);
    setShown(true);
  };

  const next = () => { setAt((i) => i + 1); setShown(false); setBars(null); };

  const s = useMemo(() => score(answers), [answers]);
  const v = useMemo(() => verdict(s), [s]);

  /* Written once, when the hand is finished. */
  useEffect(() => {
    if (!done || saved.current || !answers.length) return;
    saved.current = true;
    saveDrillSession(answers, reviews)
      .then(() => listDrillCards().then(setReviews).catch(() => {}))
      .catch(() => {});
  }, [done, answers, reviews]);

  /* ---------------- not enough to drill ---------------- */
  if (health.balanced < 2) {
    return (
      <div className="cd-empty">
        <div className="eyebrow">Chart drill</div>
        <p>
          This deals from the charts you attached to your own trades, mixing
          winners and losers and hiding which is which until you have called it.
        </p>
        <p className="cd-need">
          {health.total === 0
            ? "No closed trade has a chart attached yet. Attach one from a trade's detail panel, or from a diary entry linked to a trade."
            : `${health.total} closed trade${health.total === 1 ? " has" : "s have"} a chart — ${health.won} that won and ${health.lost} that lost. The deck is dealt in equal parts, so it needs at least one of each.`}
        </p>
        <p className="cd-why">
          Equal parts is not a detail. A deck that is mostly winners can be
          scored well by answering &ldquo;take&rdquo; to everything, which would
          measure your win rate rather than your eye.
        </p>
      </div>
    );
  }

  /* ---------------- the score ---------------- */
  if (done) {
    return (
      <div className="cd">
        <div className="eyebrow">How the hand went</div>
        <div className={`cd-verdict cd-${v.level}`}>
          <b>{v.headline}</b>
          <p>{v.detail}</p>
        </div>

        <div className="cd-matrix">
          <div className="cd-cell"><b>{s.tookWon}</b><span>took · won</span></div>
          <div className="cd-cell cd-bad"><b>{s.tookLost}</b><span>took · lost</span></div>
          <div className="cd-cell"><b>{s.passedWon}</b><span>passed · won</span></div>
          <div className="cd-cell cd-good"><b>{s.passedLost}</b><span>passed · lost</span></div>
        </div>

        <div className="cd-rates mono">
          {isFinite(s.precision) && <span>Of the ones you would take, <b>{Math.round(s.precision)}%</b> worked</span>}
          {isFinite(s.recall) && <span>Of the winners, you caught <b>{Math.round(s.recall)}%</b></span>}
        </div>

        <button className="btn" onClick={() => setSeed((x) => x + 1)}>
          <RotateCcw size={13} />Deal another hand
        </button>
        <style jsx>{STYLES}</style>
      </div>
    );
  }

  if (!card) return null;
  const r = shown ? reveal(card) : null;
  const mine = shown && bars ? barsFor(card.trade, bars) : null;

  /* ---------------- a card ---------------- */
  return (
    <div className="cd">
      <div className="cd-head">
        <div className="eyebrow">Card {at + 1} of {deck.length}</div>
        <div className="cd-run mono">
          {answers.length >= 1 && <>{s.right}/{s.n} so far</>}
        </div>
      </div>

      <div className="cd-shot">
        {img && !imgErr
          ? <img src={img} alt="" onError={() => setImgErr(true)} />
          : <div className="cd-noimg">
              {imgErr ? "This chart could not be loaded." : "Loading the chart…"}
            </div>}
        {/* Nothing identifying until the call is made. */}
        {!shown && <div className="cd-blind">Symbol and date hidden until you call it</div>}
      </div>

      {!shown ? (
        <div className="cd-ask">
          {imgErr ? (
            <>
              <span>Nothing to judge — this card has no picture to show.</span>
              <button className="btn ghost" onClick={next}>Skip it</button>
            </>
          ) : (
            <>
              <span>Would you take this?</span>
              {/* Disabled until the picture is up. A call made on a blank
                  rectangle is a coin flip entered into the score as judgement. */}
              <button className="btn" disabled={!img}
                      onClick={() => call("take")}><Check size={14} />Take it</button>
              <button className="btn ghost" disabled={!img}
                      onClick={() => call("pass")}><X size={14} />Pass</button>
            </>
          )}
        </div>
      ) : (
        <div className="cd-reveal">
          <div className="cd-out" data-won={r.won ? 1 : 0}>
            <b>{card.trade.symbol}</b>
            <span className="mono">{dmy(card.trade.entry_date)} → {dmy(card.trade.exit_date)}</span>
            <span className="mono cd-pnl">{isFinite(r.pnl) ? rupee(r.pnl) : "—"}</span>
            <span className="mono">{rfmt(r.r, 1)}</span>
            {isFinite(r.heldDays) && <span className="mono">{Math.round(r.heldDays)}d</span>}
            {r.exitReason && <span className="cd-reason">{r.exitReason}</span>}
          </div>

          {/* WHAT HAPPENED, beside what you saw. */}
          {hasBars(mine) && (
            <div className="cd-after">
              <div className="cd-aftertag">What happened</div>
              <TradeChart trade={card.trade} bars={mine} height={200} compact={false} />
            </div>
          )}

          {/* The trader's own sentence, returned at the moment it means
              something. This is the part worth building the feature for. */}
          {r.notes.length > 0 && (
            <div className="cd-notes">
              <div className="cd-aftertag">What you wrote at the time</div>
              {r.notes.map((n, i) => <blockquote key={i}>{n}</blockquote>)}
            </div>
          )}

          {(r.errors.length > 0 || r.outcomes.length > 0) && (
            <div className="cd-tags">
              {r.errors.map((t) => <i key={t} className="cd-err">{t}</i>)}
              {r.outcomes.map((t) => <i key={t} className="cd-neutral">{t}</i>)}
            </div>
          )}

          <button className="btn" onClick={next}>
            {at + 1 >= deck.length ? "See the score" : "Next card"}
          </button>
        </div>
      )}
      <style jsx>{STYLES}</style>
    </div>
  );
}

const STYLES = `
  .cd { max-width: 860px; }
  .cd-head { display: flex; align-items: baseline; justify-content: space-between; }
  .cd-run { font-size: 11px; color: var(--ink3); }

  .cd-shot { position: relative; margin-top: 10px; border: 1px solid var(--rule);
    border-radius: 3px; overflow: hidden; background: var(--card);
    min-height: 220px; display: grid; place-items: center; }
  .cd-shot img { display: block; width: 100%; height: auto; }
  .cd-noimg { font-size: 12px; color: var(--ink3); padding: 60px 0; }
  .cd-blind { position: absolute; top: 8px; left: 8px; font-size: 10px;
    letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink3);
    background: var(--paper); border: 1px solid var(--rule);
    padding: 3px 7px; border-radius: 2px; }

  .cd-ask { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
  .cd-ask span { font-size: 13px; color: var(--ink2); margin-right: 4px; }

  .cd-reveal { margin-top: 14px; display: flex; flex-direction: column; gap: 14px;
    align-items: flex-start; }
  .cd-out { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px;
    font-size: 12px; color: var(--ink3); padding: 9px 12px; border-radius: 3px;
    border: 1px solid var(--rule); background: var(--paper); width: 100%; }
  .cd-out b { font-size: 14px; color: var(--ink); }
  .cd-out .cd-pnl { color: var(--short); font-weight: 600; }
  .cd-out[data-won="1"] .cd-pnl { color: var(--long); }
  .cd-reason { color: var(--ink2); }

  .cd-after, .cd-notes { width: 100%; }
  .cd-aftertag { font-size: 9px; font-weight: 600; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--ink3); margin-bottom: 6px; }
  .cd-notes blockquote { margin: 0 0 8px; padding: 8px 12px; font-size: 12.5px;
    line-height: 1.55; color: var(--ink); border-left: 2px solid var(--brass);
    background: var(--paper); }

  .cd-tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .cd-tags i { font-style: normal; font-size: 10.5px; padding: 2px 8px;
    border-radius: 2px; border: 1px solid var(--rule); }
  .cd-err { color: var(--short); }
  .cd-neutral { color: var(--ink3); }

  .cd-verdict { margin: 10px 0 16px; padding: 12px 14px; border-radius: 3px;
    border: 1px solid var(--rule); background: var(--card); }
  .cd-verdict b { font-size: 14px; color: var(--ink); }
  .cd-verdict p { margin: 6px 0 0; font-size: 12.5px; line-height: 1.6; color: var(--ink2); }
  .cd-real { border-left: 3px solid var(--long); }
  .cd-inverted, .cd-chance { border-left: 3px solid var(--brass); }
  .cd-thin { border-left: 3px solid var(--rule); }

  .cd-matrix { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .cd-cell { border: 1px solid var(--rule); border-radius: 3px; padding: 10px 12px;
    background: var(--card); }
  .cd-cell b { display: block; font-size: 21px; font-variant-numeric: tabular-nums; }
  .cd-cell span { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--ink3); }
  .cd-good b { color: var(--long); }
  .cd-bad b { color: var(--short); }

  .cd-rates { display: flex; flex-wrap: wrap; gap: 18px; margin: 14px 0 18px;
    font-size: 12px; color: var(--ink3); }
  .cd-rates b { color: var(--ink); }

  .cd-empty { max-width: 640px; }
  .cd-empty p { font-size: 12.5px; line-height: 1.65; color: var(--ink2); }
  .cd-need { color: var(--ink); }
  .cd-why { color: var(--ink3); border-left: 2px solid var(--rule); padding-left: 12px; }

  @media (max-width: 620px) { .cd-matrix { grid-template-columns: repeat(2, 1fr); } }
`;
