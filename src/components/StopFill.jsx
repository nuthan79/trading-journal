"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { Check, ChevronRight } from "lucide-react";
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

export default function StopFill({ trades, onSave, onDone, pageSize = 25 }) {
  const [values, setValues] = useState({});      // id -> raw input
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

  const slice = useMemo(
    () => pending.slice(page * pageSize, (page + 1) * pageSize),
    [pending, page, pageSize]
  );

  /** R the moment a stop is typed — the check against what you remember. */
  const preview = useCallback((t) => {
    const stop = num(values[t.id]);
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
  }, [values]);

  const readyCount = slice.filter((t) => {
    const p = preview(t);
    return p && !p.invalid;
  }).length;

  const saveBatch = async () => {
    const rows = slice
      .map((t) => ({ t, p: preview(t) }))
      .filter(({ p }) => p && !p.invalid)
      // The trade's existing 1R rides along so saveStops can tell "never had a
      // stop" from "already has one". These rows are all the former today, but
      // sending it means re-filling a stop can never re-base an existing 1R.
      .map(({ t }) => ({
        id: t.id,
        stop_loss: Number(values[t.id]),
        // Typed in here by hand, whatever the row started as. Filling one over
        // an assumed stop is the act that turns it into a real one.
        stop_source: "recorded",
      }));

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

    const rows = pending
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

  /* Enter moves to the next row rather than submitting — this is a data
     entry screen and you want to keep your hands where they are. */
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
        <h2 className="disp sf-h">Every trade has a stop</h2>
        <p>Expectancy, R distribution and the review page now include them all.</p>
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
          <div className="eyebrow">Add the missing stops</div>
          <div className="sf-sub">
            {pending.length} trade{pending.length === 1 ? "" : "s"} without one.
            R appears as you type — check it against what you remember.
          </div>
        </div>
        <button className="btn ghost sm" onClick={() => onDone?.()}>Do this later</button>
      </div>

      <div className="sf-bulk">
        {confirming ? (
          <>
            <div className="sf-bulk-ask">
              Give all {pending.length} of them a stop {pctNum}% from entry?
              They&apos;ll be marked assumed, and the R figures they produce describe a
              steady {pctNum}% risk rather than what you actually took. Replace any of
              them by typing over it.
            </div>
            <div className="sf-bulk-acts">
              <button className="btn" onClick={fillAll} disabled={busy}>
                {busy
                  ? progress ? `Filling ${progress.n} of ${progress.total}…` : "Filling…"
                  : `Yes, fill all ${pending.length}`}
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
              Fill the remaining {pending.length}
            </button>
            <div className="sf-bulk-note">
              {pctOk
                ? "A starting point, so R and the plots work at all. Marked assumed — " +
                  "type over any of them as you work out what you really used."
                : "That needs to be a percentage between 0 and 100."}
            </div>
          </>
        )}
      </div>

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
                  <td className="num mono sf-dim">{t.entry_date}</td>
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
                      value={values[t.id] ?? ""}
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
      `}</style>
    </section>
  );
}
