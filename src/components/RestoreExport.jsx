"use client";

import { useState } from "react";
import { Upload, RotateCcw } from "lucide-react";
import { supabase, restoreFromExport } from "@/lib/db";
import { inspectExport, describePlan, planRestore, findContentDuplicates } from "@/lib/restore";

/**
 * Putting a journal back from the file the app gave you.
 *
 * The counterpart to Export everything, and the thing that makes Delete
 * account something other than a one-way door. Deliberately a separate flow
 * from the broker importer above it: that one reads somebody else's format and
 * has to guess: this one reads our own and does not.
 *
 * TWO STEPS, ALWAYS. The file is read and described before anything is
 * written, because the only honest way to ask "are you sure" is to say what is
 * about to happen. Reading is free and reversible; writing 300 rows into a
 * journal is neither.
 */
export default function RestoreExport({ onRestored, targets = [] }) {
  const [info, setInfo] = useState(null);
  const [json, setJson] = useState(null);
  const [filename, setFilename] = useState("");
  const [myEmail, setMyEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  // Worked out once when the file is read. planRestore is async now — it
  // derives ids with crypto.subtle — so it cannot be called during render.
  const [summary, setSummary] = useState("");
  /**
   * Trades already here that the file would add a second copy of.
   *
   * Worked out with the summary, before the confirm button exists, because
   * this is the one thing that turns an obviously-safe action into one worth
   * pausing over — and afterwards there is nothing to pause about.
   */
  const [dupes, setDupes] = useState([]);

  const pick = async (file) => {
    setErr(""); setDone(null); setInfo(null); setJson(null); setDupes([]);
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const seen = inspectExport(parsed);
      if (!seen.ok) { setErr(seen.error); return; }
      const { data } = await supabase.auth.getUser();
      setMyEmail(data?.user?.email || "");
      setFilename(file.name);
      setJson(parsed);
      setInfo(seen);
      const plan = await planRestore(parsed, data?.user?.id || "preview");
      setSummary(describePlan(plan));
      setDupes(findContentDuplicates(plan, targets));
    } catch {
      // A CSV, a broker file, or a JSON file that is simply something else.
      setErr("That file isn't a journal export. Use the JSON from My profile → Export everything.");
    }
  };

  const go = async () => {
    if (!json || busy) return;
    setBusy(true); setErr("");
    try {
      const res = await restoreFromExport(json, filename);
      setDone(res);
      setInfo(null); setJson(null);
      onRestored?.();
    } catch (e) {
      setErr(e.message || "The restore did not finish.");
    }
    setBusy(false);
  };

  // Not a block. Somebody may well be restoring an export taken before they
  // changed their address, and refusing would strand them with a file the app
  // wrote and will not read.
  const otherAccount = info && info.email && myEmail &&
    info.email.toLowerCase() !== myEmail.toLowerCase();

  return (
    <div style={{ marginTop: 34 }}>
      <div className="eyebrow">Restore from a LedgeRR export</div>
      <p className="hint" style={{ margin: "8px 0 12px", maxWidth: "78ch" }}>
        The JSON file from <b>My profile → Export everything</b>. It carries your stops,
        setups, notes and charge overrides — everything a broker file cannot. Importing the
        same file twice is safe: it writes over the same rows rather than making a second copy.
      </p>

      {!info && !done && (
        <label className="btn ghost sm" style={{ cursor: "pointer", display: "inline-flex" }}>
          <Upload size={13} /> Choose your export file
          <input type="file" accept="application/json,.json" hidden
                 onChange={(e) => pick(e.target.files?.[0])} />
        </label>
      )}

      {err && <div className="warn" style={{ marginTop: 10 }}>{err}</div>}

      {info && (
        <div className="card" style={{ padding: 14, marginTop: 6 }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            <b>{filename}</b> — exported {String(info.exportedAt).slice(0, 10)}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink2)", lineHeight: 1.65 }}>
            About to restore {summary}.
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            Charts cannot come back — the images were deleted with the account. Usage and
            crash records are not restored either.
          </div>

          {otherAccount && (
            <div className="warn" style={{ marginTop: 10 }}>
              This file was exported by <b>{info.email}</b>, and you are signed in as{" "}
              <b>{myEmail}</b>. Carry on if that was you under an old address.
            </div>
          )}

          {/* The one case where "restoring twice is safe" stops being true.
              Said here rather than in the paragraph above, because it depends
              on this file against this journal and cannot be promised in
              general. */}
          {dupes.length > 0 && (
            <div className="warn" style={{ marginTop: 10 }}>
              <b>{dupes.length} of these trades are already in this journal</b>, under
              different ids — almost always because they were imported from a broker
              file here as well as in the account this export came from. Restoring will
              add a second copy of each.
              <div className="hint" style={{ marginTop: 6 }}>
                {dupes.slice(0, 8).map((d) => `${d.symbol} ${d.entry_date}`).join(" · ")}
                {dupes.length > 8 && ` · …and ${dupes.length - 8} more`}
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                Restoring into an empty journal — the usual path after deleting an
                account — never hits this. If you meant to merge two accounts, carry on
                and undo from the import history if it looks wrong.
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button className="btn" onClick={go} disabled={busy}>
              {busy ? "Restoring…" : "Restore this journal"}
            </button>
            <button className="btn ghost sm" type="button" disabled={busy}
                    onClick={() => { setInfo(null); setJson(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="card" style={{ padding: 14, marginTop: 6 }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            <b>Restored.</b>{" "}
            {Object.entries(done.written)
              .filter(([, n]) => n)
              .map(([t, n]) => `${n} ${t.replace(/_/g, " ")}`)
              .join(", ")}
            {done.profileRestored ? ", and your account settings." : "."}
          </div>
          {/* Said precisely, because undo_import deletes trades and nothing
              else — the sells go with them on the foreign key, but diary
              entries and capital flows stay. Promising a clean undo and
              leaving those behind would be the worse kind of wrong: somebody
              would believe the restore had been reversed. */}
          <div className="hint" style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <RotateCcw size={12} style={{ marginTop: 3, flex: "0 0 auto" }} />
            <span>
              Undoing this from the import history removes the trades and their sells.
              {(done.written.diary_entries || done.written.capital_flows)
                ? " Diary entries and capital flows stay — delete those individually if you need to."
                : ""}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
