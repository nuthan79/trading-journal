"use client";

import { useState, useRef, useCallback } from "react";
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

export default function ImportTrades({ existingKeys = [], onImport, onDone }) {
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

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

      const out = parseZerodhaTaxPnl(rows, { existingKeys });
      if (!out.trades.length && !out.duplicates.length) {
        throw new Error(
          "No equity trades found. This report may cover a period with no closed positions."
        );
      }
      setFile(f);
      setParsed(out);
    } catch (e) {
      setError(e.message || "Could not read that file.");
      setFile(null);
    }
    setBusy(false);
  }, [existingKeys]);

  const confirm = async () => {
    if (!parsed?.trades.length) return;
    setBusy(true); setError("");
    try {
      const res = await onImport({
        trades: parsed.trades,
        meta: {
          filename: file?.name,
          source: "zerodha-taxpnl",
          trades_count: parsed.trades.length,
          lots_count: parsed.summary.lots,
          date_from: parsed.summary.from,
          date_to: parsed.summary.to,
        },
      });
      setResult(res || { inserted: parsed.trades.length });
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
        <h2 className="disp im-h">{result.inserted} trades imported</h2>
        <p className="im-lede">
          Every one is missing a stop loss, so R, expectancy and the review page
          stay blank for them until you add one. It's a single column to fill and
          you can do it in batches.
        </p>
        <div className="im-actions">
          <button className="btn" onClick={() => onDone?.("fill-stops")}>
            Add stops now
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

      {(parsed.skippedSections.length > 0 || parsed.duplicates.length > 0 ||
        parsed.rejected?.length > 0) && (
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
          {parsed.rejected?.length > 0 && (
            <details className="im-rejected">
              <summary>
                <AlertTriangle size={11} /> {parsed.rejected.length} held back —
                the journal needs a positive entry price and quantity
              </summary>
              <div className="im-rejlist">
                {parsed.rejected.slice(0, 40).map((g, i) => (
                  <div key={i}>
                    <b>{g.symbol}</b> {g.entryDate} → {g.exitDate}
                    <span className="im-dim">
                      {" "}qty {g.quantity} · buy {g.buyValue} · sell {g.sellValue} — {g.reason}
                    </span>
                  </div>
                ))}
                {parsed.rejected.length > 40 && (
                  <div className="im-dim">…and {parsed.rejected.length - 40} more</div>
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
                <td className="num im-dim">—</td>
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

      <div className="im-confirm">
        <span className="im-dim">
          Stops are left empty — the report doesn't record them. You'll be asked next.
        </span>
        <button className="btn" onClick={confirm} disabled={busy}>
          <Upload size={13} /> {busy ? "Importing…" : `Import ${s.trades} trades`}
        </button>
      </div>

      <style jsx>{`
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
        .im-dim { color: var(--ink3); font-size: 11.5px; }
        .im-cols { margin-bottom: 11px; }
        .im-rejected summary {
          display: flex; align-items: center; gap: 6px;
          cursor: pointer; font-size: 11.5px; color: var(--ink3);
        }
        .im-rejlist {
          margin: 7px 0 0 17px; max-height: 190px; overflow-y: auto;
          font-size: 11.5px; line-height: 1.75;
        }
        /* Worth spotting at a glance: these are the positions the old flat
           grouping would have split into several trades. */
        .im-scaled { color: var(--brass); font-weight: 600; cursor: help; }
        .im-tag {
          font-size: 8.5px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--brass);
          border: 1px solid var(--brass); border-radius: 2px;
          padding: 1px 4px; margin-left: 6px;
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
