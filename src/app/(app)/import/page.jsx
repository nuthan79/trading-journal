"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ImportTrades from "@/components/ImportTrades";
import { listTradeKeys, importTrades } from "@/lib/db";
import { useJournal } from "../JournalContext";

export default function ImportPage() {
  const router = useRouter();
  const { reloadTrades, say } = useJournal();
  const [existingKeys, setExistingKeys] = useState(null);
  const [keysErr, setKeysErr] = useState("");

  // Loaded before the picker is usable: without these, an overlapping file
  // would import duplicates rather than skip them.
  useEffect(() => {
    listTradeKeys()
      .then(setExistingKeys)
      .catch((e) => setKeysErr(e.message || "Could not read existing trades."));
  }, []);

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

  if (!existingKeys) {
    return (
      <div className="sec">
        <div className="eyebrow">Checking what's already here</div>
      </div>
    );
  }

  return (
    <div className="sec">
      <ImportTrades
        existingKeys={existingKeys}
        onImport={async (payload) => {
          const res = await importTrades(payload);
          await reloadTrades();
          return res;
        }}
        onDone={(choice) => {
          say(choice === "fill-stops" ? "" : "Imported trades are in your trade sheet.");
          router.push(choice === "fill-stops" ? "/stops" : "/trades");
        }}
      />
    </div>
  );
}
