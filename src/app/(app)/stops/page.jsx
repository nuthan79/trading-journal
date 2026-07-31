"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import StopFill from "@/components/StopFill";
import { saveStops } from "@/lib/db";
import { useJournal } from "../JournalContext";

export default function StopsPage() {
  const router = useRouter();
  const { trades, reloadTrades, say } = useJournal();

  // Raw rows, not the derived ones — StopFill computes its own preview R from
  // entry/exit/charges, and a derived row would already have folded in the
  // missing stop as NaN.
  // Bonus shares are excluded, not merely skipped by the bulk fill. They
  // cost nothing, so there is no entry to take a percentage below and no
  // risk to divide an R by — they are not waiting for anything.
  const needStops = useMemo(
    () => trades.filter((t) => t.stop_loss == null && t.acquisition !== "bonus"),
    [trades]
  );

  return (
    <div className="sec">
      <StopFill
        trades={needStops}
        onSave={async (rows, onProgress) => {
          const n = await saveStops(rows, onProgress);
          await reloadTrades();
          const assumed = rows.length > 0 && rows.every((r) => r.stop_source === "assumed");
          say(`${n} stop${n === 1 ? "" : "s"} saved${assumed ? ", marked assumed" : ""}.`);
        }}
        onDone={() => router.push("/trades")}
      />
    </div>
  );
}
