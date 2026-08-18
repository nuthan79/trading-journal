"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Upload, Check, AlertTriangle, X, FileSpreadsheet } from "lucide-react";
import { detectBroker, brokerNames, assembleImport, kindOf } from "@/lib/brokers";
import { resolveSymbols } from "@/lib/isin";
import * as zerodha from "@/lib/brokers/zerodha";
import * as zerodhaHoldings from "@/lib/brokers/zerodha-holdings";
import { toHoldingRows, dateCaveat } from "@/lib/holdings";
import { matchFifo, openPositions, datesForHeldPositions } from "@/lib/tradebook";
import { buildReport } from "@/lib/importReport";
import { rupee, pct } from "@/lib/format";

/**
 * Import from a broker's tax P&L export — Zerodha, Groww or Dhan, decided
 * by reading the file rather than by asking.
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
function importLabel(newCount, completeCount, hasReport = false) {
  const trades = `${newCount} trade${newCount === 1 ? "" : "s"}`;
  const done = `${completeCount} position${completeCount === 1 ? "" : "s"}`;
  if (newCount && completeCount) return `Import ${trades}, complete ${done}`;
  if (newCount) return `Import ${trades}`;
  if (completeCount) return `Complete ${done}`;
  // Nothing new, but something to explain — which is the case somebody comes
  // back asking about. Saving records why, rather than leaving a dead button
  // over the only account of it.
  if (hasReport) return "Keep this record";
  return "Nothing to import";
}

/** What actually happened, which is not always "n trades imported". */
function doneHeadline({ inserted = 0, completed = 0, dated = null }) {
  // A tradebook imports nothing, so "0 trades imported" would be both true
  // and the wrong summary of what just happened. Zero is its own case: the
  // run succeeded and its result was an explanation, not a change.
  if (dated === 0) return "Saved to your import history";
  if (dated != null) return `${dated} purchase date${dated === 1 ? "" : "s"} filled in`;
  const trades = `${inserted} trade${inserted === 1 ? "" : "s"}`;
  const done = `${completed} position${completed === 1 ? "" : "s"}`;
  if (inserted && completed) return `${trades} imported, ${done} completed`;
  if (completed) return `${done} completed`;
  // Reachable since a file with nothing new can now be saved for its record.
  // "0 trades imported" is true and reads as a failure rather than the point.
  if (!inserted) return "Saved to your import history";
  return `${trades} imported`;
}

/**
 * The holdings preview, rebuilt from the parsed file.
 *
 * Its own function because it runs twice: once when the file is read, and
 * again whenever the assumed-stop percentage changes — the same reason the
 * tax P&L path re-runs `assembleImport`. Deriving it in two places instead
 * would let the preview describe an import different from the one about to
 * happen, which is the whole thing the preview exists to prevent.
 *
 * `raw.holdings` are already symbol-resolved and `raw.warnings` already carry
 * the unresolved ones, so this is pure assembly.
 */
function holdingsPreview(raw, { brokerId, targets, stopPct }) {
  const out = toHoldingRows(raw.holdings, {
    asOf: raw.asOf,
    broker: brokerId,
    targets,
    assumeStopPct: stopPct,
  });
  return {
    kind: "holdings",
    asOf: raw.asOf,
    entryDate: out.entryDate,
    trades: out.rows,
    duplicates: out.duplicates,
    conflicts: out.conflicts,
    // Nothing here can complete an existing trade: a holdings file contains
    // no sells. The key is present so the render can stay one component
    // rather than two that drift apart.
    completions: [],
    summary: {
      positions: out.rows.length,
      symbols: new Set(out.rows.map((r) => r.symbol)).size,
      invested: out.rows.reduce((a, r) => a + r._preview.buyValue, 0),
      // Positions the file itself proves are over a year old. Worth its own
      // figure because it is the count for which the assumed date is not
      // merely unknown but demonstrably wrong.
      longTerm: out.rows.filter((r) => r._preview.longTermQty > 0).length,
    },
    // Present and empty so the shared chrome below can stay one render. A
    // holdings file has no sections to skip and no lot columns to miss.
    skippedSections: [],
    missingColumns: [],
    warnings: raw.warnings || [],
  };
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

export default function ImportTrades({
  targets = [], chargeConfig = null, onImport, onSetDates, onDone,
}) {
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState(null);
  /**
   * The adapter's output with symbols already resolved — not the raw rows.
   *
   * It used to hold raw rows and re-run the parser whenever the assumed stop
   * changed, which quietly undid the ISIN resolution: the first parse resolved
   * symbols and the re-parse did not, so the preview showed ROUTE and the
   * import wrote "Route Mobile". Resolution needs a fetch, so it cannot happen
   * inside a synchronous effect anyway.
   *
   * Parsing once and re-assembling is also simply less work: the stop
   * percentage changes what toTradeRows produces, never how the file reads.
   */
  const [parsedFile, setParsedFile] = useState(null);
  // Remembered so re-parsing at a different assumed stop uses the same
  // adapter that read the file, rather than defaulting back to one of them.
  const [broker, setBroker] = useState(null);
  // A tax report has no stops, so without one every R figure stays blank and a
  // freshly imported journal looks broken. Assuming a single percentage is the
  // difference between a page of dashes and something you can read — as long
  // as it stays labelled an assumption, which stop_source does.
  const [assume, setAssume] = useState(true);
  const [assumePct, setAssumePct] = useState("7");

  /**
   * Purchase dates typed into the preview, keyed by symbol.
   *
   * Asked for HERE rather than only in a queue afterwards, because this is the
   * moment somebody has their broker open in the next tab — which is the
   * cheapest possible time to answer, and the only time they are already
   * thinking about these particular positions. Whatever is left blank still
   * imports, flagged, and can be fixed later; nothing here is a gate.
   */
  const [dateEdits, setDateEdits] = useState({});
  const inputRef = useRef(null);

  const stopPct = assume ? Number(assumePct) : 0;
  const stopPctOk = !assume || (stopPct > 0 && stopPct < 100);

  const read = useCallback(async (f) => {
    setError(""); setParsed(null); setResult(null); setBusy(true);
    // Dates typed for the last file say nothing about this one, and a symbol
    // held in both would silently inherit the old answer.
    setDateEdits({});
    try {
      let rows;
      // A CSV has no sheets to inspect, so there is nothing to detect from:
      // that path is Zerodha's, which is the only one offering the report in
      // that format.
      let broker = zerodha;

      if (/\.(xlsx|xls)$/i.test(f.name)) {
        // Loaded on demand — no reason to ship a spreadsheet parser to
        // everyone who never imports anything
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
        // Worked out from the file rather than asked for. Naming the brokers
        // we do read is the useful half of failing here — it tells someone
        // with an unsupported export what is actually wrong.
        broker = detectBroker(wb);
        if (!broker) {
          throw new Error(
            `This doesn't look like a report we can read yet. ` +
            `Supported: ${brokerNames().join(", ")}. If it's from another broker, ` +
            `send us the file and we'll add it.`
          );
        }
        const sheet = broker.findSheet(wb);
        if (!sheet) {
          throw new Error(
            `This looks like a ${broker.label} file, but not the report we need — ` +
            `download the tax P&L or capital gains statement rather than the tradebook ` +
            `or a ledger.`
          );
        }
        rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: null });
      } else if (/\.csv$/i.test(f.name)) {
        const { parseCsv } = await import("@/lib/import");
        rows = parseCsv(await f.text());
        /**
         * "It is a CSV" used to be proof of a Zerodha tax P&L, because that was
         * the only report anybody offered in the format. Kite's holdings export
         * is a CSV as well, so the extension identifies nothing now and the
         * header row has to say which it is.
         */
        if (zerodhaHoldings.detectRows(rows)) broker = zerodhaHoldings;
      } else {
        throw new Error("Expected an .xlsx or .csv file.");
      }

      /**
       * Symbols come from the ISIN, not from the file's own naming.
       *
       * Only Zerodha states a trading symbol; every other report gives a
       * company name, and "Route Mobile" is ROUTE. Left alone, those trades
       * never price, never dedupe against the same trade from another broker,
       * and group under a label nothing else in the journal shares.
       */
      /**
       * The user's own broker rates, for the adapters that have to compute.
       *
       * Groww states no per-trade charge, only a period total, so its adapter
       * works each one out — and without this it worked them out at the
       * defaults and then correctly warned that the result was understated.
       * The warning was right; the settings simply never arrived.
       */
      /**
       * A tradebook creates nothing. It answers one question — when did I
       * actually buy the things I already hold — and writes only that.
       *
       * See the note on datesForHeldPositions: importing its matched lots
       * would duplicate the tax P&L's closed trades while being worse than
       * them, and its open positions are a subset of what a holdings file
       * already gave completely.
       */
      if (kindOf(broker) === "tradebook") {
        const raw = broker.parseRows(rows);
        if (!raw.trades.length) {
          throw new Error(
            raw.warnings[0] ||
            "No equity trades found in this tradebook. Check it covers the segment you trade."
          );
        }

        const { open, warnings: fifoWarnings } = matchFifo(raw.trades);
        const positions = openPositions(open);
        const out = datesForHeldPositions(positions, targets);

        const changing = out.dated.filter((d) => !d.unchanged);
        if (!changing.length && !out.short.length && !out.absent.length) {
          throw new Error(
            "Nothing here needs a date. Every position you hold already has a " +
            "purchase date you recorded — import a holdings file first if your " +
            "open positions are missing."
          );
        }

        setFile(f);
        setBroker(broker);
        setParsedFile(raw);
        setParsed({
          kind: "tradebook",
          dated: out.dated,
          changing,
          short: out.short,
          absent: out.absent,
          // Present and empty so the shared chrome renders. Nothing about a
          // tradebook creates, completes or duplicates a trade.
          trades: [], completions: [], duplicates: [], conflicts: [],
          skippedSections: [], missingColumns: [],
          summary: {
            positions: positions.length,
            rowsRead: raw.trades.length,
            from: raw.trades.reduce((a, t) => (!a || t.date < a ? t.date : a), null),
            to: raw.trades.reduce((a, t) => (!a || t.date > a ? t.date : a), null),
          },
          warnings: [...(raw.warnings || []), ...fifoWarnings],
        });
        return;
      }

      /**
       * A holdings file is a different KIND of file, not a different broker.
       *
       * It yields open positions rather than matched lots, so it cannot go
       * through `assembleImport` — there is nothing to match, nothing to
       * complete, and no exit to reconcile. It gets its own short path and
       * rejoins at the same preview.
       */
      if (kindOf(broker) === "holdings") {
        const raw = broker.parseRows(rows);
        if (!raw.holdings.length) {
          throw new Error(
            raw.warnings[0] ||
            "No holdings found in this file. If it came from Kite's Holdings tab, " +
            "check it downloaded fully."
          );
        }

        // Same resolution the lot path uses — it only wants { isin, symbol },
        // which a holding has. The Console file carries ISINs; the Kite CSV
        // does not, and there the file's own trading symbol stands.
        const { lots: resolved, unresolved } = await resolveSymbols(raw.holdings);

        // Warnings folded in here, so the rebuild on a percentage change does
        // not have to resolve symbols again to reproduce them.
        const withResolved = {
          ...raw,
          holdings: resolved,
          warnings: [
            ...(raw.warnings || []),
            ...unresolved.slice(0, 5).map(
              (u) => `Could not identify ${u.name || u.isin} (${u.isin}) — imported under the name in the file.`
            ),
            ...(unresolved.length > 5
              ? [`…and ${unresolved.length - 5} more that could not be identified.`]
              : []),
          ],
        };

        setFile(f);
        setBroker(broker);
        setParsedFile(withResolved);
        setParsed(holdingsPreview(withResolved, {
          brokerId: broker.id, targets, stopPct,
        }));
        return;
      }

      const raw = broker.parseRows(rows, { chargeConfig });
      const { lots, unresolved } = await resolveSymbols(raw.lots);
      const resolved = {
          ...raw,
          lots,
          // Named rather than counted. A security that stayed a company name
          // is not noticed until a position refuses to price weeks later.
          warnings: [
            ...(raw.warnings || []),
            ...unresolved.slice(0, 5).map(
              (u) => `Could not identify ${u.name || u.isin} (${u.isin}) — imported under the name in the file.`
            ),
            ...(unresolved.length > 5
              ? [`…and ${unresolved.length - 5} more that could not be identified.`]
              : []),
          ],
      };
      const out = assembleImport(resolved,
        { targets, assumeStopPct: stopPct, broker: broker.id });
      if (!out.trades.length && !out.completions.length && !out.duplicates.length) {
        throw new Error(
          "No equity trades found. This report may cover a period with no closed positions."
        );
      }
      setFile(f);
      setBroker(broker);
      setParsedFile(resolved);
      setParsed(out);
    } catch (e) {
      setError(e.message || "Could not read that file.");
      setFile(null);
      setParsedFile(null);
    } finally {
      // In a finally, not after the block: the holdings path returns early
      // from inside the try, and a plain trailing call would be skipped —
      // leaving the screen spinning on a file it had already read.
      setBusy(false);
    }
  }, [targets, stopPct, chargeConfig]);

  /**
   * Re-parse when the assumption changes, rather than patching the stop in at
   * the last moment. The preview table has a Stop column and a summary built
   * off these rows; applying the percentage anywhere later would leave the
   * screen describing an import different from the one about to happen.
   */
  useEffect(() => {
    if (!parsedFile) return;
    const b = broker || zerodha;
    /**
     * Holdings re-derive too, since they now take the same assumed stop —
     * but through their own builder, because they have no lots to re-group.
     */
    if (kindOf(b) === "holdings") {
      setParsed(holdingsPreview(parsedFile, { brokerId: b.id, targets, stopPct }));
      return;
    }

    /**
     * Everything else that is not the tax P&L shape stays out.
     *
     * Tested as "not taxpnl" rather than by naming the kinds to skip, because
     * naming them is what broke: this said `=== "holdings"` and the tradebook
     * arrived later, went straight into assembleImport, and crashed the screen
     * on `lots is not iterable`. A third kind would have done it again. Only
     * lots can be re-grouped, so only lots are re-grouped.
     */
    if (kindOf(b) !== "taxpnl") return;
    setParsed(assembleImport(parsedFile,
      { targets, assumeStopPct: stopPct, broker: b.id }));
  }, [parsedFile, broker, targets, stopPct]);

  /**
   * Something was held back and is worth a record even if nothing arrived.
   *
   * Re-dropping a file you already imported is the ordinary way to reach this:
   * every row is a duplicate, nothing is created, and the screen used to offer
   * a dead "Nothing to import" button over the only explanation of why.
   */
  const explainable =
    (parsed?.duplicates?.length || 0) + (parsed?.conflicts?.length || 0) +
    (parsed?.rejected?.length || 0) > 0;

  const confirm = async () => {
    /**
     * The tradebook path saves dates and nothing else, so it cannot go through
     * the guard below — it has no trades to import by design, and the shared
     * check would read that as an empty file and refuse.
     */
    if (parsed?.kind === "tradebook") {
      /**
       * A run that changes nothing still has something to say, and this is
       * the case that matters most.
       *
       * "Why did none of them load?" is exactly the question the record
       * exists to answer, and a tradebook that dates nothing — because it
       * covers the wrong years — is the commonest way to ask it. Refusing to
       * save because there was no change would throw away the explanation
       * precisely when it is the only thing produced.
       */
      const nothingToSay = !parsed.changing.length &&
        !parsed.short.length && !parsed.absent.length;
      if (nothingToSay) return;
      setBusy(true); setError("");
      try {
        const n = await onSetDates(
          parsed.changing.map((d) => ({
            id: d.id,
            entry_date: d.to,
            // A date read out of the user's own tradebook is as recorded as
            // one they typed — it came from the broker's record of the trade.
            entry_date_source: "recorded",
          })),
          /**
           * Recorded as a batch even though it creates no trade, because the
           * things it could NOT do are exactly what somebody comes back
           * asking about — KAYNES not dated, three positions absent. A run
           * that explains itself only on screen explains itself to nobody.
           */
          {
            filename: file?.name,
            source: `${(broker || zerodha).id}-tradebook`,
            trades_count: 0,
            lots_count: parsed.summary.rowsRead,
            date_from: parsed.summary.from,
            date_to: parsed.summary.to,
            report: buildReport(parsed),
          }
        );
        setResult({ dated: n ?? parsed.changing.length });
      } catch (e) {
        setError(e.message || "Could not save. Nothing was changed.");
      }
      setBusy(false);
      return;
    }

    // Nothing new is still worth recording when something was held back —
    // see importLabel. Only a file with nothing to say at all is a no-op.
    if (!parsed?.trades.length && !parsed?.completions.length && !explainable) return;
    setBusy(true); setError("");
    try {
      const isHoldings = parsed.kind === "holdings";

      /**
       * Dates typed in the preview replace the assumed one, and — this is the
       * part that matters — clear the flag with it. A date somebody entered
       * from their broker is a recorded date, so holding period, XIRR and the
       * period breakdowns are entitled to count it. One left untouched keeps
       * the guess AND the flag, so nothing counts it at all.
       */
      const trades = isHoldings
        ? parsed.trades.map((t) => {
            const typed = dateEdits[t.symbol];
            return typed
              ? { ...t, entry_date: typed, entry_date_source: "recorded" }
              : t;
          })
        : parsed.trades;

      const res = await onImport({
        trades,
        completions: parsed.completions,
        meta: {
          filename: file?.name,
          // Was hardcoded when there was one adapter. The batch should say
          // which file it actually read, not which one it used to be.
          source: isHoldings
            ? `${(broker || zerodha).id}-holdings`
            : `${(broker || zerodha).id}-taxpnl`,
          trades_count: trades.length,
          lots_count: isHoldings ? trades.length : parsed.summary.lots,
          // A holdings statement covers one instant, not a span. Both ends are
          // that instant rather than null, so the import history has something
          // to show instead of an empty range.
          date_from: isHoldings ? (parsed.asOf || parsed.entryDate) : parsed.summary.from,
          date_to: isHoldings ? (parsed.asOf || parsed.entryDate) : parsed.summary.to,
          /**
           * Built from the same `parsed` the preview rendered, so what is kept
           * is exactly what the user was shown rather than a second derivation
           * that can drift from it.
           */
          report: buildReport(parsed),
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
          {/* Nothing created, by either path — a re-dropped file whose rows
              were all already here, or a tradebook that could prove no dates.
              Both saved for the same reason and are told the same thing. */}
          {result.dated === 0 || (result.dated == null && !result.inserted && !result.completed) ? (
            <>Nothing new came out of this file, so nothing was changed — but what it
              held back, and why, is now in your import history. Look a symbol up there
              whenever you wonder where it went, rather than having to remember this
              screen.</>
          ) : result.dated != null ? (
            <>Those positions now carry the date you actually bought them, read from
              your own tradebook — so holding period, XIRR and the period breakdowns
              count them instead of skipping them. Nothing else was changed: no trade
              was created, and no price or quantity was touched.</>
          ) : parsed?.kind === "holdings" ? (
            <>Your open positions are in. They have no stop yet, so R and expectancy
              stay blank for them until you set one — and any purchase date you
              didn&apos;t fill in is marked assumed, which keeps it out of holding
              period, XIRR and the period breakdowns rather than quietly skewing them.</>
          ) : result.inserted > 0 && assume ? (
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
        <div className="eyebrow" style={{ marginBottom: 9 }}>Import from your broker</div>
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
            {busy ? "Reading…" : "Drop a broker file here, or click to choose"}
          </div>
          <div className="im-drop-sub">
            {/* Both lists come from the registry, so a broker added next month
                appears here without anyone remembering to edit this line. */}
            <b>Closed trades:</b> the tax P&amp;L or capital gains report from{" "}
            {brokerNames().join(", ")}.
            {" "}<b>Open positions:</b> your holdings file — Console&apos;s Equity
            Holdings Statement, or the CSV from Kite&apos;s Holdings tab.
            {" "}The file says which it is, so there is nothing to choose.
            Re-importing is safe; anything already in your journal is skipped.
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
  const holdings = parsed.kind === "holdings";
  const tradebook = parsed.kind === "tradebook";

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

      {tradebook ? (
        <>
          <div className="im-stats">
            <div><b>{parsed.changing.length}</b><span>dates found</span></div>
            <div><b>{s.rowsRead}</b><span>rows read</span></div>
            {parsed.short.length > 0 &&
              <div><b>{parsed.short.length}</b><span>can&apos;t be dated</span></div>}
            {parsed.absent.length > 0 &&
              <div><b>{parsed.absent.length}</b><span>not in this file</span></div>}
          </div>

          <p className="im-note">
            {/* The thing to be clear about before confirming: this button does
                not import. Somebody who has just imported two files could
                reasonably expect a third to add more trades. */}
            <b>Nothing is imported from a tradebook.</b> It is read only to find
            when you actually bought the positions you already hold — no trade is
            created, and no price, quantity or charge is touched. Closed trades keep
            coming from your tax P&amp;L, which is the only file carrying real charges.
            {s.from && <> Covering {s.from} to {s.to}.</>}
          </p>
        </>
      ) : holdings ? (
        <>
          <div className="im-stats">
            <div><b>{s.positions}</b><span>open positions</span></div>
            <div><b>{s.symbols}</b><span>symbols</span></div>
            <div><b>{rupee(s.invested)}</b><span>invested</span></div>
            {s.longTerm > 0 && <div><b>{s.longTerm}</b><span>held over a year</span></div>}
          </div>

          {/* Two notes, because with nothing to add the first one is a
              sentence about positions that do not exist — it opened "They also
              arrive without a stop" with no antecedent, and claimed every
              purchase date was filled in when there were no dates at all. */}
          {s.positions > 0 ? (
            <p className="im-note">
              {/* The one thing somebody must understand before confirming. Said
                  here rather than only in the review queue afterwards, because
                  by then the rows exist and the surprise has already happened. */}
              {dateCaveat(s.positions, parsed.asOf)}
              {assume
                ? <> They also arrive with the assumed stop set below, so R reads from
                    the start — marked assumed, and replaceable at <b>Stops</b>.</>
                : <> They also arrive without a stop, so they have no R until you set one —
                    the same queue at <b>Stops</b> that a tax P&amp;L import fills.</>}
              {!parsed.asOf && (
                <>
                  {" "}For real purchase dates and ISINs, the <b>Console</b> holdings
                  statement is the better file — this one is Kite&apos;s, which carries neither.
                </>
              )}
            </p>
          ) : (
            <p className="im-note">
              Everything in this file is already in your journal, so there is nothing
              to add. Re-importing a holdings statement is always safe: positions are
              matched by symbol, so the same file can be dropped in as often as you
              like without doubling anything.
            </p>
          )}
        </>
      ) : (
      <>
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
        {/* Said per broker, because it is not the same claim for all of them.
            Zerodha and Dhan state a charge on every row and those are imported
            untouched; Groww totals them for the period, so each trade's share
            is computed from the statutory rates and your own brokerage plan.
            Telling somebody a computed number "comes from the file" is the
            kind of small lie that makes them trust the next figure less. */}
        {parsedFile?.chargesComputed ? (
          <>
            {" "}This report totals charges for the whole period rather than per trade,
            so each one is worked out from the statutory rates and your brokerage
            settings — {pct(s.chargesPctOfTurnover, 3)} of turnover.
          </>
        ) : (
          <>
            {" "}Charges come from the file itself, not an estimate:{" "}
            {pct(s.chargesPctOfTurnover, 3)} of turnover.
          </>
        )}
        {" "}Covering {s.from} to {s.to}.
      </p>
      </>
      )}

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
        parsed.short?.length > 0 || parsed.absent?.length > 0 ||
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
          {/* A holdings conflict is a different animal and cannot borrow the
              lot renderer above, which prints an entry-to-exit span and a sell
              value that an open position simply does not have. What it needs
              said is the two quantities, because the disagreement between them
              IS the finding. */}
          {/* THE HONEST HALF. A tradebook that only reaches back a year cannot
              see the buys that opened an older position, so its earliest
              surviving buy is not when that position started — it just looks
              like it is. Both numbers are shown so the shortfall speaks for
              itself, and the date is not applied. */}
          {tradebook && parsed.short.length > 0 && (
            <details className="im-rejected">
              <summary>
                <AlertTriangle size={11} /> {parsed.short.length}{" "}
                {parsed.short.length === 1 ? "position" : "positions"} this file
                can&apos;t date — it only accounts for part of what you hold
              </summary>
              <div className="im-rejlist">
                {parsed.short.slice(0, 40).map((x, i) => (
                  <div key={i}>
                    <b>{x.symbol}</b>
                    <span className="im-dim">
                      {" "}you hold {x.held}, this file accounts for {x.found}.
                      The rest was bought before it starts, so its earliest buy here
                      ({x.earliest}) is not when you opened the position. Left as it
                      was — download a tradebook covering more years, or set the date
                      by hand.
                    </span>
                  </div>
                ))}
                {parsed.short.length > 40 && (
                  <div className="im-dim">…and {parsed.short.length - 40} more</div>
                )}
              </div>
            </details>
          )}
          {tradebook && parsed.absent.length > 0 && (
            <div>
              <AlertTriangle size={11} /> {parsed.absent.length} held{" "}
              {parsed.absent.length === 1 ? "position is" : "positions are"} not in
              this file at all — bought before it starts, or on another account
            </div>
          )}
          {holdings && parsed.conflicts?.length > 0 && (
            <details className="im-rejected">
              <summary>
                <AlertTriangle size={11} /> {parsed.conflicts.length}{" "}
                {parsed.conflicts.length === 1 ? "holding" : "holdings"} you already have,
                at a different size — left for you to decide
              </summary>
              <div className="im-rejlist">
                {parsed.conflicts.slice(0, 40).map((c, i) => (
                  <div key={i}>
                    <b>{c.symbol}</b>
                    <span className="im-dim">
                      {" "}your journal has {c.journalQuantity} across{" "}
                      {c.journalTrades} {c.journalTrades === 1 ? "trade" : "trades"};
                      this file says {c.quantity}. Nothing was changed — adding the
                      difference would invent an entry price for it, and overwriting
                      would throw away a date you may have entered yourself.
                    </span>
                  </div>
                ))}
                {parsed.conflicts.length > 40 && (
                  <div className="im-dim">…and {parsed.conflicts.length - 40} more</div>
                )}
              </div>
            </details>
          )}
          {!holdings && parsed.conflicts?.length > 0 && (
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

      {/* The tradebook's own preview: what each date is now, and what the file
          says it should be. Both shown, because this is a correction to
          something already recorded rather than a blank being filled — and the
          old value is the only way to see at a glance how far off the guess
          was. */}
      {tradebook && parsed.changing.length > 0 && (
        <div className="card scroll im-table">
          <table className="t">
            <thead>
              <tr>
                <th>Symbol</th>
                <th className="num">Qty</th>
                <th>Recorded as</th>
                <th>Actually bought</th>
                <th className="num">Buys</th>
              </tr>
            </thead>
            <tbody>
              {parsed.changing.map((d) => (
                <tr key={d.id}>
                  <td><b className="disp">{d.symbol}</b></td>
                  <td className="num">{d.quantity}</td>
                  <td className="mono im-dim">{d.from}<i className="im-assumed">assumed</i></td>
                  <td className="mono"><b>{d.to}</b></td>
                  {/* How many separate purchases make up the holding. More
                      than one means the date shown is the earliest of them —
                      worth seeing, because it explains a date older than the
                      person may remember. */}
                  <td className="num im-dim" title={d.lots > 1
                    ? `Built over ${d.lots} purchases on different days — this is the earliest still held`
                    : undefined}>
                    {d.lots > 1 ? <b className="im-scaled">{d.lots}</b> : <span className="im-dim">1</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* A header row over nothing reads as a table that failed to load. When
          every position in the file is already held there is no list to show,
          and the note above has already said so. */}
      {parsed.trades.length > 0 && (
      <div className="card scroll im-table">
        <table className="t">
          <thead>
            {holdings ? (
              <tr>
                <th>Symbol</th>
                <th>Bought</th>
                <th className="num">Qty</th>
                <th className="num">Avg cost</th>
                <th className="num">Stop</th>
                <th className="num">Invested</th>
              </tr>
            ) : (
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
            )}
          </thead>
          <tbody>
            {holdings ? parsed.trades.map((t, i) => {
              const lt = t._preview.longTermQty > 0;
              const typed = dateEdits[t.symbol] || "";
              return (
                <tr key={i}>
                  <td>
                    <b className="disp">{t.symbol}</b>
                    {/* The file's own evidence, not an inference of ours. Shown
                        because it turns "I have no idea" into a date range the
                        user can actually narrow down from memory. */}
                    {lt && <span className="im-tag" title={
                      `Your broker reports ${t._preview.longTermQty} of these shares as long term, ` +
                      `so they were bought more than a year before ${parsed.asOf || "the statement"}.`
                    }>over a year</span>}
                  </td>
                  <td>
                    <input
                      type="date"
                      className="in im-date"
                      value={typed}
                      max={parsed.entryDate}
                      placeholder={t.entry_date}
                      onChange={(e) => setDateEdits((d) => ({ ...d, [t.symbol]: e.target.value }))}
                    />
                    {!typed && <i className="im-assumed">assumed</i>}
                  </td>
                  <td className="num">{t.quantity}</td>
                  <td className="num">{t.entry_price.toFixed(2)}</td>
                  {/* Shown so the assumption is visible before it is written,
                      the same as the tax P&L table beside it. */}
                  <td className={`num ${t.stop_loss == null ? "im-dim" : ""}`}>
                    {t.stop_loss == null ? "—" : t.stop_loss.toFixed(2)}
                    {t.stop_source === "assumed" && <i className="im-assumed">assumed</i>}
                  </td>
                  <td className="num">{rupee(t._preview.buyValue)}</td>
                </tr>
              );
            }) : parsed.trades.map((t, i) => (
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
      )}

      {error && <div className="warn im-err">{error}</div>}

      {/* The one decision on this screen. A tax report has no stops in it, so
          without an assumption every R figure lands blank and the journal looks
          broken; with one, the whole thing reads — as a what-if, which is what
          the note underneath is for.

          Offered for holdings too. A holdings file states no stop for exactly
          the same reason a tax P&L does not, and the consequence is the same:
          without one there is no 1R, and the position is invisible to
          expectancy and the R distribution. Not offered for a tradebook, which
          writes no trade for a stop to belong to. */}
      {!tradebook && (
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
      )}

      <div className="im-confirm">
        <span className="im-dim">
          {tradebook ? (
            parsed.changing.length
              ? `Only the dates change. Stops, prices, quantities and charges stay ` +
                `exactly as they are.`
              : `No dates this file can prove — saving keeps the reason in your ` +
                `import history, so you can check it later instead of re-reading this.`
          ) : holdings ? (
            (() => {
              // Nothing to import is not the same as every date being answered.
              if (!parsed.trades.length) return "Nothing new in this file.";
              const dated = parsed.trades.filter((t) => dateEdits[t.symbol]).length;
              const left = parsed.trades.length - dated;
              if (!left) return "Every purchase date filled in. Stops are next.";
              return `${dated > 0 ? `${dated} dated, ` : ""}${left} still assumed — ` +
                `importable now and fixable any time from the trade sheet.`;
            })()
          ) : assume
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
                disabled={busy || (tradebook
                  ? !parsed.changing.length && !parsed.short.length && !parsed.absent.length
                  : !stopPctOk || (!parsed.trades.length && !parsed.completions?.length && !explainable))}>
          <Upload size={13} />{" "}
          {busy
            ? (tradebook ? "Saving…" : "Importing…")
            : tradebook
            // Says what it does, which is not importing. "Import 0 trades" on
            // a file that fills in eight dates would describe nothing that is
            // about to happen — and with no dates to set, what it saves is the
            // explanation of why, which is worth keeping on its own.
            ? parsed.changing.length
              ? `Set ${parsed.changing.length} date${parsed.changing.length === 1 ? "" : "s"}`
              : "Keep this record"
            : importLabel(holdings ? parsed.trades.length : s.trades,
                          parsed.completions?.length || 0, explainable)}
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
        /* Columns rather than a width cap, the same as the holdings
           footnote. The cap gave a good measure — about 108 characters at
           this size — and left five hundred pixels of the panel empty to do
           it, which reads as something failing to load. Two columns keep the
           measure and use the width. */
        .im-note {
          font-size: 12px; color: var(--ink2); line-height: 1.65;
          margin: 0 0 11px; text-wrap: pretty;
          columns: 2; column-gap: 30px;
        }
        @media (max-width: 900px) {
          .im-note { columns: 1; }
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
        /* Narrow enough that the table still reads as a table rather than a
           form. It sits at the row's own height so filling one in does not
           shuffle every row below it. */
        .im-date {
          width: 145px; padding: 3px 6px; font-size: 12px;
          font-variant-numeric: tabular-nums;
        }
        /* A typed date has answered the question, so the brass "assumed" line
           disappears and the field goes quiet — the row stops asking. */
        .im-date:invalid { color: var(--ink3); }
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
