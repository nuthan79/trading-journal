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
  const needStops = useMemo(
    () => trades.filter((t) => t.stop_loss == null),
    [trades]
  );

  return (
    <div className="sec">
      <StopFill
        trades={needStops}
        onSave={async (rows) => {
          await saveStops(rows);
          await reloadTrades();
          say(`${rows.length} stop${rows.length === 1 ? "" : "s"} saved.`);
        }}
        onDone={() => router.push("/trades")}
      />
    </div>
  );
}
