"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ImportTrades from "@/components/ImportTrades";
import RestoreExport from "@/components/RestoreExport";
import ImportHistory from "@/components/journal/ImportHistory";
import { listImportTargets, importTrades } from "@/lib/db";
import { useJournal } from "../JournalContext";

export default function ImportPage() {
  const router = useRouter();
  const { reloadTrades, say } = useJournal();
  const [targets, setTargets] = useState(null);
  const [keysErr, setKeysErr] = useState("");

  /**
   * The positions already here, which the importer needs before the picker is
   * usable: without them an overlapping file cannot tell a trade it has never
   * seen from one merely scaled out further since the last import, and would
   * insert a second copy carrying sells the first already holds.
   *
   * Re-read after anything changes the journal, not only on mount.
   *
   * These keys are what tells the importer a trade is already here. Loaded
   * once, they go stale the moment an import is undone on the same visit — and
   * the symptom is baffling: undo removes fourteen trades, the file is dropped
   * again, and the screen insists all fourteen are "already in your journal".
   * The journal was right and the page was remembering.
   */
  const loadTargets = useCallback(() => {
    return listImportTargets()
      .then(setTargets)
      .catch((e) => setKeysErr(e.message || "Could not read existing trades."));
  }, []);

  useEffect(() => { loadTargets(); }, [loadTargets]);

  // Both the journal and the keys — the first drives every screen, the second
  // drives what the importer thinks it already has.
  const refreshAll = useCallback(
    async () => { await Promise.all([reloadTrades(), loadTargets()]); },
    [reloadTrades, loadTargets]
  );

  if (keysErr) {
    return (
      <div className="sec">
        <div className="eyebrow">Import</div>
        <div className="warn" style={{ marginTop: 12 }}>
          {keysErr} — this usually means migration 006 hasn't been run yet.
        </div>
      </div>
    );
  }

  if (!targets) {
    return (
      <div className="sec">
        <div className="eyebrow">Checking what's already here</div>
      </div>
    );
  }

  return (
    <div className="sec">
      <ImportTrades
        targets={targets}
        onImport={async (payload) => {
          const res = await importTrades(payload);
          await refreshAll();
          return res;
        }}
        onDone={(choice) => {
          say(choice === "fill-stops" ? "" : "Imported trades are in your trade sheet.");
          router.push(choice === "fill-stops" ? "/stops" : "/trades");
        }}
      />

      {/* Below the broker importer rather than beside it. Almost everyone
          arriving here has a broker file; the people with an export of their
          own are coming back after deleting an account, and they know what
          they are looking for. */}
      <RestoreExport onRestored={refreshAll} />

      {/* Last, because it is the way back rather than the way in. It is also
          what the restore screen points at when it says an import can be
          undone from the history — which was true of the database and not of
          the app until now. */}
      <ImportHistory onChanged={refreshAll} />
    </div>
  );
}
