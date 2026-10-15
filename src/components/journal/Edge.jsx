"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { dimensionRows, DIMENSIONS, labelOf, maxAbsTotalR, isThin, thinAt, NOT_RECORDED, edgeHref } from "@/lib/edge";
import { useSectors } from "@/lib/sectors";
import { useMarketCap } from "@/lib/marketCap";
import { useBreadth } from "@/lib/breadth";
import { SHOW_MARKET_BREADTH } from "@/lib/flags";
import { mistakeCost, outcomeTagCounts } from "@/lib/analysis";
import { givebackBook, givebackByTag, postExitNeeded, exitVerdict } from "@/lib/giveback";
import { COLUMN_HINTS } from "@/lib/columns";
import { isExecutionError } from "@/lib/constants";
import { money, rfmt, pct } from "@/lib/format";
import Money from "@/components/Money";

/*
 * The table's columns, each with its own hover. All ten always show: a Columns
 * picker was tried here and taken out at the user's request — this table is
 * read whole, not configured. Hints are this table's own, not Trades'.
 */
/* The exit-timing tags, costed by giveback rather than by what the trades
   made — see "What the exits cost" below and lib/giveback.js. */
const LATE = "Sold a little late";
const EARLY = "Sold too early";
const EXIT_TAGS = [LATE, EARLY];

const EDGE_COLUMNS = [
  { k: "trades", label: "Trades", hint: "Closed trades in this group" },
  { k: "winRate", label: "Win rate", hint: "Share of these trades that made money" },
  { k: "avgWin", label: "Avg win", hint: "The average winner, in R" },
  { k: "avgLoss", label: "Avg loss", hint: "The average loser, in R" },
  { k: "expectancy", label: "Expectancy", hint: "Average R per trade — what one more trade like these is worth" },
  { k: "totalR", label: "Total R", hint: "Every trade in the group, added up in R" },
  { k: "netPnl", label: "Net P&L", hint: "What the group made, after charges and MTF" },
  { k: "avgValue", label: "Avg value", hint: "The average position size" },
  { k: "avgRisk", label: "Avg risk", hint: "The average rupees put at risk" },
  { k: "returnOnRisk", label: "Return on risk", hint: "Net P&L as a multiple of the rupees risked" },
];


/**
 * Where the edge is — the same trades, cut ten ways.
 *
 * MOVED OUT OF PERFORMANCE, AND THE NAME IS THE REASON. `edge.js` computes this
 * table and always has; meanwhile the tab called Edge was running
 * `expectancy.js` and projecting a curve. The modules and the tabs were saying
 * opposite things. This is the screen with the claim on the word: it reports
 * where an edge actually was, in trades that were actually taken. The projection
 * next door is a question, and it is now called What-if.
 *
 * WHAT PERFORMANCE KEEPS. Totals, period returns and capital deployment — the
 * statement, consulted the way a statement is. This is the argument about it,
 * which is a different act and a less frequent one.
 *
 * THE THREE TABLES BELONG TOGETHER because they are one idea: group the trades
 * by something and see what each group earned. By setup, by execution error, by
 * what the market did. Splitting them across two screens, which is how it was,
 * meant the cost of a mistake sat a long way from the setups it happened in.
 */
export default function Edge({ closed: rawClosed = [], accountSize, dimFromUrl = null }) {
  /*
   * THE OPEN TAB LIVES IN THE ADDRESS, so a trip to the trades behind a row
   * comes back to it. It was component state alone, and both the browser's
   * Back and the trades screen's own Back link landed on Base pattern
   * whichever cut you had been reading. Replaced, not pushed: switching tabs
   * is not somewhere Back should step through one at a time.
   *
   * `dimFromUrl` comes from the page's useSearchParams, NOT from
   * window.location: on a client-side navigation Next updates the address bar
   * after the new page first renders, so reading window.location here saw
   * the PREVIOUS page's address — the Market screen's link to ?dim=breadth
   * opened on Base pattern. Followed as a prop thereafter, so a second link
   * to this page with a different tab still lands on it.
   */
  const [dim, setDimState] = useState(dimFromUrl || "pattern");
  const [seenDim, setSeenDim] = useState(dimFromUrl);
  if (dimFromUrl !== seenDim) {
    setSeenDim(dimFromUrl);
    if (dimFromUrl) setDimState(dimFromUrl);
  }
  const setDim = (id) => {
    setDimState(id);
    try { window.history.replaceState(window.history.state, "", `?dim=${encodeURIComponent(id)}`); } catch {}
  };

  /* What business each company is in, laid onto the trades before anything
     groups them — `sector` is not a column on a trade, and edge.js reads it
     as though it were. Asked for unconditionally here, unlike on the tables,
     because the grouping button has to know whether there is anything to
     group by before anybody can choose it. */
  const sectorOf = useSectors(true);
  /* And how big the company was on the day it was bought — the list in force
     then, not today's, or the winners that grew are counted a size up. */
  const capOf = useMarketCap(true);
  /* And how broad the market was the evening before — the last close a
     trader could have read before buying. */
  const breadth = useBreadth(SHOW_MARKET_BREADTH);
  const closed = useMemo(
    () => rawClosed.map((t) => ({ ...t, ...sectorOf(t.symbol), mcap: capOf(t.symbol, t.entry_date),
                                  breadthBand: breadth.bandAt(t.entry_date) })),
    [rawClosed, sectorOf, capOf, breadth],
  );
  /* The rupee range behind a market-cap row, from that row's own trades. */
  const mcapRange = (label) => capOf.rangeFor(label, closed.filter((t) => t.mcap === label));

  /* Only the groupings that apply to this record — see `showIf` in edge.js.
     The table reads D.id, not `dim`, so a grouping that has disappeared falls
     back to the first one for the table and the lit button alike. */
  const dims = useMemo(() => DIMENSIONS.filter((d) => !d.showIf || d.showIf(closed)), [closed]);
  const D = dims.find((d) => d.id === dim) || dims[0];

  const groups = useMemo(
    () => dimensionRows(closed, D.id, { accountSize }),
    [closed, D.id, accountSize]
  );
  const maxAbs = useMemo(() => maxAbsTotalR(groups), [groups]);

  /* The two exit-timing tags are costed apart, below. You only write "Sold a
     little late" on a trade that ran, and "Sold too early" on one that kept
     going — so both select WINNERS, and in a table headed "what the mistakes
     cost" they read +1.47R and +4.10R: selling badly, apparently, pays. */
  const mistakeRows = useMemo(
    () => mistakeCost(closed, isExecutionError).filter((m) => !EXIT_TAGS.includes(m.tag)),
    [closed],
  );
  const exits = useMemo(() => {
    const book = givebackBook(closed);
    const late = givebackByTag(closed, LATE);
    /* Money medians come from the measured rows themselves: the book and the
       tag comparison give the R and the kept share, and the rupee figure is
       the same rows at each trade's own 1R. */
    const of = (rows) => {
      const m = rows.map((r) => r.givebackMoney).filter(Number.isFinite).sort((a, b) => a - b);
      const k = m.length >> 1;
      return m.length ? (m.length % 2 ? m[k] : (m[k - 1] + m[k]) / 2) : NaN;
    };
    const tagged = book.rows.filter((r) => (r.t.mistakes || []).includes(LATE));
    const rest = book.rows.filter((r) => !(r.t.mistakes || []).includes(LATE));
    return {
      book, late,
      money: { all: of(book.rows), tagged: of(tagged), rest: of(rest) },
      early: postExitNeeded(closed, EARLY),
    };
  }, [closed]);
  const outcomeRows = useMemo(() => outcomeTagCounts(closed, isExecutionError), [closed]);

  if (!closed.length) {
    return (
      <div className="sec card empty">
        <div className="eyebrow">Where the edge is</div>
        <p>This reads your closed trades and tells you which setups actually pay.
          It needs closed trades to read. Log a few and come back.</p>
      </div>
    );
  }

  return (
    <>
      <div className="sec">
        <div className="sechead">
          <div>
            <div className="eyebrow">Where the edge is</div>
            <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3 }}>
              Same trades, cut a different way. Expectancy is the column that matters.
              <b> Click any row</b> to see the trades in it.
            </div>
          </div>
        </div>
        <div className="seg" style={{ marginBottom: 12 }}>
          {dims.map((d) => (
            <button key={d.id} data-on={D.id === d.id ? 1 : 0} onClick={() => setDim(d.id)}>{labelOf(d)}</button>
          ))}
        </div>
        <div className="card scroll">
          <table className="t">
            <thead><tr>
              <th>{labelOf(D)}</th>
              {EDGE_COLUMNS.map((c) => (
                <th key={c.k} className="num" title={c.hint}>{c.label}</th>
              ))}
              <th style={{ width: "16%" }}></th>
            </tr></thead>
            <tbody>
              {groups.map((g) => {
                const wpx = (Math.abs(g.totalR) / maxAbs) * 100;
                return (
                  <tr key={g.key} style={{ opacity: isThin(g, D) ? 0.55 : 1 }}>
                    {/* The row is the way in, exactly as it is in the mistakes
                        table below. A table that costs a slice out and then
                        offers no route to the trades inside it is where the
                        reader has to go and find them by hand. */}
                    <td>
                      <Link className="mk-link" href={edgeHref(D.id, g)}
                            title={`See the ${g.trades} trade${g.trades === 1 ? "" : "s"} in ${g.key}`
                              /* What the size meant in rupees, across the lists these
                                 trades were bought under. */
                              + (D.id === "mcap" && mcapRange(g.key) ? `. ${mcapRange(g.key)}` : "")}
                            style={g.key === NOT_RECORDED
                              ? { fontStyle: "italic", color: "var(--ink3)" }
                              : { fontWeight: 500 }}>
                        {g.key}
                      </Link>
                    </td>
                    {/*
                      HOW MANY TRADES ARE IN THIS BAND — not how many of them
                      have an R.

                      This printed `g.n`, which stats() defines as the trades
                      carrying a finite R, and a band whose trades all lack a
                      stop has none. So a US book of imported holdings showed
                      "0 trades" on a row that also showed $201.33 of net P&L,
                      three lines below a link whose own hover read "See the 3
                      trades in 2 years+". Its own column hint says "Closed
                      trades in this group", and isThin() already counts them
                      that way — this cell was the only thing reading n.

                      Where some of them have a stop and some do not, the two
                      figures are both true of different columns, and the
                      hover says which is which rather than picking one and
                      hoping.
                    */}
                    <td className="num"
                        title={g.n < g.trades
                          ? `${g.n} of these ${g.trades} ${g.n === 1 ? "has" : "have"} a stop on `
                            + `record, so the R columns describe `
                            + `${g.n === 0 ? "none of them" : g.n === 1 ? "that one" : `those ${g.n}`}. `
                            + `Net P&L and Avg value describe all ${g.trades}.`
                          : undefined}>
                      {g.trades}
                    </td>
                    <td className="num">{pct(g.winRate, 0)}</td>
                    <td className="num pos">{rfmt(g.avgWin)}</td>
                    <td className="num neg">{rfmt(-g.avgLoss)}</td>
                                        <td className={`num ${g.expectancy >= 0 ? "pos" : "neg"}`} style={{ fontWeight: 500 }}>
                      {rfmt(g.expectancy)}</td>
                    <td className={`num ${g.totalR >= 0 ? "pos" : "neg"}`}>{rfmt(g.totalR, 1)}</td>
                    {/* Net of charges — grossRealised minus charges, the same
                        figure returnOnRisk beside it is already built from. R
                        answers whether the setup works; this answers what it
                        paid, and they part company whenever risk per trade
                        was not constant. */}
                                        <td className={`num ${g.netPnl >= 0 ? "pos" : "neg"}`} style={{ fontWeight: 500 }}>
                      <Money v={g.netPnl} />
                    </td>
                    <td className="num"><Money v={g.avgValue} /></td>
                    <td className="num"><Money v={g.avgRisk} note={`${pct(g.avgRiskPct, 2)} of capital`} /></td>
                    <td className="num">{isFinite(g.returnOnRisk) ? `${g.returnOnRisk.toFixed(2)}×` : "—"}</td>
                    <td>
                      <div style={{ display: "flex", justifyContent: g.totalR >= 0 ? "flex-start" : "flex-end" }}>
                        <div style={{ width: `${wpx}%`, height: 7, borderRadius: 1,
                                      background: g.totalR >= 0 ? "var(--long)" : "var(--short)", opacity: 0.75 }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {D.hint && <div className="hint" style={{ marginTop: 8 }}>{D.hint}</div>}
        {groups.some((g) => g.n < g.trades) && (
          <div className="hint" style={{ marginTop: 8 }}>
            Where a row holds trades with no stop on record, the R columns describe only
            the ones that have a stop — R is profit over the risk taken, and there is none
            to divide by without it. Net P&amp;L and Avg value describe every trade in the row.
          </div>
        )}
        {groups.some((g) => isThin(g, D)) && (
          <div className="hint" style={{ marginTop: 8 }}>
            Faded rows have fewer than {thinAt(D)} trades — noise, not signal. Read them as questions to watch, not conclusions.
          </div>
        )}
        {/* Only on the rupee cut. Every other dimension here is either
            categorical or already normalised; this is the one whose bands
            drift as the account grows, and saying so is cheaper than letting
            someone read a decade of compounding as a finding about sizing. */}
        {/* Which R the margin comparison is in, because it depends on Setup:
            after MTF cost when deducted, before it when not. */}
        {D.id === "mtf" && (
          <div className="hint" style={{ marginTop: 8 }}>
            {closed.some((t) => t.marginInPnl === false)
              ? "R here is before MTF cost — you chose not to deduct it in Setup. Deduct it to see whether margin pays after its interest."
              : "R here is after MTF cost, so this shows whether margin pays once its interest and pledge charges are paid."}
          </div>
        )}
        {D.id === "riskamt" && (
          /* One line, and the fix is one click: the paragraph this replaces
             explained the drift in sixty words and then named the dimension
             that removes it without offering a way there. */
          <div className="hint" style={{ marginTop: 8 }}>
            Rupee risk grows with your account, so this partly shows <i>when</i>, not how much —{" "}
            <button type="button" className="lnk" onClick={() => setDim("risk")}>Risk % of capital</button>
            {" "}compares like with like.
          </div>
        )}
      </div>

      {mistakeRows.length > 0 && (
        /* An anchor, so Back on Trades from a mistake lands here
           rather than at the top of the page — stopping short of it by the
           sticky top bar (202px at its tallest since the market strip, when
           the tabs wrap), or the heading and first row land underneath. */
        <div className="sec" id="mistakes" style={{ scrollMarginTop: 215 }}>
          <div className="sechead">
            <div>
              <div className="eyebrow">What the mistakes cost</div>
              <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3 }}>
                Only counts trades where you tagged an execution error yourself.
                Net P&amp;L is what those trades came to, not what the mistake cost you —
                nobody can know what the same trade would have done without it.
                <b> Click a mistake</b> to see the trades behind it.
              </div>
            </div>
          </div>
          <div className="card scroll">
            <table className="t">
              <thead><tr><th>Mistake</th><th className="num">Times</th>
                <th className="num">Win rate</th><th className="num">Expectancy</th>
                <th className="num">Total R</th><th className="num">Net P&amp;L</th></tr></thead>
              <tbody>
                {mistakeRows.map((m) => (
                  <tr key={m.tag}>
                    {/* The row is the way in. Costing a tag out and then
                        offering no route to the trades behind it is where this
                        table used to stop. */}
                    <td>
                      <Link className="mk-link"
                            href={`/trades?mistake=${encodeURIComponent(m.tag)}`}
                            title={`See the ${m.count} trade${m.count === 1 ? "" : "s"} tagged "${m.tag}"`}>
                        {m.tag}
                      </Link>
                    </td>
                    <td className="num">{m.count}</td>
                    <td className="num">{pct(m.winRate, 0)}</td>
                    <td className={`num ${m.avgR >= 0 ? "pos" : "neg"}`}>{rfmt(m.avgR)}</td>
                    <td className={`num ${m.totalR >= 0 ? "pos" : "neg"}`}>{rfmt(m.totalR, 1)}</td>
                    <td className={`num ${m.netPnl >= 0 ? "pos" : "neg"}`} style={{ fontWeight: 500 }}>
                      <Money v={m.netPnl} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Same tags, different question. Mindset asks WHEN these happen —
              which state they cluster in — and this asks what they cost. Worth
              pointing at, and worth keeping to two screens: a third table of
              the same tags would mean the split had stopped meaning anything. */}
          <div className="hint" style={{ marginTop: 8 }}>
            <Link href="/analysis/mindset">Mindset</Link> groups the same tags by the
            state you were in when the trade was taken.
          </div>
        </div>
      )}

      {/*
        WHAT THE EXITS COST — the exit-timing tags, costed by the distance
        between each trade's best daily close and the sell, which the measure
        pass already stores (lib/giveback.js), rather than by what the trades
        made. Medians throughout: one 17R runner sold at 9R would carry a mean
        on its own. The tag row carries a verdict, because a self-applied tag
        is only worth costing if it marks trades the measurement also finds.
      */}
      {(exits.book.measured > 0 || exits.early.count > 0) && (
        <div className="sec">
          <div className="sechead">
            <div>
              <div className="eyebrow">What the exits cost</div>
              <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3 }}>
                How much of each trade&rsquo;s best close it handed back before you sold —
                measured from the daily closes, not from the tag.
                <b> Click a tag</b> to see its trades.
              </div>
            </div>
          </div>
          {exits.book.measured > 0 ? (
            <div className="card scroll">
              <table className="t">
                <thead><tr>
                  <th>Trades</th>
                  <th className="num" title={COLUMN_HINTS.exitTrades}>Times</th>
                  <th className="num" title={COLUMN_HINTS.exitGivebackR}>Gave back</th>
                  <th className="num" title={COLUMN_HINTS.exitGivebackMoney}>In money</th>
                  <th className="num" title={COLUMN_HINTS.exitKept}>Kept of peak</th>
                  <th title={COLUMN_HINTS.exitVerdict}>Does the tag mark it?</th>
                </tr></thead>
                <tbody>
                  {[
                    { key: "all", label: "Every measured trade", n: exits.book.measured,
                      r: exits.book.medianGivebackR, kept: exits.book.medianKeptPct,
                      money: exits.money.all, verdict: null },
                    exits.late && exits.late.tagged.count > 0 && {
                      key: "late", label: LATE, link: true, n: exits.late.tagged.count,
                      r: exits.late.tagged.medianGivebackR, kept: exits.late.tagged.medianKeptPct,
                      money: exits.money.tagged, verdict: exitVerdict(exits.late) },
                    exits.late && exits.late.tagged.count > 0 && {
                      key: "rest", label: "Not tagged", n: exits.late.untagged.count,
                      r: exits.late.untagged.medianGivebackR, kept: exits.late.untagged.medianKeptPct,
                      money: exits.money.rest, verdict: null },
                  ].filter(Boolean).map((row) => (
                    <tr key={row.key}>
                      <td>
                        {row.link ? (
                          <Link className="mk-link"
                                href={`/trades?mistake=${encodeURIComponent(row.label)}`}
                                title={`See the trades tagged "${row.label}"`}>
                            {row.label}
                          </Link>
                        ) : <span style={{ color: "var(--ink2)" }}>{row.label}</span>}
                      </td>
                      <td className="num">{row.n}</td>
                      <td className="num neg">{Number.isFinite(row.r) ? `${row.r.toFixed(2)}R` : "—"}</td>
                      <td className="num neg"><Money v={row.money} /></td>
                      <td className="num">{pct(row.kept, 0)}</td>
                      <td className={row.verdict?.tone ? `ed-verdict ${row.verdict.tone}` : "ed-verdict"}>
                        {row.verdict ? row.verdict.word : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="hint">
              None of your closed trades has been measured against its daily prices yet —
              the measure on the <Link href="/analysis/review">Process</Link> tab does it.
            </div>
          )}
          {/* NOT ESTIMATED. Selling early means the stock ran on after you
              sold, and the measure stops at the exit date — so the journal
              holds nothing that could cost it. Saying how many, and leaving it
              there, is the honest half; a guess here would be confident and
              wrong. */}
          {exits.early.count > 0 && (
            <div className="hint" style={{ marginTop: 8 }}>
              <Link className="mk-link" href={`/trades?mistake=${encodeURIComponent(EARLY)}`}>
                {EARLY}
              </Link>
              {" "}— {exits.early.count} trade{exits.early.count === 1 ? "" : "s"}. Costing it needs
              prices from after the exit, what the stock did in the {exits.early.sessions} sessions
              after you sold, and the journal does not record those yet. It is not estimated.
            </div>
          )}
          {exits.book.measured > 0 && (() => {
            const sk = exits.book.skipped;
            const parts = [
              sk.unmeasured && `${sk.unmeasured} not measured yet`,
              sk["no-stop"] && `${sk["no-stop"]} with no stop`,
              sk["never-ran"] && `${sk["never-ran"]} that never closed 0.25R above entry`,
            ].filter(Boolean);
            return parts.length ? (
              <div className="hint" style={{ marginTop: 6 }}>Left out: {parts.join(", ")}.</div>
            ) : null;
          })()}
        </div>
      )}

      {outcomeRows.length > 0 && (
        <div className="sec">
          <div className="sechead">
            <div>
              <div className="eyebrow">What didn&rsquo;t work</div>
              <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3 }}>
                Not mistakes — valid setups that simply didn&rsquo;t pay off, the cost of doing business
                in a breakout system. Kept separate so they don&rsquo;t bury the execution errors above.
              </div>
            </div>
          </div>
          <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 22 }}>
            {/* The way in, exactly as the mistake rows above have. A tile
                that counts trades and then offers no route to them is where
                the reader has to go and find them by hand. */}
            {outcomeRows.map((o) => (
              <Link key={o.tag} className="ed-otile"
                    href={`/trades?mistake=${encodeURIComponent(o.tag)}`}
                    title={`See the ${o.count} trade${o.count === 1 ? "" : "s"} tagged "${o.tag}"`}>
                <div className="mono" style={{ fontSize: 19, fontWeight: 500 }}>{o.count}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 2 }}>
                  <span className="ed-otile-t">{o.tag}</span> · {pct(o.share, 0)} of trades
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* global: the anchor is rendered by next/link rather than by this
          component's own JSX, so a scoped block would not reach it. Prefixed
          to keep it from leaking onto other links. */}
      <style jsx global>{`
        .mk-link {
          color: inherit; text-decoration: none;
          border-bottom: 1px dotted var(--ink3);
        }
        /* The whole tile is the target, but only the tag carries the dotted
           underline — on the count it would read as a struck-through number. */
        .ed-otile { color: inherit; text-decoration: none; display: block; }
        .ed-otile-t { border-bottom: 1px dotted var(--ink3); }
        .ed-otile:hover .ed-otile-t { color: var(--brass); border-bottom-color: var(--brass); }
        .mk-link:hover { color: var(--brass); border-bottom-color: var(--brass); }
        .ed-verdict { font-size: 12px; color: var(--ink2); white-space: nowrap; }
        .ed-verdict.neg { color: var(--short); }
        .ed-verdict.pos { color: var(--long); }
      `}</style>
    </>
  );
}
