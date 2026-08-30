"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { Check, ChevronRight } from "lucide-react";
import { rupee, rfmt, pct } from "@/lib/format";
import { STOP_NONE } from "@/lib/stops";

/**
 * Fill in the missing stops.
 *
 * One column of typing that turns a pile of imported P&L into something the
 * rest of the app can read. Until a trade has a stop it has no 1R, and without
 * 1R it is invisible to expectancy, the R distribution, drawdown in R and most
 * of the review page.
 *
 * Two things make this bearable at scale: R appears the moment you type, so
 * you can sanity-check each number against what you remember, and it saves in
 * batches so you can stop whenever and come back.
 */

const num = (v) => (v === "" || v == null ? NaN : Number(v));

/** A stop the importer guessed, not one anybody recorded. */
const isAssumed = (t) => t.stop_source === "assumed" && t.stop_loss != null;

/** A purchase date the importer invented, because the file carried none. */
const dateAssumed = (t) => t.entry_date_source === "assumed";

export default function StopFill({ trades, onSave, onDone, realStopCount = 0, pageSize = 25 }) {
  const [values, setValues] = useState({});      // id -> raw input
  /**
   * Purchase dates typed here, by trade id.
   *
   * A second map rather than a field on `values`, and deliberately so: the two
   * are answered independently. A holdings import leaves both the stop and the
   * date missing on the same row, but somebody may know one and not the other,
   * and a single map would make "typed a stop" and "typed a date" impossible
   * to tell apart — which is exactly the distinction that decides whether a
   * guess gets relabelled as a fact.
   */
  const [dates, setDates] = useState({});        // id -> YYYY-MM-DD
  const [saved, setSaved] = useState({});        // id -> true once written
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputs = useRef({});
  // The bulk fill. Typing a thousand stops one at a time is not going to
  // happen, and until they exist the journal shows nothing at all.
  const [bulkPct, setBulkPct] = useState("7");
  const [confirming, setConfirming] = useState(false);
  const [noneConfirming, setNoneConfirming] = useState(false);
  const [progress, setProgress] = useState(null);

  const pending = useMemo(
    () => trades.filter((t) => !saved[t.id]),
    [trades, saved]
  );

  /**
   * What the box shows: what you have typed, or the assumed stop already
   * there, or nothing.
   *
   * Derived rather than seeded into state on mount, so `values` keeps meaning
   * exactly one thing — what this person typed. That distinction is the whole
   * of the next paragraph.
   */
  const shown = useCallback(
    (t) => (values[t.id] !== undefined
      ? values[t.id]
      : isAssumed(t) ? String(t.stop_loss) : ""),
    [values]
  );

  /**
   * Only edited rows are saved.
   *
   * A screen full of pre-filled 7% guesses with a Save button would, on one
   * click, relabel every one of them as recorded — turning "nobody has checked
   * these" into "somebody confirmed these" without anybody having done so.
   * That is worse than leaving them assumed, because the flag is the only
   * thing that remembers they were guesses.
   *
   * So an untouched row stays assumed and stays on this list. Reviewing a
   * stop means changing it, or typing the same number back to say you meant
   * it.
   *
   * A ONE-CLICK "the guess was right" WAS BUILT HERE AND TAKEN BACK OUT. It
   * read as an obvious kindness — confirming a row cost more effort than
   * changing it, which is backwards — and it was the wrong control, because
   * the effort IS the check. A tick sitting on every unedited row invites
   * somebody tired to go down the page accepting numbers nobody has looked at,
   * and a keystroke that did the same made it faster still. What comes out the
   * other side is a thousand invented stops wearing the word "recorded", which
   * is the single thing this screen exists to prevent. Retyping the number is
   * friction that buys something: you cannot type 17098.05 without reading it.
   */
  const touched = useCallback((t) => values[t.id] !== undefined, [values]);

  /**
   * The same rule for dates, and it matters more here than for stops.
   *
   * The box is pre-filled with the assumed date, because an empty date field
   * gives somebody nothing to correct — they would have to remember the whole
   * date rather than adjust one. But a pre-filled value is not an answer, so
   * only a row that was actually edited is written back as recorded. Saving
   * the untouched ones would relabel ten guesses as ten checked facts on one
   * click, and the flag is the only thing that remembers they were guesses.
   */
  const dateTouched = useCallback((t) => dates[t.id] !== undefined, [dates]);
  const dateShown = useCallback(
    (t) => (dates[t.id] !== undefined ? dates[t.id] : t.entry_date || ""),
    [dates]
  );
  /** Typed, different from the guess, and not in the future. */
  const dateReady = useCallback((t) => {
    if (!dateTouched(t)) return false;
    const v = dates[t.id];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v || "")) return false;
    if (v > new Date().toISOString().slice(0, 10)) return false;
    return true;
  }, [dates, dateTouched]);

  const missingCount = pending.filter((t) => t.stop_loss == null).length;
  const assumedCount = pending.filter(
    (t) => t.stop_loss != null && t.stop_source === "assumed"
  ).length;
  /** Rows on this list only because their purchase date was invented. */
  const needDateCount = pending.filter(dateAssumed).length;

  /**
   * Rows the bulk fill is allowed to touch, which is NOT everything pending.
   *
   * Since dates joined this queue, a row can be here with a perfectly good
   * stop it only needs a date. `fillAll` walks this list rather than `pending`
   * because walking `pending` would write a 7% guess over a stop somebody
   * recorded by hand — a one-click, silent overwrite of the one number this
   * whole app divides by.
   */
  const stopPending = useMemo(
    () => pending.filter((t) => t.stop_loss == null || t.stop_source === "assumed"),
    [pending]
  );

  const slice = useMemo(
    () => pending.slice(page * pageSize, (page + 1) * pageSize),
    [pending, page, pageSize]
  );

  /** R the moment a stop is typed — the check against what you remember. */
  const preview = useCallback((t) => {
    const stop = num(shown(t));
    const entry = Number(t.entry_price);
    const qty = Number(t.quantity);
    if (!(stop > 0) || !(entry > 0)) return null;

    const dir = t.side === "short" ? -1 : 1;
    const riskPerShare = Math.abs(entry - stop);
    if (!(riskPerShare > 0)) return { invalid: "stop equals entry" };

    // A long stop above entry, or a short stop below it, is the wrong side
    const wrongSide = dir === 1 ? stop >= entry : stop <= entry;
    if (wrongSide) return { invalid: dir === 1 ? "stop is above entry" : "stop is below entry" };

    const riskAmt = riskPerShare * qty;
    const slPct = (riskPerShare / entry) * 100;

    // A stop within a whisker of entry is almost always a typo, and it is a
    // costly one: a 0.04% stop on a winner reports +184R and single-handedly
    // wrecks the expectancy figure. Flagged rather than blocked — a genuinely
    // tight stop is possible, just rare enough to be worth a second look.
    const suspicious = slPct < 1;

    const exit = Number(t.exit_price);
    const pnl = isFinite(exit)
      ? (exit - entry) * qty * dir - (Number(t.charges) || 0)
      : NaN;

    return {
      slPct,
      riskAmt,
      r: riskAmt > 0 && isFinite(pnl) ? pnl / riskAmt : NaN,
      wide: slPct > 12,
      suspicious,
    };
  }, [shown]);

  // What Save will actually write — typed and valid. Counting pre-filled rows
  // here would promise to save rows that are deliberately left alone.
  /** A stop typed and valid — the row's other half is judged separately. */
  const stopReady = useCallback((t) => {
    const p = preview(t);
    return touched(t) && p && !p.invalid;
  }, [preview, touched]);

  // Either answer counts. A row where somebody knew the purchase date but not
  // the stop is still progress, and a button that ignored it would look broken.
  const readyCount = slice.filter((t) => stopReady(t) || dateReady(t)).length;

  const saveBatch = async () => {
    const rows = slice
      .map((t) => {
        const wantStop = stopReady(t);
        const wantDate = dateReady(t);
        if (!wantStop && !wantDate) return null;
        return {
          id: t.id,
          // Only the half that was answered. saveStops builds its patch from
          // the keys present, so an untouched stop is left exactly as it is
          // rather than overwritten with undefined.
          ...(wantStop
            ? {
                stop_loss: Number(shown(t)),
                // Typed in here by hand, whatever the row started as. Filling
                // one over an assumed stop is what turns it into a real one.
                stop_source: "recorded",
              }
            : {}),
          ...(wantDate
            ? { entry_date: dates[t.id], entry_date_source: "recorded" }
            : {}),
        };
      })
      .filter(Boolean);

    if (!rows.length) return;
    setBusy(true); setErr("");
    try {
      await onSave(rows);
      setSaved((s) => {
        const next = { ...s };
        rows.forEach((r) => (next[r.id] = true));
        return next;
      });
      setPage(0);
    } catch (e) {
      setErr(e.message || "Could not save. Nothing was changed.");
    }
    setBusy(false);
  };

  const pctNum = Number(bulkPct);
  const pctOk = pctNum > 0 && pctNum < 100;

  /* What the R half of the app would still have to read once these leave.
     Counted on the whole book, which only the page has, and said BEFORE the
     click rather than discovered after it. */
  const realStops = realStopCount;

  /**
   * Give every remaining trade the same stop, as a percentage from its entry.
   *
   * Marked assumed, not recorded — the same flag the importer sets. This is one
   * number applied to a thousand trades, which is a what-if about consistent
   * risk, not a record of where the stops were. Anything filled in by hand
   * afterwards overwrites both the number and the label.
   */
  /**
   * Mark the queue as having no stop on record.
   *
   * Writes `stop_source` and NOTHING else — `stop_loss` keeps whatever the
   * importer put there, because the column is `not null check (> 0)` and a
   * stop of zero would mean breakeven rather than none. Nothing reads it
   * while the source says none; see stops.js.
   */
  const markNone = async () => {
    if (busy) return;
    setBusy(true); setErr(""); setNoneConfirming(false);

    const rows = stopPending.map((t) => ({ id: t.id, stop_source: STOP_NONE }));
    try {
      await onSave(rows, (n, total) => setProgress({ n, total }));
      setSaved((s) => {
        const next = { ...s };
        rows.forEach((r) => (next[r.id] = true));
        return next;
      });
    } catch (e) {
      setErr(e?.message || "Could not save.");
    } finally {
      setBusy(false); setProgress(null);
    }
  };

  const fillAll = async () => {
    if (!pctOk || busy) return;
    setBusy(true); setErr(""); setConfirming(false);

    // stopPending, never pending — see the note where it is defined.
    const rows = stopPending
      .map((t) => {
        const entry = Number(t.entry_price);
        if (!(entry > 0)) return null;
        // A short's stop sits above entry; everything imported is long, but
        // this screen is not only for imports.
        const dir = t.side === "short" ? -1 : 1;
        const stop = Math.round(entry * (1 - (dir * pctNum) / 100) * 100) / 100;
        return stop > 0
          ? { id: t.id, stop_loss: stop, stop_source: "assumed" }
          : null;
      })
      .filter(Boolean);

    try {
      await onSave(rows, (n, total) => setProgress({ n, total }));
      setSaved((s) => {
        const next = { ...s };
        rows.forEach((r) => (next[r.id] = true));
        return next;
      });
      setPage(0);
    } catch (e) {
      setErr(e.message || "Could not fill them. Nothing was changed.");
    }
    setProgress(null);
    setBusy(false);
  };

  /**
   * Undo the typing and put the guess back.
   *
   * Worth its own control because the assumed number is not recoverable
   * otherwise: type over 1038.4 and the only copy of it on this screen is
   * gone, so a misremembered correction could only be undone by leaving the
   * queue and coming back. Deleting the key rather than writing the old value
   * back is what returns the row to genuinely untouched, not to a typed value
   * that happens to match.
   */
  /* Enter moves to the next row rather than submitting — this is a data
     entry screen and you want to keep your hands where they are.

     It deliberately does not record anything on the way past. Travelling down
     this list and answering it are different acts — you scroll through reading
     R against what you remember, and most rows you pass are ones you have
     nothing to say about yet. A key that turned a guess into a fact in passing
     was tried here and taken out. */
  const onKey = (e, i) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      inputs.current[slice[i + 1]?.id]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      inputs.current[slice[i - 1]?.id]?.focus();
    }
  };

  if (!pending.length) {
    return (
      <section className="sf-done">
        <div className="sf-tick"><Check size={18} /></div>
        <h2 className="disp sf-h">Nothing left to check</h2>
        <p>
          Every trade has a stop you have recorded and a purchase date you have
          confirmed, so expectancy, the R distribution, holding period and the
          review page are all reading your own numbers rather than guesses.
        </p>
        <button className="btn" onClick={() => onDone?.()}>Back to the journal</button>
        <style jsx>{`
          .sf-done {
            text-align: center; padding: 34px 24px; border: 1px solid var(--rule);
            background: var(--card); border-radius: 3px;
          }
          .sf-tick {
            width: 38px; height: 38px; border-radius: 50%; margin: 0 auto 12px;
            display: flex; align-items: center; justify-content: center;
            background: var(--long); color: var(--paper);
          }
          .sf-h { font-size: 18px; margin: 0 0 8px; }
          p { font-size: 13px; color: var(--ink2); margin: 0 0 18px; }
        `}</style>
      </section>
    );
  }

  return (
    <section>
      <div className="sf-head">
        <div>
          <div className="eyebrow">
            {/* Dates only get top billing when they are the whole job. A
                holdings import leaves both missing on the same rows, and
                "Stops to add and check" is still the bigger of the two —
                without a stop there is no R at all. */}
            {!missingCount && !assumedCount && needDateCount ? "Add the missing purchase dates"
              : missingCount && assumedCount ? "Stops to add and check"
              : missingCount ? "Add the missing stops"
              : "Check the assumed stops"}
          </div>
          <div className="sf-sub">
            {/* Said separately because they are not the same problem. A trade
                with no stop has no R at all; a trade with an assumed one has an
                R computed from a percentage nobody chose for it, which reads
                like a real number and is not. */}
            {missingCount > 0 && (
              <>{missingCount} without one{assumedCount ? ", " : ". "}</>
            )}
            {assumedCount > 0 && (
              <>
                {assumedCount} carrying a stop the importer assumed
                {missingCount ? "" : " — a percentage below entry, not what you used"}.{" "}
              </>
            )}
            {(missingCount > 0 || assumedCount > 0) &&
              "R appears as you type — check it against what you remember."}

            {/* Third sentence, and only when there is something to say. A
                holdings file states what you own and never when you bought it,
                so these rows arrive missing both answers — and the date is the
                one nobody expects to be missing, because every other import
                has carried it. */}
            {needDateCount > 0 && (
              <>
                {" "}
                <b>{needDateCount} {needDateCount === 1 ? "has" : "have"} a purchase date
                that was invented</b>, because a holdings file carries none — look
                {needDateCount === 1 ? " it" : " them"} up at your broker and the
                holding period starts counting.
              </>
            )}
            {(assumedCount > 0 || needDateCount > 0) &&
              " Leave one alone and it stays marked assumed."}
          </div>
        </div>
        <button className="btn ghost sm" onClick={() => onDone?.()}>Do this later</button>
      </div>

      {/* Hidden when every remaining row already has a stop it recorded and is
          only here for its date. A control offering to fill stops that are all
          filled reads as a screen that has not noticed what you did. */}
      {stopPending.length > 0 && (
      <div className="sf-bulk">
        {noneConfirming ? (
          <>
            <div className="sf-bulk-ask">
              Mark all {stopPending.length} as having no stop on record? They leave this queue
              for good and stay in every money figure, but nothing measured in R will count
              them again{realStops > 0
                ? `, leaving ${realStops} trade${realStops === 1 ? "" : "s"} for the R half of
                   the app to read`
                : `, and on this journal that leaves the R half of the app with nothing to read`}.
              You can still type a real stop on any of them later.
            </div>
            <div className="sf-bulk-acts">
              <button className="btn" onClick={markNone} disabled={busy}>
                {busy
                  ? progress ? `Marking ${progress.n} of ${progress.total}…` : "Marking…"
                  : `Yes, no stop on record for ${stopPending.length}`}
              </button>
              <button className="btn ghost" onClick={() => setNoneConfirming(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </>
        ) : confirming ? (
          <>
            <div className="sf-bulk-ask">
              Give all {stopPending.length} of them a stop {pctNum}% from entry?
              They&apos;ll be marked assumed, and the R figures they produce describe a
              steady {pctNum}% risk rather than what you actually took. Replace any of
              them by typing over it.
            </div>
            <div className="sf-bulk-acts">
              <button className="btn" onClick={fillAll} disabled={busy}>
                {busy
                  ? progress ? `Filling ${progress.n} of ${progress.total}…` : "Filling…"
                  : `Yes, fill all ${stopPending.length}`}
              </button>
              <button className="btn ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="sf-bulk-pct">
              <span>Fill them all at</span>
              <input className="in" inputMode="decimal" value={bulkPct}
                     aria-label="Percent below entry"
                     onChange={(e) => setBulkPct(e.target.value)} />
              <span>% from entry</span>
            </div>
            <button className="btn ghost sm" onClick={() => setConfirming(true)} disabled={!pctOk}>
              Fill the remaining {stopPending.length}
            </button>
            <div className="sf-bulk-note">
              {pctOk
                ? "A starting point, so R and the plots work at all. Marked assumed — " +
                  "type over any of them as you work out what you really used."
                /* "between 0 and 100" while refusing 0 is not what the rule
                   says. Zero is also what somebody types when they mean there
                   was no stop, which is a real answer and now has a button of
                   its own rather than an error message. */
                : "That needs to be more than 0 and no more than 100. If there was no stop " +
                  "on these at all, say so below instead."}
            </div>

            {/**
              * THE THIRD ANSWER, AND THE REASON THIS QUEUE CAN NOW EMPTY.
              *
              * A Zerodha tax P&L carries no stop column, so every imported
              * trade arrives assumed. The only ways out were typing a number
              * that was not true — which puts an invented 1R under every R
              * figure in the app — or leaving it assumed and being nagged for
              * ever. Somebody whose files never carried stops had no honest
              * move at all.
              *
              * Named for what is knowable. "No stop on record" is always true
              * of these; "I traded without a stop" often is not, since the
              * importer assumed one because the FILE lacked a column.
              */}
            <div className="sf-bulk-none">
              <button className="btn ghost sm" onClick={() => setNoneConfirming(true)}>
                Or: no stop on record for these {stopPending.length}
              </button>
              <div className="sf-bulk-note">
                Says the number cannot be recovered rather than inventing one. They leave this
                queue for good, stay in every money figure — P&amp;L, win rate, XIRR — and drop out
                of everything measured in R, because there is no 1R to measure against.
                {realStops > 0
                  ? ` That leaves ${realStops} trade${realStops === 1 ? "" : "s"} carrying a stop
                     you set, which is what the R half of the app would then be reading.`
                  : " On this journal that leaves nothing for the R half of the app to read."}
                {" "}Reversible — type a real stop later and it counts again.
              </div>
            </div>
          </>
        )}
      </div>
      )}

      <div className="card scroll">
        <table className="t">
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="num">In</th>
              <th className="num">Out</th>
              <th className="num">Qty</th>
              <th className="num">Entry</th>
              <th className="num">Exit</th>
              <th className="num">Net P&amp;L</th>
              <th className="num sf-stopcol">Stop</th>
              <th className="num">SL %</th>
              <th className="num">R</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((t, i) => {
              const p = preview(t);
              const pnl = isFinite(Number(t.exit_price))
                ? (Number(t.exit_price) - Number(t.entry_price)) * Number(t.quantity) *
                  (t.side === "short" ? -1 : 1) - (Number(t.charges) || 0)
                : NaN;
              return (
                <tr key={t.id}>
                  <td><b className="disp">{t.symbol}</b></td>
                  {/* Editable only where the importer invented it. A date that
                      came from a tax P&L or was typed by hand is a fact, and
                      offering to change it here would invite editing the one
                      thing on the row that is not in question. */}
                  <td className="num mono sf-dim">
                    {dateAssumed(t) ? (
                      <>
                        <input
                          className="in sf-in sf-date"
                          type="date"
                          max={new Date().toISOString().slice(0, 10)}
                          value={dateShown(t)}
                          onChange={(e) =>
                            setDates((d) => ({ ...d, [t.id]: e.target.value }))
                          }
                          title="Your holdings file carried no purchase date, so this one was invented. Look it up at your broker and it starts counting."
                        />
                        {!dateTouched(t) && <i className="sf-assumed">assumed</i>}
                      </>
                    ) : (
                      t.entry_date
                    )}
                  </td>
                  <td className="num mono sf-dim">{t.exit_date}</td>
                  <td className="num">{t.quantity}</td>
                  <td className="num">{Number(t.entry_price).toFixed(2)}</td>
                  <td className="num">{Number(t.exit_price).toFixed(2)}</td>
                  <td className={`num ${pnl >= 0 ? "pos" : "neg"}`}>{rupee(pnl)}</td>
                  <td className="num">
                    <input
                      ref={(el) => (inputs.current[t.id] = el)}
                      className="in sf-in"
                      inputMode="decimal"
                      placeholder="—"
                      value={shown(t)}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [t.id]: e.target.value.replace(/[^0-9.]/g, "") }))
                      }
                      onKeyDown={(e) => onKey(e, i)}
                      data-bad={p?.invalid ? 1 : 0}
                    />
                  </td>
                  <td className="num sf-dim" title={p?.invalid || ""}>
                    {p?.invalid ? "—" : p ? (
                      <span
                        style={{ color: p.wide || p.suspicious ? "var(--short)" : undefined }}
                        title={p.suspicious ? "That stop is within 1% of entry — check it" : ""}
                      >
                        {pct(p.slPct)}{p.suspicious ? " ?" : ""}
                      </span>
                    ) : "—"}
                  </td>
                  <td className={`num ${p && !p.invalid && isFinite(p.r) ? (p.r >= 0 ? "pos" : "neg") : "sf-dim"}`}
                      style={{ fontWeight: 500 }}>
                    {p?.invalid ? p.invalid : p && isFinite(p.r) ? rfmt(p.r) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {err && <div className="warn sf-err">{err}</div>}

      <div className="sf-foot">
        <span className="sf-dim">
          Showing {slice.length} of {pending.length}
          {readyCount > 0 && <> · {readyCount} ready to save</>}
        </span>
        <div className="sf-actions">
          {pending.length > slice.length && (
            <button className="btn ghost" onClick={() => setPage((p) => p + 1)}>
              Skip these <ChevronRight size={12} />
            </button>
          )}
          <button className="btn" onClick={saveBatch} disabled={busy || !readyCount}>
            <Check size={13} /> {busy ? "Saving…" : `Save ${readyCount}`}
          </button>
        </div>
      </div>

      <style jsx>{`
        .sf-bulk {
          display: grid; grid-template-columns: auto auto 1fr; gap: 10px 16px;
          align-items: center; margin-bottom: 12px; padding: 12px 14px;
          border: 1px solid var(--brass); border-radius: 3px; background: #FDFAF3;
        }
        .sf-bulk-pct { display: flex; align-items: center; gap: 7px; font-size: 13px; }
        .sf-bulk-pct .in { width: 62px; padding: 5px 8px; font-size: 13px; }
        .sf-bulk-note, .sf-bulk-ask {
          font-size: 11px; color: var(--ink3); line-height: 1.55; text-wrap: pretty;
        }
        .sf-bulk-ask { grid-column: 1 / -1; color: #6B4E13; font-size: 12px; }
        .sf-bulk-acts { grid-column: 1 / -1; display: flex; gap: 8px; }
        @media (max-width: 640px) { .sf-bulk { grid-template-columns: 1fr; } }
        .sf-head {
          display: flex; align-items: flex-end; justify-content: space-between;
          gap: 14px; margin-bottom: 11px; flex-wrap: wrap;
        }
        .sf-sub {
          font-size: 12px; color: var(--ink2); margin-top: 3px;
          max-width: 520px; text-wrap: pretty;
        }
        .sf-dim { color: var(--ink3); font-size: 11.5px; }
        .sf-stopcol { min-width: 86px; }
        .sf-err { margin-top: 11px; }
        /*
          PINNED TO THE BOTTOM OF THE VIEWPORT, because this list is a thousand
          rows long and the button that commits them was at the end of it.
          Twenty-five careful corrections then sat below the fold behind a
          scroll, and "Skip these" — which only advances the page — was the
          easier thing to reach. Work got dropped by people doing everything
          right.

          It also carries the count, so "2 ready to save" is in view the whole
          time you are typing rather than being something you go and look for.

          A per-row tick and undo were built to solve the same problem and
          removed: two controls on every edited row, reserving width beside the
          number, to save a trip that the bar simply removes.
        */
        .sf-foot {
          display: flex; align-items: center; justify-content: space-between;
          gap: 14px; flex-wrap: wrap;
          position: sticky; bottom: 0; z-index: 3;
          margin-top: 0; padding: 12px 2px;
          background: var(--paper); border-top: 1px solid var(--rule);
        }
        .sf-actions { display: flex; gap: 9px; }
      `}</style>
      <style jsx global>{`
        .sf-in {
          width: 82px; padding: 5px 8px; font-size: 13px; text-align: right;
        }
        .sf-in[data-bad="1"] { border-color: var(--short); }
        /* Wider than the stop box because a date control carries its own
           picker button, and left-aligned because it reads as a date rather
           than a quantity. */
        .sf-date {
          width: 142px; text-align: left; font-variant-numeric: tabular-nums;
        }
        /* Sits under the box like the stop column's own hints, so the row's
           two unanswered questions look the same as each other. */
        .sf-assumed {
          display: block; font-style: normal; font-size: 9px; margin-top: 2px;
          letter-spacing: 0.06em; text-transform: uppercase; color: var(--brass);
        }

      `}</style>
    </section>
  );
}
