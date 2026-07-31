"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Upload, Check, AlertTriangle, X, FileSpreadsheet } from "lucide-react";
import { parseZerodhaTaxPnl, findTradewiseSheet, INCLUDED_SECTIONS } from "@/lib/zerodha";
import { rupee, pct } from "@/lib/format";

/**
 * Import from a Zerodha Tax P&L export.
 *
 * Nothing is written until the preview has been seen and confirmed. The
 * preview is the point of the screen: the report splits one position across
 * many matched-lot rows, so what you get out is nothing like what you can see
 * in the file, and you should be able to check it before it lands.
 */

const COLUMN_LABEL = {
  buyValue: "Buy Value",
  sellValue: "Sell Value",
  quantity: "Quantity",
  entryDate: "Entry Date",
  exitDate: "Exit Date",
};

const SECTION_LABEL = {
  "equity - intraday": "Equity — intraday",
  "equity - short term": "Equity — short term",
  "equity - long term": "Equity — long term",
  "equity - buyback": "Equity — buyback",
  "debt etf": "Debt ETF",
  "mutual funds": "Mutual funds",
  "f&o": "F&O",
  currency: "Currency",
  commodity: "Commodity",
};

/** A file can bring new trades, finish ones already here, or both. */
function importLabel(newCount, completeCount) {
  const trades = `${newCount} trade${newCount === 1 ? "" : "s"}`;
  const done = `${completeCount} position${completeCount === 1 ? "" : "s"}`;
  if (newCount && completeCount) return `Import ${trades}, complete ${done}`;
  if (newCount) return `Import ${trades}`;
  if (completeCount) return `Complete ${done}`;
  return "Nothing to import";
}

/** What actually happened, which is not always "n trades imported". */
function doneHeadline({ inserted = 0, completed = 0 }) {
  const trades = `${inserted} trade${inserted === 1 ? "" : "s"}`;
  const done = `${completed} position${completed === 1 ? "" : "s"}`;
  if (inserted && completed) return `${trades} imported, ${done} completed`;
  if (completed) return `${done} completed`;
  return `${trades} imported`;
}

/** One held-back list. The heading says why; each row says which. */
function HeldBack({ rows, children }) {
  return (
    <details className="im-rejected">
      <summary><AlertTriangle size={11} /> {children}</summary>
      <div className="im-rejlist">
        {rows.slice(0, 40).map((g, i) => (
          <div key={i}>
            <b>{g.symbol}</b> {g.entryDate} → {g.exitDate}
            <span className="im-dim">
              {" "}qty {g.quantity} · buy {g.buyValue} · sell {g.sellValue} — {g.reason}
            </span>
          </div>
        ))}
        {rows.length > 40 && (
          <div className="im-dim">…and {rows.length - 40} more</div>
        )}
      </div>
    </details>
  );
}

export default function ImportTrades({ targets = [], onImport, onDone }) {
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState(null);
  const [rawRows, setRawRows] = useState(null);
  // A tax report has no stops, so without one every R figure stays blank and a
  // freshly imported journal looks broken. Assuming a single percentage is the
  // difference between a page of dashes and something you can read — as long
  // as it stays labelled an assumption, which stop_source does.
  const [assume, setAssume] = useState(true);
  const [assumePct, setAssumePct] = useState("7");
  const inputRef = useRef(null);

  const stopPct = assume ? Number(assumePct) : 0;
  const stopPctOk = !assume || (stopPct > 0 && stopPct < 100);

  const read = useCallback(async (f) => {
    setError(""); setParsed(null); setResult(null); setBusy(true);
    try {
      let rows;

      if (/\.(xlsx|xls)$/i.test(f.name)) {
        // Loaded on demand — no reason to ship a spreadsheet parser to
        // everyone who never imports anything
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
        const sheet = findTradewiseSheet(wb);
        if (!sheet) {
          throw new Error(
            "No 'Tradewise Exits' sheet in this file. Download the Tax P&L report " +
            "from Console → Reports → Tax P&L, not the tradebook."
          );
        }
        rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: null });
      } else if (/\.csv$/i.test(f.name)) {
        const { parseCsv } = await import("@/lib/import");
        rows = parseCsv(await f.text());
      } else {
        throw new Error("Expected an .xlsx or .csv file.");
      }

      const out = parseZerodhaTaxPnl(rows, { targets, assumeStopPct: stopPct });
      if (!out.trades.length && !out.completions.length && !out.duplicates.length) {
        throw new Error(
          "No equity trades found. This report may cover a period with no closed positions."
        );
      }
      setFile(f);
      setRawRows(rows);
      setParsed(out);
    } catch (e) {
      setError(e.message || "Could not read that file.");
      setFile(null);
      setRawRows(null);
    }
    setBusy(false);
  }, [targets, stopPct]);

  /**
   * Re-parse when the assumption changes, rather than patching the stop in at
   * the last moment. The preview table has a Stop column and a summary built
   * off these rows; applying the percentage anywhere later would leave the
   * screen describing an import different from the one about to happen.
   */
  useEffect(() => {
    if (!rawRows) return;
    setParsed(parseZerodhaTaxPnl(rawRows, { targets, assumeStopPct: stopPct }));
  }, [rawRows, targets, stopPct]);

  const confirm = async () => {
    if (!parsed?.trades.length && !parsed?.completions.length) return;
    setBusy(true); setError("");
    try {
      const res = await onImport({
        trades: parsed.trades,
        completions: parsed.completions,
        meta: {
          filename: file?.name,
          source: "zerodha-taxpnl",
          trades_count: parsed.trades.length,
          lots_count: parsed.summary.lots,
          date_from: parsed.summary.from,
          date_to: parsed.summary.to,
        },
      });
      setResult(res || { inserted: parsed.trades.length, completed: parsed.completions.length });
    } catch (e) {
      setError(e.message || "Import failed. Nothing was saved.");
    }
    setBusy(false);
  };

  /* ------------------------------- done ---------------------------- */

  if (result) {
    return (
      <section className="im-card im-done">
        <div className="im-tick"><Check size={20} /></div>
        <h2 className="disp im-h">{doneHeadline(result)}</h2>
        <p className="im-lede">
          {result.inserted > 0 && assume ? (
            <>Each one got a stop {stopPct}% below its entry, marked as assumed — so R,
              expectancy and the plots all read. Replace them with what you actually
              used whenever you work it out; the trade sheet shows which are which.</>
          ) : result.inserted > 0 ? (
            <>Every new one is missing a stop loss, so R, expectancy and the review
              page stay blank for them until you add one. It&apos;s a single column
              to fill and you can do it in batches.</>
          ) : (
            <>Nothing new was created — the sells went onto positions you already had,
              which keeps their stops and notes intact.</>
          )}
        </p>
        <div className="im-actions">
          <button className="btn" onClick={() => onDone?.("fill-stops")}>
            {assume && result.inserted > 0 ? "Review the stops" : "Add stops now"}
          </button>
          <button className="btn ghost" onClick={() => onDone?.("later")}>
            Later
          </button>
        </div>
        <style jsx>{`
          .im-done { text-align: center; padding: 34px 24px; }
          .im-tick {
            width: 42px; height: 42px; border-radius: 50%; margin: 0 auto 14px;
            display: flex; align-items: center; justify-content: center;
            background: var(--long); color: var(--paper);
          }
          .im-h { font-size: 20px; margin: 0 0 9px; }
          .im-lede {
            font-size: 13px; color: var(--ink2); line-height: 1.62;
            max-width: 420px; margin: 0 auto 20px; text-wrap: pretty;
          }
          .im-actions { display: flex; gap: 10px; justify-content: center; }
        `}</style>
      </section>
    );
  }

  /* ------------------------------ picker --------------------------- */

  if (!parsed) {
    return (
      <section>
        <div className="eyebrow" style={{ marginBottom: 9 }}>Import from Zerodha</div>
        <div
          className="im-drop"
          data-drag={drag ? 1 : 0}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault(); setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) read(f);
          }}
          onClick={() => inputRef.current?.click()}
        >
          <FileSpreadsheet size={22} />
          <div className="im-drop-main">
            {busy ? "Reading…" : "Drop your Tax P&L file here, or click to choose"}
          </div>
          <div className="im-drop-sub">
            Console → Reports → Tax P&amp;L → download. One file per financial year.
            Re-importing an overlapping year is safe; anything already in your
            journal is skipped.
          </div>
        </div>
        <input
          ref={inputRef} type="file" accept=".xlsx,.xls,.csv"
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ""; }}
        />
        {error && <div className="warn im-err">{error}</div>}

        <style jsx>{`
          .im-drop {
            border: 1.5px dashed var(--rule); border-radius: 4px;
            background: var(--card); padding: 38px 24px; text-align: center;
            cursor: pointer; color: var(--ink3);
            display: flex; flex-direction: column; align-items: center; gap: 10px;
          }
          .im-drop:hover, .im-drop[data-drag="1"] {
            border-color: var(--brass); background: #FBF8F1; color: var(--ink2);
          }
          .im-drop-main { font-size: 14px; font-weight: 500; color: var(--ink); }
          .im-drop-sub {
            font-size: 11.5px; line-height: 1.6; max-width: 400px; text-wrap: pretty;
          }
          .im-err { margin-top: 12px; }
        `}</style>
      </section>
    );
  }

  /* ------------------------------ preview -------------------------- */

  const s = parsed.summary;

  return (
    <section>
      <div className="im-head">
        <div>
          <div className="eyebrow">Ready to import</div>
          <div className="im-file mono">{file?.name}</div>
        </div>
        <button className="btn ghost sm" onClick={() => { setParsed(null); setFile(null); }}>
          <X size={12} /> Choose another
        </button>
      </div>

      <div className="im-stats">
        <div><b>{s.trades}</b><span>trades</span></div>
        <div><b>{s.lots}</b><span>rows in file</span></div>
        <div><b>{s.symbols}</b><span>symbols</span></div>
        <div><b>{pct(s.winRate, 0)}</b><span>win rate</span></div>
        <div><b className={s.netPnl >= 0 ? "pos" : "neg"}>{rupee(s.netPnl)}</b><span>net P&amp;L</span></div>
        <div><b>{rupee(s.charges)}</b><span>charges</span></div>
      </div>

      <p className="im-note">
        The report lists one row per matched lot, so {s.lots} rows become {s.trades} positions —
        fills sharing an entry date are one position, and each distinct exit date under it
        becomes a tranche.
        {s.scaledOut > 0 && (
          <> {s.scaledOut} of them {s.scaledOut === 1 ? "was" : "were"} scaled out of
          across {s.tranches - (s.trades - s.scaledOut)} sells rather than closed in one go.</>
        )}
        {" "}Charges come from the file itself, not an estimate:{" "}
        {pct(s.chargesPctOfTurnover, 3)} of turnover. Covering {s.from} to {s.to}.
      </p>

      {/* A column the parser couldn't find zeroes the price on every row under
          it, so this is a parsing failure and not a data one — worth saying
          loudly, because the fix is a code change rather than a bad cell. */}
      {parsed.missingColumns?.length > 0 && (
        <div className="warn im-cols">
          Couldn&apos;t find {parsed.missingColumns.map((c) => COLUMN_LABEL[c] || c).join(", ")} in
          this file&apos;s header row. Anything relying on {parsed.missingColumns.length === 1 ? "it" : "them"} will
          be held back below. If the report looks normal when you open it, the column has
          probably been renamed — tell me what the header says and I&apos;ll match it.
        </div>
      )}

      {parsed.completions?.length > 0 && (
        <details className="im-completes" open>
          <summary>
            <Check size={11} /> {parsed.completions.length} position
            {parsed.completions.length === 1 ? "" : "s"} already in your journal will be
            completed, not duplicated — the sells below get added to the trade you already
            have, keeping its stop and notes
          </summary>
          <div className="im-rejlist">
            {parsed.completions.slice(0, 40).map((c, i) => (
              <div key={i}>
                <b>{c.group.symbol}</b> {c.group.entryDate}
                <span className="im-dim">
                  {" "}· holding {c.grow ? `${c.holding} → ${c.grow.quantity}` : c.holding}
                  , {c.already} already sold
                  {" "}· adding {c.tranches.length} sell{c.tranches.length === 1 ? "" : "s"} ({c.adding})
                  {c.skipped > 0 && ` · ${c.skipped} already recorded`}
                  {" "}· {c.already + c.adding >= c.holding ? "closes it" : "stays part-sold"}
                </span>
              </div>
            ))}
            {parsed.completions.length > 40 && (
              <div className="im-dim">…and {parsed.completions.length - 40} more</div>
            )}
          </div>
        </details>
      )}

      {(parsed.skippedSections.length > 0 || parsed.duplicates.length > 0 ||
        parsed.conflicts?.length > 0 || parsed.rejected?.length > 0 ||
        parsed.warnings?.length > 0) && (
        <div className="im-skips">
          {parsed.skippedSections.map((x) => (
            <div key={x.section}>
              <AlertTriangle size={11} /> Skipped {x.rows} {SECTION_LABEL[x.section] || x.section} rows
            </div>
          ))}
          {parsed.duplicates.length > 0 && (
            <div>
              <AlertTriangle size={11} /> {parsed.duplicates.length} already in your journal — not imported again
            </div>
          )}
          {/* Two lists, because the remedies are different. A conflict has
              perfectly good numbers and is waiting on a decision; a rejected
              row has a value the journal can't store. Under one heading the
              conflicts read as though their prices were missing, which they
              plainly weren't. */}
          {parsed.conflicts?.length > 0 && (
            <HeldBack rows={parsed.conflicts}>
              {parsed.conflicts.length} left for you to decide — importing these
              could attach the sells to the wrong trade
            </HeldBack>
          )}
          {parsed.rejected?.length > 0 && (
            <HeldBack rows={parsed.rejected}>
              {parsed.rejected.length} held back —
              the journal needs a positive entry price and quantity
            </HeldBack>
          )}
          {/* These were dropped before grouping, so they never reach a bucket
              above. They were being counted and then thrown away unread,
              which meant a file could lose rows without saying so. */}
          {parsed.warnings?.length > 0 && (
            <details className="im-rejected">
              <summary>
                <AlertTriangle size={11} /> {parsed.warnings.length}{" "}
                {parsed.warnings.length === 1 ? "row" : "rows"} unreadable in the
                file itself — skipped before anything was matched
              </summary>
              <div className="im-rejlist">
                {parsed.warnings.slice(0, 40).map((w, i) => (
                  <div key={i} className="im-dim">{w}</div>
                ))}
                {parsed.warnings.length > 40 && (
                  <div className="im-dim">…and {parsed.warnings.length - 40} more</div>
                )}
              </div>
            </details>
          )}
        </div>
      )}

      <div className="card scroll im-table">
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
              <th className="num">Stop</th>
              <th className="num">Sells</th>
            </tr>
          </thead>
          <tbody>
            {parsed.trades.map((t, i) => (
              <tr key={i}>
                <td>
                  <b className="disp">{t.symbol}</b>
                  {t._preview.intraday && <span className="im-tag">intraday</span>}
                </td>
                <td className="num mono im-dim">{t.entry_date}</td>
                <td className="num mono im-dim">{t.exit_date}</td>
                <td className="num">{t.quantity}</td>
                <td className="num">{t.entry_price.toFixed(2)}</td>
                <td className="num">{t.exit_price.toFixed(2)}</td>
                <td className={`num ${t._preview.netProfit >= 0 ? "pos" : "neg"}`}>
                  {rupee(t._preview.netProfit)}
                </td>
                {/* Hardcoded to a dash back when a tax report could only ever
                    produce a stopless trade. Left that way it now contradicts
                    the line underneath saying stops are being set. */}
                <td className={`num ${t.stop_loss == null ? "im-dim" : ""}`}>
                  {t.stop_loss == null ? "—" : t.stop_loss.toFixed(2)}
                  {t.stop_source === "assumed" && <i className="im-assumed">assumed</i>}
                </td>
                <td className="num" title={
                  t._preview.tranches > 1
                    ? t.exits.map((e) => `${e.exit_date}  ${e.quantity} @ ${e.price}`).join("\n")
                    : undefined
                }>
                  {t._preview.tranches > 1
                    ? <b className="im-scaled">{t._preview.tranches}</b>
                    : <span className="im-dim">1</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <div className="warn im-err">{error}</div>}

      {/* The one decision on this screen. A tax report has no stops in it, so
          without an assumption every R figure lands blank and the journal looks
          broken; with one, the whole thing reads — as a what-if, which is what
          the note underneath is for. */}
      <div className="im-assume">
        <label className="im-assume-on">
          <input type="checkbox" checked={assume}
                 onChange={(e) => setAssume(e.target.checked)} />
          <span>Assume a stop</span>
        </label>
        <div className="im-assume-pct">
          <input className="in" inputMode="decimal" value={assumePct}
                 disabled={!assume} aria-label="Assumed stop percent"
                 onChange={(e) => setAssumePct(e.target.value)} />
          <span>% below entry</span>
        </div>
        <div className="im-assume-note">
          {assume && !stopPctOk
            ? "That needs to be a percentage between 0 and 100."
            : assume
            ? "The report doesn't record stops. This fills them in so R, expectancy and " +
              "the plots work — it says what your record would look like at a steady " +
              `${stopPct}% risk, not what you actually risked. Marked as assumed, and ` +
              "you can replace any of them later."
            : "Stops stay empty, so R and everything built on it stays blank until you " +
              "fill them in yourself."}
        </div>
      </div>

      <div className="im-confirm">
        <span className="im-dim">
          {assume
            ? `Stops set ${stopPct}% below entry, flagged as assumed.`
            : "Stops are left empty — you'll be asked next."}
          {/* Said before the import, not discovered afterwards. A stopless,
              R-less trade with an entry price of zero looks like a bug unless
              you were told it is a bonus issue. */}
          {parsed.freeShares > 0 && (
            <> {parsed.freeShares} {parsed.freeShares === 1 ? "row is" : "rows are"}{" "}
            zero-cost — bonus, split or allotment. They keep their rupee P&L and
            get no stop, because free shares carry no risk to measure an R against.</>
          )}
        </span>
        <button className="btn" onClick={confirm}
                disabled={busy || !stopPctOk || (!parsed.trades.length && !parsed.completions?.length)}>
          <Upload size={13} />{" "}
          {busy ? "Importing…" : importLabel(s.trades, parsed.completions?.length || 0)}
        </button>
      </div>

      <style jsx global>{`
        .im-dim { color: var(--ink3); font-size: 11.5px; }
        .im-rejected summary {
          display: flex; align-items: center; gap: 6px;
          cursor: pointer; font-size: 11.5px; color: var(--ink3);
        }
        .im-rejlist {
          margin: 7px 0 0 17px; max-height: 190px; overflow-y: auto;
          font-size: 11.5px; line-height: 1.75;
        }
      `}</style>

      <style jsx>{`
        .im-completes {
          border: 1px solid var(--long); border-radius: 3px;
          background: #F2F7F5; padding: 9px 12px; margin-bottom: 12px;
          font-size: 11.5px; color: var(--ink2); line-height: 1.6;
        }
        .im-completes summary { cursor: pointer; color: #0B6B58; }
        .im-head {
          display: flex; align-items: flex-end; justify-content: space-between;
          gap: 12px; margin-bottom: 12px; flex-wrap: wrap;
        }
        .im-file { font-size: 12px; color: var(--ink2); margin-top: 3px; }
        .im-stats {
          display: grid; grid-template-columns: repeat(6, 1fr);
          border: 1px solid var(--rule); border-radius: 3px;
          background: var(--card); overflow: hidden; margin-bottom: 11px;
        }
        .im-stats > div {
          padding: 12px 14px; border-right: 1px solid var(--rule); min-width: 0;
        }
        .im-stats > div:last-child { border-right: 0; }
        .im-stats b {
          display: block; font-family: 'Spline Sans Mono', monospace;
          font-size: 17px; font-weight: 500; font-variant-numeric: tabular-nums;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .im-stats span {
          display: block; font-size: 9px; font-weight: 600; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--ink3); margin-top: 4px;
        }
        @media (max-width: 820px) { .im-stats { grid-template-columns: repeat(3, 1fr); } }
        .im-note {
          font-size: 12px; color: var(--ink2); line-height: 1.65;
          margin: 0 0 11px; max-width: 640px; text-wrap: pretty;
        }
        .im-skips {
          display: flex; flex-direction: column; gap: 4px; margin-bottom: 11px;
        }
        .im-skips > div {
          display: flex; align-items: center; gap: 6px;
          font-size: 11.5px; color: var(--ink3);
        }
        .im-table { max-height: 380px; overflow-y: auto; }
        .im-cols { margin-bottom: 11px; }
        /* Worth spotting at a glance: these are the positions the old flat
           grouping would have split into several trades. */
        .im-scaled { color: var(--brass); font-weight: 600; cursor: help; }
        .im-tag {
          font-size: 8.5px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--brass);
          border: 1px solid var(--brass); border-radius: 2px;
          padding: 1px 4px; margin-left: 6px;
        }
        .im-assumed {
          display: block; font-style: normal; font-size: 9px;
          letter-spacing: 0.06em; text-transform: uppercase; color: var(--brass);
        }
        .im-assume {
          display: grid; grid-template-columns: auto auto 1fr; gap: 10px 16px;
          align-items: center; margin-top: 14px; padding: 12px 14px;
          border: 1px solid var(--rule); border-radius: 3px; background: var(--card);
        }
        .im-assume-on { display: flex; align-items: center; gap: 8px; font-size: 13px; }
        .im-assume-pct { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--ink2); }
        .im-assume-pct .in { width: 62px; padding: 5px 8px; font-size: 13px; }
        .im-assume-note {
          font-size: 11px; color: var(--ink3); line-height: 1.55; text-wrap: pretty;
        }
        @media (max-width: 640px) {
          .im-assume { grid-template-columns: 1fr; }
        }
        .im-confirm {
          display: flex; align-items: center; justify-content: space-between;
          gap: 14px; margin-top: 13px; flex-wrap: wrap;
        }
        .im-err { margin-top: 11px; }
      `}</style>
    </section>
  );
}
