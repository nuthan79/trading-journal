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
  /**
   * No stop at all, or one the importer assumed.
   *
   * It used to be only the first, which emptied this screen for exactly the
   * people it was built for. A tax P&L states no stop, so the importer offers
   * to assume one below entry — after which every imported trade HAS a stop,
   * nothing reached here, and the page said "Every trade has a stop" over
   * hundreds of 7% guesses.
   *
   * `stop_source` exists to tell those apart. An assumed stop sets 1R, which
   * is the unit the whole journal is denominated in, from a percentage nobody
   * chose for that trade — so leaving them unreviewable makes every R
   * downstream a guess wearing a real number's clothes.
   *
   * Bonus shares stay out however their stop arrived: they cost nothing, so
   * there is no entry to sit below and no risk to divide an R by.
   */
  const needStops = useMemo(
    () => trades.filter(
      (t) => t.acquisition !== "bonus" &&
             (t.stop_loss == null || t.stop_source === "assumed")
    ),
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
