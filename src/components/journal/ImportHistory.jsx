"use client";

import { useEffect, useState } from "react";
import { RotateCcw, FileText } from "lucide-react";
import { listImportBatches, importBatchCounts, undoImport } from "@/lib/db";

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
  const id = src.replace(/-taxpnl$/, "");
  const names = {
    zerodha: "Zerodha tax P&L",
    groww: "Groww capital gains",
    dhan: "Dhan tax P&L",
    angelone: "Angel One tax P&L",
    iifl: "IIFL tax P&L",
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
