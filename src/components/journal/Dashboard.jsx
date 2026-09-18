"use client";

import LedgerPlot from "./LedgerPlot";
import Distribution from "./Distribution";
import Summary from "./Summary";
import HeadlineNumbers from "./HeadlineNumbers";
import MonthlyReturns from "./MonthlyReturns";
import ProfitConcentration from "./ProfitConcentration";
import FirstWeek from "./FirstWeek";

/**
 * How the system has done. What it is exposed to right now lives on Holdings,
 * which is why the open-holdings table isn't repeated here — nor the four
 * tiles that restated Headline Numbers, disagreeing with it as they did:
 * win rate there counted every closed trade, the tile weighted the twelve with
 * a stop, and two different 'win rate's on one screen is worse than one.
 */
export default function Dashboard({ closed, banking = [], accountSize, diary, flows, firstWeek }) {
  const lastEntry = diary[0];

  return (
    <>
      {/* First, above the record: for a new journal the next step matters more
          than a summary of trades that are mostly sample data. It removes
          itself once the three steps are done or two weeks have passed. */}
      {firstWeek && <FirstWeek {...firstWeek} />}

      <div className="sec"><Summary closed={closed} banking={banking} openingCapital={accountSize} flows={flows} /></div>

      <div className="sec"><HeadlineNumbers closed={closed} banking={banking} openingCapital={accountSize} flows={flows} /></div>

      <div className="sec"><LedgerPlot rows={closed} /></div>

      <div className="sec"><MonthlyReturns closed={closed} /></div>

      <div className="sec"><ProfitConcentration closed={closed} /></div>

      <div className="sec"><Distribution rows={closed} /></div>

      {lastEntry && (
        <div className="sec">
          <div className="sechead"><div className="eyebrow">Latest from the diary</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>{lastEntry.entry_date}</div></div>
          <div className="card">
            <div className="chips" style={{ marginBottom: 8 }}>
              {(lastEntry.emotions || []).map((e) => <span key={e} className="chip">{e}</span>)}
            </div>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.65,
                          maxHeight: 120, overflow: "hidden" }}>{lastEntry.body}</div>
          </div>
        </div>
      )}
    </>
  );
}

