"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { Check, ChevronRight, Undo2 } from "lucide-react";
import { rupee, rfmt, pct } from "@/lib/format";

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

export default function StopFill({ trades, onSave, onDone, pageSize = 25 }) {
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
  /**
   * Rows ticked to say the guess was already right, by trade id.
   *
   * The other way to answer a row. Until this existed the only way to accept
   * an assumed stop was to retype it — the rule was literally "changing it, or
   * typing the same number back to say you meant it" — which is invisible on
   * screen and, on a bulk 7% fill where plenty of them genuinely were 7%, cost
   * more effort to confirm a row than to change it. Retyping 17098.05 to mean
   * "yes, 17098.05" also puts a fat finger between a guess and a recorded
   * fact, which is the one place in this app that must not happen quietly.
   *
   * Separate from `values` on purpose: `values` means "what this person
   * typed", and a tick is not typing. Keeping them apart is what lets the row
   * offer undo for one and not the other.
   */
  const [confirmed, setConfirmed] = useState({});  // id -> true
  const [saved, setSaved] = useState({});        // id -> true once written
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputs = useRef({});
  // The bulk fill. Typing a thousand stops one at a time is not going to
  // happen, and until they exist the journal shows nothing at all.
  const [bulkPct, setBulkPct] = useState("7");
  const [confirming, setConfirming] = useState(false);
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

  /** Typed over. The half of "answered" that has something to undo. */
  const edited = useCallback((t) => values[t.id] !== undefined, [values]);

  /**
   * Only answered rows are saved, and there are two ways to answer.
   *
   * A screen full of pre-filled 7% guesses with a Save button would, on one
   * click, relabel every one of them as recorded — turning "nobody has checked
   * these" into "somebody confirmed these" without anybody having done so.
   * That is worse than leaving them assumed, because the flag is the only
   * thing that remembers they were guesses.
   *
   * So an unanswered row stays assumed and stays on this list. What changed is
   * that saying "the guess was right" is now a tick rather than retyping the
   * number, which was the previous answer and was both undiscoverable and
   * absurd at four figures of rows.
   *
   * THE SAFEGUARD IS THAT IT STAYS PER ROW. One tick answers one trade. There
   * is deliberately no tick-all: a control that relabelled a page of guesses
   * as facts in one click is exactly the hazard this rule exists to prevent,
   * and it would not stop being that hazard for having a nicer icon.
   */
  const touched = useCallback(
    (t) => values[t.id] !== undefined || confirmed[t.id] === true,
    [values, confirmed]
  );

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

  /**
   * Give every remaining trade the same stop, as a percentage from its entry.
   *
   * Marked assumed, not recorded — the same flag the importer sets. This is one
   * number applied to a thousand trades, which is a what-if about consistent
   * risk, not a record of where the stops were. Anything filled in by hand
   * afterwards overwrites both the number and the label.
   */
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
   * A row can be ticked when there is a guess sitting in it and nobody has
   * typed over it. A row with no stop at all has nothing to agree with, and a
   * row already typed into is already answered — offering a tick there would
   * be a second control for a job that is done.
   */
  const canConfirm = useCallback(
    (t) => isAssumed(t) && values[t.id] === undefined,
    [values]
  );

  const toggleConfirm = useCallback((t) => {
    setConfirmed((c) => {
      const next = { ...c };
      if (next[t.id]) delete next[t.id]; else next[t.id] = true;
      return next;
    });
  }, []);

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
  const revert = useCallback((t) => {
    setValues((v) => { const n = { ...v }; delete n[t.id]; return n; });
    setConfirmed((c) => { const n = { ...c }; delete n[t.id]; return n; });
    inputs.current[t.id]?.focus();
  }, []);

  /* Enter moves to the next row rather than submitting — this is a data
     entry screen and you want to keep your hands where they are.

     ENTER ALSO TICKS, when the row is one that can be ticked. That is the
     whole point of the tick at this scale: a page of stops that were already
     right is reviewed by pressing Enter down it, reading the R as it goes,
     rather than by hunting a mouse across twenty-five small targets. Still one
     deliberate keypress per row, so it is not the bulk relabel the tick is
     careful not to be.

     The arrows deliberately do NOT tick. Browsing the list and answering it
     are different acts, and only one of them should turn a guess into a fact. */
  const onKey = (e, i) => {
    const t = slice[i];
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      if (e.key === "Enter" && t && canConfirm(t) && !confirmed[t.id]) toggleConfirm(t);
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
            {/* Says the tick exists, because a control that only appears on
                hover-adjacent rows is one nobody finds, and the keystroke is
                the part that makes four figures of rows reviewable at all. */}
            {assumedCount > 0 && (
              <>
                {" "}Where the guess was already right, tick it or press Enter
                to record it as it stands.
              </>
            )}
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
            {/* The bulk-fill banner below still says "type over any of them",
                which was the only way to answer a row when it was written. */}
          </div>
        </div>
        <button className="btn ghost sm" onClick={() => onDone?.()}>Do this later</button>
      </div>

      {/* Hidden when every remaining row already has a stop it recorded and is
          only here for its date. A control offering to fill stops that are all
          filled reads as a screen that has not noticed what you did. */}
      {stopPending.length > 0 && (
      <div className="sf-bulk">
        {confirming ? (
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
                  "type over the ones you got wrong, tick the ones you got right."
                : "That needs to be a percentage between 0 and 100."}
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
                    <div className="sf-stopcell">
                      <input
                        ref={(el) => (inputs.current[t.id] = el)}
                        className="in sf-in"
                        inputMode="decimal"
                        placeholder="—"
                        value={shown(t)}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^0-9.]/g, "");
                          setValues((v) => ({ ...v, [t.id]: raw }));
                          // Typing supersedes a tick. Leaving both set would
                          // leave the row claiming to be answered two ways.
                          setConfirmed((c) => {
                            if (!c[t.id]) return c;
                            const n = { ...c }; delete n[t.id]; return n;
                          });
                        }}
                        onKeyDown={(e) => onKey(e, i)}
                        data-bad={p?.invalid ? 1 : 0}
                      />
                      {/*
                        TWO MARKS, TWO DIFFERENT QUESTIONS, so they are not a
                        yes/no pair and are deliberately not drawn as one. The
                        tick answers "was the guess right?" and only appears
                        where a guess is still standing. The undo answers "did
                        I mean to type that?" and only appears once something
                        was typed. A cross for the second would read as delete,
                        or as "this stop is wrong", next to a number whose
                        whole job is being right.

                        Never both at once, so the slot holds one control.
                      */}
                      {canConfirm(t) ? (
                        <button
                          type="button"
                          className="sf-mark"
                          data-on={confirmed[t.id] ? 1 : 0}
                          onClick={() => toggleConfirm(t)}
                          title={confirmed[t.id]
                            ? "Marked as the stop you used. Click to undo."
                            : "The guess is right — record it as it stands (or press Enter)"}
                          aria-label="Confirm this stop"
                          aria-pressed={confirmed[t.id] ? "true" : "false"}
                        >
                          <Check size={13} />
                        </button>
                      ) : edited(t) ? (
                        <button
                          type="button"
                          className="sf-mark sf-undo"
                          onClick={() => revert(t)}
                          title="Put the assumed stop back"
                          aria-label="Undo this edit"
                        >
                          <Undo2 size={13} />
                        </button>
                      ) : (
                        <span className="sf-mark sf-mark-gap" aria-hidden="true" />
                      )}
                    </div>
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
        .sf-foot {
          display: flex; align-items: center; justify-content: space-between;
          gap: 14px; margin-top: 12px; flex-wrap: wrap;
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

        /*
          The mark sits INSIDE the stop cell rather than in a column of its
          own. A column between Stop and SL% would push two live figures
          rightwards on every row to serve a control that is blank on most of
          them, and the mark belongs beside the number it is answering for.
        */
        .sf-stopcell {
          display: flex; align-items: center; justify-content: flex-end; gap: 6px;
        }
        /*
          The empty span holds the slot open. Without it the input jumps
          sideways the moment a row gains or loses its mark, and a table where
          the column edge moves as you type down it is unreadable.
        */
        .sf-mark {
          flex: none; width: 22px; height: 22px; border-radius: 3px;
          display: inline-flex; align-items: center; justify-content: center;
          border: 1px solid transparent; background: none; padding: 0;
          color: var(--ink3); cursor: pointer;
        }
        .sf-mark-gap { cursor: default; }
        .sf-mark:hover { color: var(--ink); background: var(--card); border-color: var(--rule); }
        /* Brass, not green. Green is the gain colour two columns away in R,
           and a tick that borrowed it would read as a good result rather than
           as a recorded fact. Brass is what this screen already uses for
           "assumed", which is the state being resolved. */
        .sf-mark[data-on="1"] {
          color: var(--brass); border-color: var(--brass); background: none;
        }
        .sf-mark[data-on="1"]:hover { background: var(--card); }
        .sf-undo:hover { color: var(--short); }
        .sf-mark:focus-visible {
          outline: 2px solid var(--brass); outline-offset: 1px;
        }
      `}</style>
    </section>
  );
}
