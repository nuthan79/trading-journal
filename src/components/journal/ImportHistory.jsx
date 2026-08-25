"use client";

import { useEffect, useState } from "react";
import { RotateCcw, FileText, Search, AlertTriangle } from "lucide-react";
import { listImportBatches, importBatchCounts, undoImport } from "@/lib/db";
import { outcomeFor, OUTCOME_LABEL } from "@/lib/importReport";

/**
 * Every import that has happened, and the way back out of one.
 *
 * `undoImport` and `listImportBatches` have existed in db.js since migration
 * 006 and nothing has ever called them. So the undo the importer was designed
 * around — the reason a batch is recorded at all — has only ever been
 * reachable by running SQL by hand. The restore screen even tells people to
 * undo "from the import history", which until now did not exist.
 *
 * WHAT UNDO ACTUALLY DOES, said plainly rather than implied. `undo_import`
 * deletes the trades carrying that batch id and the batch row itself. Exit
 * tranches follow on the foreign key. It does NOT touch diary entries or
 * capital flows — which matters only for a restore, since a broker import
 * never creates either.
 *
 * AND IT DOES NOT KNOW WHAT YOU CHANGED AFTERWARDS. A trade imported last
 * month, then given a stop, a pattern and three paragraphs of notes, is still
 * deleted by its batch. That is the honest behaviour — the batch is the unit
 * that was written — but it is not what "undo" suggests to somebody who has
 * been working in the journal since, so the confirmation says so.
 */
export default function ImportHistory({ onChanged }) {
  const [batches, setBatches] = useState(null);
  /**
   * Live counts, not the recorded ones.
   *
   * import_batches.trades_count is what the import claimed at the time and
   * goes stale the moment anything is deleted afterwards — see the note on
   * importBatchCounts. The undo button must offer to remove what is actually
   * there.
   */
  const [counts, setCounts] = useState(null);   // null = not loaded yet
  const [arming, setArming] = useState(null);   // batch id awaiting confirmation
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  /** The symbol somebody is looking for, if any. */
  const [query, setQuery] = useState("");

  /**
   * Every import that has something to say about the searched symbol.
   *
   * Newest first, and all of them rather than only the latest: a stock can be
   * skipped as a duplicate in one file precisely because an earlier one
   * imported it, and seeing both lines is the explanation.
   */
  const found = (batches || [])
    .map((batch) => {
      const hit = outcomeFor(batch.report, query);
      return hit ? { batch, ...hit } : null;
    })
    .filter(Boolean);

  const load = () => {
    Promise.all([listImportBatches(), importBatchCounts().catch(() => null)])
      .then(([bs, cs]) => { setBatches(bs); setCounts(cs); })
      .catch((e) => { setErr(e.message || "Could not read the import history."); setBatches([]); });
  };

  /**
   * The recorded figure is used only when the counts could not be read at all.
   *
   * The first version keyed off `counts[b.id] != null`, which looked right and
   * was exactly wrong: a batch with no trades left has no key in the tally, so
   * it fell through to the stale recorded number — 126 for restores whose rows
   * had all been re-stamped to a later batch. The very case the fallback was
   * written to avoid.
   *
   * So the distinction is made once, on whether the tally loaded at all. A
   * loaded tally with no entry for a batch means zero, because that is what it
   * means.
   */
  const liveCount = (b) => (counts === null ? b.trades_count : counts[b.id] || 0);
  useEffect(load, []);

  const go = async (b) => {
    setBusy(b.id); setErr(""); setDone("");
    try {
      const removed = await undoImport(b.id);
      setDone(
        `Removed ${removed} trade${removed === 1 ? "" : "s"} from ${label(b)}.` +
        (b.source === "ledgerr-export"
          ? " Diary entries and capital flows from that restore are still here."
          : "")
      );
      setArming(null);
      load();
      onChanged?.();
    } catch (e) {
      setErr(e.message || "That import could not be undone.");
    }
    setBusy(null);
  };

  if (batches === null) {
    return <div className="hint" style={{ marginTop: 34 }}>Reading import history…</div>;
  }

  return (
    <div style={{ marginTop: 34 }}>
      <div className="eyebrow">Import history</div>
      <p className="hint" style={{ margin: "8px 0 12px", maxWidth: "78ch" }}>
        Every import and restore, newest first. Undoing one removes the trades it
        created — including anything you have added to them since, which is the part
        worth pausing over.
      </p>

      {/**
        * The search comes first because it answers the question people
        * actually arrive with.
        *
        * Nobody opens this screen wondering what happened on the fourteenth.
        * They open it because they hold PTC and cannot find it, and a list
        * ordered by date makes them read every import to find out. Asked by
        * symbol, the same records answer in one line.
        */}
      {batches.some((b) => b.report) && (
        <div className="ih-find">
          <Search size={13} />
          <input
            className="in"
            value={query}
            placeholder="Missing a stock? Type its symbol"
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find what happened to a symbol"
          />
          {query && (
            <button className="btn ghost sm" type="button" onClick={() => setQuery("")}>
              Clear
            </button>
          )}
        </div>
      )}

      {query.trim() && (
        <div className="ih-answers">
          {found.length === 0 ? (
            <div className="hint">
              No import has mentioned <b>{query.trim().toUpperCase()}</b>. If you hold it,
              it has never been in a file you brought here — add it by hand, or import a
              holdings file.
              {batches.some((b) => !b.report) && (
                <> Imports from before this screen started keeping records cannot say.</>
              )}
            </div>
          ) : (
            found.map(({ batch, outcome, why }) => (
              <div key={batch.id} className="ih-answer" data-kind={outcome}>
                <div className="ih-answer-h">
                  <b>{OUTCOME_LABEL[outcome] || outcome}</b>
                  <span className="hint">
                    {label(batch)} · {fmtWhen(batch.created_at)}
                  </span>
                </div>
                <div className="hint">{why}</div>
              </div>
            ))
          )}
        </div>
      )}

      {err && <div className="warn" style={{ marginBottom: 10 }}>{err}</div>}
      {done && (
        <div className="hint" style={{ color: "var(--long)", marginBottom: 10 }}>{done}</div>
      )}

      {!batches.length ? (
        <div className="hint">Nothing imported yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {batches.map((b, i) => (
            <div key={b.id} className="ih-row" data-first={i === 0 ? 1 : 0}>
              <div style={{ minWidth: 0 }}>
                <div className="ih-title">
                  <FileText size={13} />
                  <span>{label(b)}</span>
                </div>
                <div className="hint" style={{ marginTop: 2 }}>
                  {fmtWhen(b.created_at)}
                  {liveCount(b) != null && ` · ${liveCount(b)} trade${liveCount(b) === 1 ? "" : "s"}`}
                  {b.filename ? ` · ${b.filename}` : ""}
                </div>

                {/* The whole decision, for reading rather than searching. Shut
                    by default: it is the answer to a question most visits are
                    not asking, and open it would bury the row it belongs to. */}
                {b.report && (b.report.issues?.length || b.report.warnings?.length ||
                              b.report.sections?.length) ? (
                  <details className="ih-report">
                    <summary>
                      What this import decided
                      {b.report.issues?.length > 0 && (
                        <span className="ih-count">
                          {b.report.issues.length} not imported
                        </span>
                      )}
                    </summary>

                    {b.report.imported?.length > 0 && (
                      <div className="ih-grp">
                        <b>{b.report.kind === "tradebook" ? "Dated" : "Imported"}</b>{" "}
                        <span className="ih-syms">{b.report.imported.join(", ")}</span>
                      </div>
                    )}

                    {/* Grouped by outcome rather than listed flat: "why is
                        nothing here" and "why is this one thing here" are
                        different questions, and the reason is shared. */}
                    {Object.entries(
                      (b.report.issues || []).reduce((a, x) => {
                        (a[x.o] = a[x.o] || []).push(x);
                        return a;
                      }, {})
                    ).map(([o, list]) => (
                      <div key={o} className="ih-grp">
                        <b>{OUTCOME_LABEL[o] || o}</b>{" "}
                        <span className="ih-syms">{list.map((x) => x.s).join(", ")}</span>
                        <div className="hint">{list[0].why}</div>
                      </div>
                    ))}

                    {b.report.sections?.length > 0 && (
                      <div className="ih-grp">
                        <b>Sections skipped</b>{" "}
                        <span className="ih-syms">
                          {b.report.sections.map((s) => `${s.section} (${s.rows})`).join(", ")}
                        </span>
                      </div>
                    )}

                    {b.report.warnings?.length > 0 && (
                      <div className="ih-grp">
                        <b><AlertTriangle size={10} /> Rows the file itself could not give us</b>
                        {b.report.warnings.slice(0, 20).map((w, j) => (
                          <div key={j} className="hint">{w}</div>
                        ))}
                      </div>
                    )}

                    {b.report.truncated > 0 && (
                      <div className="hint">
                        …and {b.report.truncated} more not listed — the record is capped
                        so this page stays quick to open.
                      </div>
                    )}
                  </details>
                ) : null}
              </div>

              {arming === b.id ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {/* The count is repeated here on purpose. It is the number
                      that should give somebody pause, and it belongs next to
                      the button that acts on it rather than only in the row
                      above. */}
                  <span className="ih-ask">
                    {liveCount(b) === 0
                      ? "Nothing left from this import — remove the record?"
                      : `Delete ${liveCount(b)} trade${liveCount(b) === 1 ? "" : "s"} and anything added to them since?`}
                  </span>
                  <button className="btn sm" onClick={() => go(b)} disabled={busy === b.id}>
                    {busy === b.id ? "Undoing…" : "Yes, undo"}
                  </button>
                  <button className="btn ghost sm" type="button" onClick={() => setArming(null)}>
                    Keep
                  </button>
                </div>
              ) : (
                <button className="btn ghost sm" type="button"
                        onClick={() => { setArming(b.id); setDone(""); setErr(""); }}>
                  <RotateCcw size={12} /> Undo
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        /* The search sits above the list and looks like a question, not a
           filter — it does not remove rows, it answers about one symbol. */
        .ih-find {
          display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
        }
        .ih-find :global(input) { max-width: 300px; }
        .ih-answers { display: grid; gap: 8px; margin-bottom: 14px; }
        .ih-answer {
          border: 1px solid var(--rule); border-left: 2px solid var(--rule);
          border-radius: 3px; padding: 9px 11px; background: var(--card);
        }
        /* Outcome colours the edge only. The reason is the content; the
           colour is for scanning several answers at once. */
        .ih-answer[data-kind="imported"], .ih-answer[data-kind="dated"] {
          border-left-color: var(--long);
        }
        .ih-answer[data-kind="conflict"], .ih-answer[data-kind="rejected"],
        .ih-answer[data-kind="short"] { border-left-color: var(--short); }
        .ih-answer[data-kind="duplicate"], .ih-answer[data-kind="absent"],
        .ih-answer[data-kind="completed"] { border-left-color: var(--brass); }
        .ih-answer-h {
          display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap;
          font-size: 13px; margin-bottom: 2px;
        }
        .ih-report { margin-top: 7px; }
        .ih-report summary {
          font-size: 11.5px; color: var(--ink2); cursor: pointer;
          display: flex; align-items: center; gap: 8px;
        }
        .ih-count {
          font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase;
          color: var(--brass); border: 1px solid var(--brass);
          border-radius: 2px; padding: 1px 4px;
        }
        .ih-grp { margin-top: 8px; font-size: 12px; }
        .ih-grp b { font-weight: 600; }
        /* Wraps rather than scrolls: a long symbol list is meant to be read
           through, and a scroller hides exactly the name being looked for. */
        .ih-syms {
          font-family: var(--mono, ui-monospace, monospace);
          font-size: 11.5px; color: var(--ink2); word-break: break-word;
        }
        .ih-row {
          display: flex; align-items: center; justify-content: space-between;
          gap: 14px; padding: 12px 14px; border-top: 1px solid var(--rule);
        }
        .ih-row[data-first="1"] { border-top: 0; }
        .ih-title {
          display: flex; align-items: center; gap: 7px;
          font-size: 13px; font-weight: 500;
        }
        .ih-ask { font-size: 12px; color: var(--short); }
      `}</style>
    </div>
  );
}

/**
 * What the batch was.
 *
 * `source` is the broker id for a file import and `ledgerr-export` for a
 * restore, with `zerodha-taxpnl` as the column's original default from before
 * there was more than one broker. Unknown values are shown as they are rather
 * than as "Unknown import" — a raw string somebody can search for beats a
 * label that hides which one it was.
 */
function label(b) {
  const src = String(b.source || "");
  if (src === "ledgerr-export") return "Restored from an export";

  /**
   * The importer writes `${broker.id}-taxpnl`, so the suffix is stripped
   * rather than every combination being listed. A broker added next month
   * gets a readable label here without anyone remembering to come back — and
   * forgetting is exactly what happened with Groww, which shipped and then
   * displayed as the raw string `groww-taxpnl`.
   */
  const id = src.replace(/-(taxpnl|holdings|tradebook)$/, "");
  const names = {
    zerodha: "Zerodha tax P&L",
    groww: "Groww capital gains",
    dhan: "Dhan tax P&L",
    // Named for what ICICI calls it — the report's own title cell is "Equity
    // PL", and it is reached from Portfolio rather than from anything labelled
    // tax. Added late, having shipped one import as the raw `icicidirect-
    // taxpnl`, which is the Groww mistake the note above already describes.
    icicidirect: "ICICI Direct equity P&L",
    angelone: "Angel One tax P&L",
    iifl: "IIFL tax P&L",
    // The kind is part of the id here, not only the suffix, because there are
    // two Zerodha adapters reading two different files. Without this the row
    // read "zerodha_holdings-holdings", which is the raw-string fallback
    // working exactly as intended and still being the wrong thing to show.
    zerodha_holdings: "Zerodha holdings",
    // Says what it did rather than what it read, because it imports nothing —
    // a row labelled just "Zerodha tradebook" beside rows that created trades
    // implies it created some too.
    zerodha_tradebook: "Zerodha tradebook — dates only",
  };
  // An unknown id shows as itself. A raw string somebody can search for beats
  // a tidy "Unknown import" that hides which one it was.
  return names[id] || src || "Import";
}

function fmtWhen(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d)) return "";
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
