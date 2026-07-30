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
