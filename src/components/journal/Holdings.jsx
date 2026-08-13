"use client";

import { useMemo, useState } from "react";
import { RefreshCw, Flag } from "lucide-react";
import { rupee, rfmt, pct, signedPct } from "@/lib/format";
import { fyStartYear, fyLabel } from "@/lib/calc";
import PositionDetail from "./PositionDetail";

/**
 * What is on the table right now.
 *
 * The dashboard answers how the system has done; this answers what it is
 * currently exposed to. So everything here is live: money at work, risk still
 * running, and what each position is worth against the mark.
 *
 * Open risk is the number the page is built around, read against a 5R line.
 * That line is a warning, not a cap — nothing here limits how many holdings
 * you can carry or refuses anything past it. An open-risk figure just means
 * very little without something to read it against.
 */

// Where the dial goes from green to amber, and where it starts warning.
const RISK_WARM_R = 3;
const RISK_WARN_R = 5;

// Once a trade is up this much, its stop can go to entry and its 1R comes back.
const FREE_AT_R = 1.5;


function Summary({ label, value, sub, tone, hint }) {
  return (
    <div className="ps-sum" title={hint || undefined}>
      <div className="ps-sum-l">{label}</div>
      <div className={`ps-sum-v mono ${tone || ""}`}>{value}</div>
      {sub != null && <div className="ps-sum-s mono">{sub}</div>}
    </div>
  );
}

/**
 * The risk dial. Sweeps clockwise from twelve o'clock toward the 5R warning
 * line: green while there's room, amber from 3R, red once it's past 5R. Past
 * 5R the ring simply stays full and turns red — it's a warning, not a limit,
 * so nothing here caps how much can be on.
 */
const DIAL_R = 52;
const DIAL_SW = 14;
const DIAL_C = 2 * Math.PI * DIAL_R;

function RiskDial({ riskR }) {
  const magnitude = isFinite(riskR) ? Math.abs(riskR) : 0;
  const swept = Math.min(magnitude, RISK_WARN_R);
  const past = magnitude > RISK_WARN_R;
  const level = magnitude >= RISK_WARN_R ? "hot"
    : magnitude >= RISK_WARM_R ? "warm" : "calm";
  const arc = (swept / RISK_WARN_R) * DIAL_C;

  // Integer-R marks, so the ring reads as a scale and not just a wedge.
  const mark = (n) => {
    const a = (n / RISK_WARN_R) * 2 * Math.PI - Math.PI / 2;
    const [r1, r2] = [DIAL_R - DIAL_SW / 2, DIAL_R + DIAL_SW / 2];
    return {
      x1: 70 + r1 * Math.cos(a), y1: 70 + r1 * Math.sin(a),
      x2: 70 + r2 * Math.cos(a), y2: 70 + r2 * Math.sin(a),
    };
  };

  return (
    <div className="ps-dial" data-level={level}>
      <div className="ps-dial-ring">
        <svg viewBox="0 0 140 140" role="img"
             aria-label={`Open risk ${magnitude.toFixed(2)}R against a ${RISK_WARN_R}R warning line`}>
          <g transform="rotate(-90 70 70)">
            <circle className="ps-dial-track" cx="70" cy="70" r={DIAL_R}
                    fill="none" strokeWidth={DIAL_SW} />
            <circle className="ps-dial-arc" cx="70" cy="70" r={DIAL_R}
                    fill="none" strokeWidth={DIAL_SW} strokeLinecap="butt"
                    strokeDasharray={`${arc} ${DIAL_C - arc}`} />
          </g>
          {/* Includes the mark at 5R, which is also 0R — twelve o'clock. Without
              it a full ring runs the last segment straight into the first and
              five positions read as one unbroken band. */}
          {[1, 2, 3, 4, 5].map((n) => <line key={n} className="ps-dial-mark" {...mark(n)} />)}
        </svg>
        <div className="ps-dial-mid">
          <span className="ps-dial-v mono">{magnitude.toFixed(2)}<i>R</i></span>
          <span className="ps-dial-s mono">of {RISK_WARN_R}R</span>
        </div>
      </div>
      {/* Keyed off the same level the colour uses. Testing `past` on its own
          left exactly 5.00R — five untrailed positions, which is not a rare
          place to be — showing a red ring over the words "room to the line". */}
      <div className="ps-dial-note">
        {level === "hot"
          ? past
            ? `Past the ${RISK_WARN_R}R line — more is riding on this than usual.`
            : `Right on the ${RISK_WARN_R}R line.`
          : level === "warm"
          ? `Inside the ${RISK_WARN_R}R line, but filling up.`
          : `Room to the ${RISK_WARN_R}R line.`}
      </div>
    </div>
  );
}


/**
 * The flag beside a symbol: this trade has run far enough that its stop can
 * go to breakeven.
 *
 * A reminder, and clicking it says you have read it.
 *
 * It used to be a button that wrote the entry price into the stop so the dial
 * would stop counting the position, which gave every trade two stops and made
 * a mistyped one impossible to correct. Removing that took the click away with
 * it, and left a notice that lit up on every visit with no way to put it down.
 * A reminder nobody can dismiss stops being read.
 *
 * So the click is back and writes a timestamp, not a stop. The stop that
 * matters is at the broker; this records only that you went and dealt with it.
 */
function BreakevenFlag({ c, busy, onAck }) {
  return (
    <button
      className="ps-flag"
      disabled={busy}
      onClick={() => onAck(c)}
      aria-label={`${c.symbol} is up ${c.gainR.toFixed(2)}R — dismiss the breakeven reminder`}
      title={
        `${c.symbol} is up ${c.gainR.toFixed(2)}R.\n\n` +
        `Its stop can go to ${c.entry.toFixed(2)} — breakeven — at your broker.\n\n` +
        `Click to dismiss this reminder. Nothing else changes: no stop moves, ` +
        `no R changes, and the open-risk dial goes on counting the stop you ` +
        `recorded here.`
      }
    >
      <Flag size={11} />
    </button>
  );
}

export default function Holdings({
  open, closed, diary = [], onRefresh, refreshing, onAckBreakeven,
  onEditTrade, onExitTrade, onDeleteTrade, onAttachChart, onRemoveChart,
}) {
  const [detailId, setDetailId] = useState(null);
  const [acked, setAcked] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const rows = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return open
      .map((t) => {
        const qtyOpen = isFinite(t.qtyOpen) ? t.qtyOpen : Number(t.quantity);
        const openPct = Number(t.quantity) > 0 ? (qtyOpen / Number(t.quantity)) * 100 : NaN;
        const liveExposure = isFinite(t.mark) ? t.mark * qtyOpen : Number(t.entry_price) * qtyOpen;
        // What the shares still held actually cost. Every other figure on the
        // row describes the open part — quantity, exposure, risk — so the cost
        // of a part already sold has no business among them.
        const buyValue = Number(t.entry_price) * qtyOpen;
        /**
         * Where price stands against this trade's 1R — the same figure the
         * position panel puts beside each sell, and the one a trader means by
         * "I sold a third at 6R".
         *
         * Deliberately NOT weighted by how much is still held. The column used
         * to show unrealised money over the whole position's 1R, which falls
         * the moment you sell any of it: KMEW sold down to 40% read +3.27R
         * while price was 8.2R above entry, so a trade at a new high looked
         * like one that had given most of it back. Nothing had dropped; the
         * numerator had.
         *
         * The rupee column beside it still carries what the remaining shares
         * are worth, and the strip above still totals the R that is summable.
         */
        const atR = t.riskPerShare > 0 && isFinite(t.mark)
          ? ((t.mark - Number(t.entry_price)) * (t.side === "short" ? -1 : 1)) / t.riskPerShare
          : NaN;
        const changePct = isFinite(t.mark) && Number(t.entry_price) > 0
          ? ((t.mark - Number(t.entry_price)) / Number(t.entry_price)) * 100 * (t.side === "short" ? -1 : 1)
          : NaN;
        /**
         * What the position did today, in rupees and as a percentage.
         *
         * Deliberately measured against prev_close rather than against
         * anything the journal knows, because "today" is a market fact, not
         * a journal one — a position entered two years ago still had a day.
         *
         * The percentage divides by the value of the holding at yesterday's
         * close, which is arithmetically the same as the move in the share
         * price: the quantity cancels. So the two figures in this cell never
         * disagree, whatever size the position is.
         *
         * Both are NaN unless prev_close is present AND positive. A missing
         * close leaves the cell blank rather than treating it as zero, which
         * would print the entire value of the holding as one day's gain.
         */
        const prevClose = Number(t.prev_close);
        const canToday = isFinite(t.mark) && isFinite(prevClose) && prevClose > 0;
        const dir = t.side === "short" ? -1 : 1;
        const todayAmt = canToday ? (t.mark - prevClose) * qtyOpen * dir : NaN;
        // What this holding was worth at yesterday's close. Only used to
        // total the book: a day's move across several positions has to be
        // weighted by what each had at stake, or a 2% move on ₹20k would
        // count the same as a 2% move on ₹2L.
        const todayBase = canToday ? prevClose * qtyOpen : NaN;

        /**
         * Where the price sits inside today's own range, 0 at the low and 1
         * at the high — and then only kept when it is near an end.
         *
         * Closing near the high means demand held into the close; giving the
         * day's gain back and closing near the low means supply met it. On a
         * breakout that reads on whether the setup is working.
         *
         * A fifth at each end, so most rows say nothing. The point is a
         * signal, not a reading: the same number on all eight rows would be
         * eight things to compare, which is the column this deliberately
         * isn't.
         *
         * The guard is `span > 0`, not `day_high != null`. A stock that has
         * not traded today — a halt, or a fetch before the open — reports the
         * same figure for high and low, and dividing by that zero span gives
         * Infinity or NaN, either of which would flag every such row as being
         * at its high.
         */
        const dHigh = Number(t.day_high);
        const dLow = Number(t.day_low);
        const span = dHigh - dLow;
        const inDay = isFinite(t.mark) && isFinite(span) && span > 0
          ? (t.mark - dLow) / span
          : NaN;
        const dayEnd = !isFinite(inDay) ? null
          : inDay >= 0.8 ? "high"
          : inDay <= 0.2 ? "low"
          : null;

        // How far CMP has to fall before the stop is hit, as a share of CMP —
        // the same reading the dashboard's open positions give. Breached means
        // price is already through it and the position is running on borrowed
        // time; for a short that's price rising into the stop instead.
        const stop = t.stop;
        const canRead = isFinite(t.mark) && isFinite(stop);
        const toStop = canRead ? ((t.mark - stop) / t.mark) * 100 : NaN;
        const breached = canRead && (t.side === "short" ? t.mark >= stop : t.mark <= stop);

        return {
          ...t,
          qtyOpen,
          openPct,
          liveExposure,
          buyValue,
          atR,
          changePct,
          todayAmt,
          todayBase,
          dayEnd,
          dayHigh: dHigh,
          dayLow: dLow,
          toStop,
          breached,
          // Decided once, here, because it was being decided twice: the row
          // printed 0 for a position that had banked past its own risk, while
          // the dial beside it went on adding that position's full openRiskAmt
          // to the rupee total. Same page, same word, two answers — the table
          // said nothing left to lose and the figure said fifty-eight thousand.
          riskFree: t.isRiskFree || !(t.openRiskAmt > 0),
          days: isFinite(t.heldDays) ? t.heldDays : NaN,
        };
      })
      .sort((a, b) => new Date(b.entry_date) - new Date(a.entry_date));
  }, [open]);

  const totals = useMemo(() => {
    const sum = (f) => rows.reduce((a, r) => a + (isFinite(f(r)) ? f(r) : 0), 0);
    // A position with nothing left to lose contributes nothing, exactly as its
    // row shows. The R figure below already worked this way; the rupee one did
    // not, which is the whole of the discrepancy.
    const openRisk = sum((r) => (r.riskFree ? 0 : r.openRiskAmt));
    /**
     * The day's move across the whole book.
     *
     * `sum` counts a non-finite contribution as zero, which is right for a
     * position that genuinely moved nothing and badly wrong here: with no
     * previous close stored anywhere — before the first price refresh, or
     * after a fetch that returned none — every row contributes zero and the
     * total reads a confident ₹0, a flat day. That is indistinguishable from
     * a real flat day and is the number somebody would act on.
     *
     * So the count of priced rows decides whether there is an answer at all.
     * None priced, no figure.
     */
    const todayN = rows.filter((r) => isFinite(r.todayAmt)).length;
    const todayBase = sum((r) => r.todayBase);
    const today = todayN ? sum((r) => r.todayAmt) : NaN;

    return {
      exposure: sum((r) => r.liveExposure),
      openRisk,
      today,
      todayN,
      // Weighted by what each position was worth at yesterday's close, so
      // this is the book's move rather than the average of its rows'.
      todayPct: todayN && todayBase > 0 ? (today / todayBase) * 100 : NaN,
      // Each position contributes what it can still lose, floored at zero: a
      // winner already banked past its risk shouldn't net off against a fresh
      // full-risk position and hide it. Same figure the per-row bars show.
      openRiskR: rows.length
        ? sum((r) => Math.max(0, isFinite(r.netRiskR) ? r.netRiskR : 0))
        : NaN,
      unrealised: sum((r) => r.unrealisedPnl),
      unrealisedR: sum((r) => r.unrealisedR),
    };
  }, [rows]);

  /**
   * How many closed trades carry an R, which is what the all-time figure is
   * an average of. This used to walk the whole realised curve tracking the
   * peak and the give-back for a ring that no longer exists — the high-water
   * mark is a dashboard question, and the dashboard already answers it.
   */
  const curve = useMemo(
    () => ({ n: closed.filter((t) => isFinite(t.r)).length }),
    [closed]
  );

  const realised = useMemo(() => {
    const thisFy = fyStartYear(new Date());
    const inFy = closed.filter((t) => {
      const d = t.exit_date || t.entry_date;
      return d && fyStartYear(new Date(d)) === thisFy;
    });
    const sumPnl = (list) => list.reduce((a, t) => a + (isFinite(t.pnl) ? t.pnl : 0), 0);
    const sumR = (list) => list.reduce((a, t) => a + (isFinite(t.r) ? t.r : 0), 0);
    return {
      fyLabel: fyLabel(new Date()),
      year: sumPnl(inFy), yearR: sumR(inFy),
      all: sumPnl(closed), allR: sumR(closed),
    };
  }, [closed]);

  /**
   * Up past 1.5R with a stop still under entry. Measured on price, not on the
   * open quantity: "this trade has run 1.5R" is a fact about where the mark
   * is, and stays true whether a third of the position is left or all of it.
   */
  const flagged = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      // Dismissed once, dismissed for good. It does not come back if the
      // trade dips under 1.5R and climbs again — the stop was moved, and
      // asking twice is what makes a reminder noise.
      if (r.breakeven_ack_at || acked.includes(r.id)) continue;
      const entry = Number(r.entry_price);
      const dir = r.side === "short" ? -1 : 1;
      const perShare = Math.abs(entry - r.stop);
      const gainR = isFinite(r.mark) && perShare > 0
        ? ((r.mark - entry) * dir) / perShare
        : NaN;
      // What comes off the dial once this position can no longer lose.
      const releasesR = Math.max(0, isFinite(r.netRiskR) ? r.netRiskR : 0);
      if (gainR >= FREE_AT_R && releasesR > 0
          && isFinite(r.stop)) {
        m.set(r.id, { id: r.id, symbol: r.symbol, entry, gainR, releasesR });
      }
    }
    return m;
  }, [rows, acked]);

  const ackBreakeven = async (c) => {
    setBusyId(c.id);
    try {
      await onAckBreakeven(c);
      // Drop it straight away. The reload that follows clears it anyway once
      // the timestamp is in, but this stops the row flickering back.
      setAcked((d) => [...d, c.id]);
    } catch {
      // Caught, not ignored: the page handler has already put the reason on
      // screen. Letting it past here only adds an unhandled rejection to the
      // console — noise in development and a false alarm once anything is
      // watching for errors in production. The flag stays lit, which is the
      // correct outcome when nothing was written.
    } finally {
      setBusyId(null);
    }
  };

  // Resolved by id, not held as an object: a price refresh or a stop moved
  // from inside the panel replaces the row, and a captured copy would go on
  // showing the figures as they were when it opened.
  const detailAt = detailId == null ? -1 : rows.findIndex((r) => r.id === detailId);

  if (!rows.length) {
    return (
      <div className="sec">
        <div className="card empty">
          <div className="eyebrow">Holdings</div>
          <p>Nothing held. Flat is a position — this fills in when something is running.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sec">
      <div className="ps-head">
        <div>
          <div className="eyebrow">Holdings</div>
          <div className="ps-sub">
            {rows.length} held · valued at the last CMP fetched, so P&amp;L moves with the market
            {flagged.size > 0 && (
              <>
                {" · "}
                <b className="ps-sub-flag">
                  <Flag size={11} />
                  {flagged.size} can go to breakeven
                </b>
              </>
            )}
          </div>
        </div>
        <button className="btn ghost sm" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw size={13} />{refreshing ? "Refreshing…" : "Refresh prices"}
        </button>
      </div>

      {/* The dial sits with the open-risk figure it describes, rather than as a
          separate band that has to be tied back to a number above it. */}
      <div className="ps-top">
        <div className="ps-riskcard">
          <RiskDial riskR={totals.openRiskR} />
          <div className="ps-riskfig">
            <div className="ps-sum-l">Open risk</div>
            <div className="ps-sum-v mono neg">{rupee(-Math.abs(totals.openRisk))}</div>
            <div className="ps-sum-s mono">
              across {rows.length} holding{rows.length === 1 ? "" : "s"}
            </div>
            <div className="ps-riskfig-note">
              {RISK_WARN_R}R is a warning line, not a limit — hold as many as you like.
            </div>
          </div>
        </div>

        {/* The give-back ring used to sit here, reading how far below your
            best you were. A worthwhile thing to know and the wrong place to
            know it: this page is about what is open right now, and a lifetime
            drawdown is neither. The ring also argued with itself — a nearly
            complete circle beside a number saying nothing much had been given
            back. The figure it described is a figure, so it sits with the
            others. */}
        <div className="ps-strip">
          {/* First in the strip, so it reads straight on from the risk dial:
              what is at stake, then what today did to it. It is the only
              figure here that changes between one visit and the next, which
              is why it sits at the front rather than in a column somebody
              has to scroll sideways to find. */}
          <Summary
            label="Today"
            value={isFinite(totals.today) ? rupee(totals.today) : "—"}
            sub={!totals.todayN
              ? "no previous close yet — hit Refresh prices"
              : `${signedPct(totals.todayPct)}${totals.todayN < rows.length
                  ? ` · ${totals.todayN} of ${rows.length} priced`
                  : ` · ${rows.length} holding${rows.length === 1 ? "" : "s"}`}`}
            hint="What the open book made or lost against the previous close, and the same as a
                  percentage of what it was worth then. As fresh as the last price fetch — before
                  the first Refresh of a session this is still the last session's move, not
                  today's. Positions with no stored close are left out of both figures rather
                  than counted as flat."
            tone={isFinite(totals.today) ? (totals.today >= 0 ? "pos" : "neg") : undefined}
          />
          {/* Ordered by how close each figure is to right now: today, then
              what is still riding on the open book, then what that book is
              worth, then the year, then all of it. Realised all-time last
              also puts the longest sub-line at the end of the row, where
              running on has nothing to push out of line. */}
          <Summary
            label="Unrealised"
            value={rupee(totals.unrealised)}
            sub={isFinite(totals.unrealisedR) ? rfmt(totals.unrealisedR) : "—"}
            hint="Money still on the table across every holding, and what it comes to in R. This
                  one IS weighted by size, so it will not match the Now at column added up —
                  that column is where each price stands, which is not a thing you can sum."

            tone={totals.unrealised >= 0 ? "pos" : "neg"}
          />
          <Summary label="Exposure" value={rupee(totals.exposure)} sub="at CMP" />
          <Summary
            label={`Realised ${realised.fyLabel}`}
            value={rupee(realised.year)}
            sub={isFinite(realised.yearR) ? rfmt(realised.yearR) : "—"}
            tone={realised.year >= 0 ? "pos" : "neg"}
          />
          <Summary
            label="Realised all-time"
            value={rupee(realised.all)}
            sub={isFinite(realised.allR)
              ? `${rfmt(realised.allR)}${curve.n > 0 ? ` · ${curve.n} trades` : ""}`
              : "—"}
            tone={realised.all >= 0 ? "pos" : "neg"}
          />
        </div>
      </div>

      <div className="card scroll ps-table">
        <table className="t ps-t">
          <thead>
            <tr>
              {/* The index is pinned with the symbol rather than left behind
                  it — on its own it would slide under and disappear. */}
              <th className="num fz">#</th>
              <th className="fz2 fz-last">Symbol</th>
              <th>Entered</th>
              <th className="num">Days</th>
              <th className="num">Open qty</th>
              <th className="num">Open %</th>
              <th className="num">Entry</th>
              <th className="num">Stop</th>
              <th className="num">SL %</th>
              <th className="num">To stop</th>
              <th className="num">Buy value</th>
              <th className="num">Open risk</th>
              <th className="num">Open risk R</th>
              <th className="num">CMP</th>
              <th className="num">Change %</th>
              <th className="num">Banked</th>
              <th className="num">Unrealised</th>
              <th className="num">Now at</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const riskFree = r.riskFree;
              // The reminder has been put down. Held here as well as in the
              // row so the flag turns hollow on the click rather than on the
              // reload that follows it.
              const ackd = !!r.breakeven_ack_at || acked.includes(r.id);
              return (
                <tr key={r.id} data-alert={r.breached ? 1 : 0}>
                  <td className="num ps-dim fz">{i + 1}</td>
                  <td className="fz2 fz-last">
                    <button className="ps-sym" onClick={() => setDetailId(r.id)}
                            title={`Open ${r.symbol}`}>
                      <b className="disp">{r.symbol}</b>
                    </button>
                    <span className="ps-dim"> {r.exchange}</span>
                    {flagged.has(r.id) && (
                      <BreakevenFlag c={flagged.get(r.id)} busy={busyId === r.id}
                                     onAck={ackBreakeven} />
                    )}
                    {/* The hollow flag: solid means act, outline means dealt
                        with. It used to appear by accident — clicking the
                        solid one wrote entry into the stop, which made the
                        position read as risk-free, which drew this. Take the
                        stop-writing away and the outline vanished with it, and
                        a two-state design quietly became one. Now it is drawn
                        for the two things that actually mean "nothing more to
                        do here", and says which. */}
                    {!flagged.has(r.id) && (ackd || riskFree) && (
                      <span className="ps-flag done"
                            title={ackd
                              ? "Breakeven reminder dismissed — you moved this stop at your broker. "
                                + "Nothing changed here: the dial still counts the stop recorded in this journal."
                              : "Risk-free — enough is banked that this position can no longer lose overall"}>
                        <Flag size={11} />
                      </span>
                    )}
                    {r.status === "partial" && <span className="ps-tag">part sold</span>}
                  </td>
                  <td className="mono ps-dim">{r.entry_date}</td>
                  <td className="num ps-dim">{isFinite(r.days) ? r.days : "—"}</td>
                  <td className="num">{r.qtyOpen}</td>
                  <td className="num">
                    {/* A bar rather than only a number: how much of the position
                        is still on is easier to scan than to read. */}
                    <div className="ps-openpct">
                      <span>{isFinite(r.openPct) ? `${r.openPct.toFixed(0)}%` : "—"}</span>
                      <i style={{ width: `${Math.min(100, Math.max(0, r.openPct || 0))}%` }} />
                    </div>
                  </td>
                  <td className="num">{Number(r.entry_price).toFixed(2)}</td>
                  <td className={`num ${r.stopAboveEntry ? "ps-locked" : ""}`}
                      title={r.stopAboveEntry ? "Stop is past entry — this position can no longer lose" : undefined}>
                    {isFinite(r.stop) ? r.stop.toFixed(2) : "—"}
                  </td>
                  <td className="num ps-dim">{isFinite(r.slPct) ? pct(r.slPct) : "—"}</td>
                  <td className="num ps-tostop"
                      data-state={r.breached ? "breached" : r.stopAboveEntry ? "locked" : "live"}
                      title={r.breached
                        ? "CMP is through the stop — this should already be out"
                        : r.stopAboveEntry
                        ? "Stop is past entry, so what's left can only be given back, not lost"
                        : undefined}>
                    {!isFinite(r.toStop) ? "—"
                      : r.breached ? "breached"
                      : r.stopAboveEntry ? `locked ${pct(Math.abs(r.toStop))}`
                      : pct(Math.abs(r.toStop))}
                  </td>
                  <td className="num" title="What the shares still held cost — entry price × open quantity">
                    {rupee(r.buyValue)}</td>
                  <td className={`num ${riskFree ? "ps-dim" : "neg"}`}>
                    {riskFree ? "0" : rupee(-Math.abs(r.openRiskAmt))}
                  </td>
                  <td className="num">
                    <div className="ps-riskbar" data-free={riskFree ? 1 : 0}>
                      <span className="mono">
                        {riskFree ? "0.00R" : `−${Math.abs(r.netRiskR ?? 0).toFixed(2)}R`}
                      </span>
                      <i style={{
                        width: `${Math.min(100, (Math.abs(r.netRiskR || 0) / RISK_WARN_R) * 100)}%`,
                      }} />
                    </div>
                  </td>
                  {/* The mark, and — only when it is near an end of the day's
                      range — where in that day it landed. Under the price
                      rather than beside the symbol, because it is a fact
                      about this number and the association should not need
                      explaining. Lowercase like `breached` in the To stop
                      column, which is the same kind of remark. */}
                  <td className="num">
                    {isFinite(r.mark) ? Number(r.mark).toFixed(2) : "—"}
                    {r.dayEnd && (
                      <span className={`hd-dayend ${r.dayEnd === "high" ? "pos" : "neg"}`}
                            title={`Today's range ${Number(r.dayLow).toFixed(2)}–`
                              + `${Number(r.dayHigh).toFixed(2)}. `
                              + (r.dayEnd === "high"
                                ? "Price is in the top fifth of it — demand held into the close."
                                : "Price is in the bottom fifth of it — the day's gain was given back.")
                              + " As fresh as the last price fetch, so before the first Refresh"
                              + " of a session this describes the previous one."}>
                        {r.dayEnd === "high" ? "at high" : "at low"}
                      </span>
                    )}
                  </td>
                  <td className={`num ${r.changePct >= 0 ? "pos" : "neg"}`}>
                    {isFinite(r.changePct) ? signedPct(r.changePct) : "—"}
                  </td>
                  <td className={`num ${r.realisedPnl >= 0 ? "pos" : "neg"}`}>
                    {isFinite(r.realisedPnl) && r.qtyExited > 0 ? rupee(r.realisedPnl) : <span className="ps-dim">—</span>}
                  </td>
                  <td className={`num ${r.unrealisedPnl >= 0 ? "pos" : "neg"}`} style={{ fontWeight: 500 }}>
                    {isFinite(r.unrealisedPnl) ? rupee(r.unrealisedPnl) : "—"}
                  </td>
                  <td className={`num ${r.atR >= 0 ? "pos" : "neg"}`}
                      title={"Where price stands against this trade's 1R. It does not change when "
                        + "you sell part of the position — sell a third at 6R and this still reads "
                        + "6R, then follows the price from there. The rupee column beside it is "
                        + "what the shares you still hold are worth."}>
                    {isFinite(r.atR) ? rfmt(r.atR) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detailAt >= 0 && (
        <PositionDetail
          row={rows[detailAt]}
          // The same panel the trades table opens, so a live position gets the
          // charts and the attach field without a second implementation. This
          // is arguably where it matters most: an open position is the one you
          // keep coming back to, and "does this still look like the base I
          // bought" is only answerable with the picture from entry beside it.
          diary={diary}
          onAttachChart={onAttachChart}
          onRemoveChart={onRemoveChart}
          onClose={() => setDetailId(null)}
          onEdit={(r) => { setDetailId(null); onEditTrade?.(r); }}
          onExit={(r) => { setDetailId(null); onExitTrade?.(r); }}
          onDelete={async (r) => { setDetailId(null); await onDeleteTrade?.(r.id); }}
          // Step through the list without going back to it. Undefined rather
          // than a no-op at the ends, so the arrows can show they're spent.
          onPrev={detailAt > 0 ? () => setDetailId(rows[detailAt - 1].id) : undefined}
          onNext={detailAt < rows.length - 1 ? () => setDetailId(rows[detailAt + 1].id) : undefined}
        />
      )}

      <div className="ps-foot">
        Buy value is what the shares still held cost, so it falls as a position is sold down.
        Now at is where price stands against that trade's 1R — it holds still when you sell part
        of a position, so a trade at a new high never reads as one that gave it back.
        Open risk is what the current stop still exposes, so a stop moved past entry reads zero.
        The {RISK_WARN_R}R dial is there to be read, not obeyed: there&apos;s no cap on how many
        holdings you can carry at once, and nothing is blocked past the line.
        A solid flag means the trade is up past {FREE_AT_R}R and its stop could go to breakeven at
        your broker. Move it there, then click it to put the reminder down: the flag turns hollow
        and that position stops counting towards open risk, because a stop at entry cannot lose.
        Your recorded stop is untouched, so 1R and every R measured against it stay exactly as
        they are.
      </div>

      <style jsx>{`
        /* Under the price, quiet enough that a row without one does not look
           like it is missing something. It fires on about a fifth of rows, so
           it has to read as a remark rather than as a column that happens to
           be blank. */
        .hd-dayend {
          display: block; font-size: 10px; margin-top: 1px;
          letter-spacing: 0.01em; font-weight: 500; opacity: 0.9;
        }
        .ps-head {
          display: flex; align-items: flex-end; justify-content: space-between;
          gap: 14px; flex-wrap: wrap; margin-bottom: 12px;
        }
        .ps-sub { font-size: 12px; color: var(--ink2); margin-top: 3px; }
        /* One card and the strip. It was 290px 290px 1fr when there were two
           dials; taking one away left the strip in a 290px slot with the third
           column empty beside it, which truncated every figure to "₹9.3…". */
        .ps-top {
          display: grid; grid-template-columns: 290px 1fr;
          gap: 12px; margin-bottom: 12px; align-items: stretch;
        }
        .ps-riskcard {
          display: flex; align-items: center; gap: 16px;
          border: 1px solid var(--rule); border-radius: 3px;
          background: var(--card); padding: 14px 16px;
        }
        .ps-riskfig { min-width: 0; }
        .ps-riskfig-note {
          font-size: 10.5px; color: var(--ink3); margin-top: 8px;
          line-height: 1.45; text-wrap: pretty;
        }
        .ps-strip {
          display: grid; grid-template-columns: repeat(5, 1fr);
          border: 1px solid var(--rule); border-radius: 3px;
          background: var(--card); overflow: hidden;
        }
        /* Below this the strip cannot hold five figures beside a 290px card
           without clipping them, so it takes its own full-width row. Raised
           from 1100px when Today made it five: the same wrap happens sooner
           with one more column to fit. */
        @media (max-width: 1320px) {
          .ps-top { grid-template-columns: 1fr; }
        }
        /* Three and two rather than five, because five 1fr columns in a phone
           width give each figure about 70px and ₹17.16 L does not fit in it.
           The odd one sits alone on the second row, which is untidy but
           legible — the alternative is an ellipsis in the middle of a number. */
        @media (max-width: 900px) {
          .ps-strip { grid-template-columns: repeat(3, 1fr); }
        }
        @media (max-width: 720px) {
          .ps-strip { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 520px) {
          .ps-riskcard { flex-direction: column; align-items: flex-start; }
          .ps-strip { grid-template-columns: 1fr; }
        }
        .ps-table { max-height: 62vh; }
        /* Set in columns rather than capped at a width.
           The 720px cap was there for a real reason — a 200-character line of
           11px grey is not read, it is skipped — but on a wide screen it left
           a third of the card empty and looked like a mistake. Columns keep
           the measure readable AND use the box: two of them at ~85 characters
           each, which is what the cap was protecting in the first place. */
        .ps-foot {
          font-size: 11px; color: var(--ink3); margin-top: 9px;
          line-height: 1.6; text-wrap: pretty;
          columns: 2; column-gap: 30px;
        }
        /* Below this a single column is already about the right measure, and
           two would be too narrow to read. */
        @media (max-width: 900px) {
          .ps-foot { columns: 1; }
        }
      `}</style>

      {/* Global, not scoped: styled-jsx only reaches elements rendered by the
          component that declares the block, and Summary / RiskDial /
          BreakevenFlag are their own functions — a scoped rule never
          touches them. */}
      <style jsx global>{`
        /* Two dials, two hue families, so a glance tells them apart. Open risk
           runs a heat scale — it is a warning. Give-back holds in indigo, a
           colour that means nothing else here, and spends only gold and
           crimson on the part that has actually been handed back. */
        .ps-dial {
          flex: 0 0 auto;
          --d-track: #E4E9E7;
          --d-calm:  #0F8A6E;
          --d-warm:  #D9A125;
          --d-hot:   #C6402B;
        }
        .ps-dial-ring { position: relative; width: 118px; height: 118px; }
        .ps-dial-ring svg { width: 100%; height: 100%; display: block; }
        .ps-dial-track { stroke: var(--d-track); }
        .ps-dial-mark { stroke: var(--card); stroke-width: 2.5; }
        .ps-dial-arc {
          stroke: var(--d-calm);
          transition: stroke-dasharray 0.4s ease, stroke 0.3s ease;
        }
        .ps-dial[data-level="warm"] .ps-dial-arc { stroke: var(--d-warm); }
        .ps-dial[data-level="hot"]  .ps-dial-arc { stroke: var(--d-hot); }

        /* Give-back ring: what's held, then what's been handed back. */
        .ps-dial-mid {
          position: absolute; inset: 0; display: flex;
          flex-direction: column; align-items: center; justify-content: center;
          gap: 1px; pointer-events: none;
        }
        .ps-dial-v {
          font-size: 21px; font-weight: 600; line-height: 1;
          font-variant-numeric: tabular-nums; color: var(--d-calm);
        }
        .ps-dial-v i { font-style: normal; font-size: 13px; margin-left: 1px; }
        .ps-dial[data-level="warm"] .ps-dial-v { color: var(--d-warm); }
        .ps-dial[data-level="hot"]  .ps-dial-v { color: var(--d-hot); }
        .ps-dial-s { font-size: 10px; color: var(--ink3); }
        .ps-dial-note {
          font-size: 10px; color: var(--ink3); text-align: center;
          margin-top: 7px; max-width: 118px; line-height: 1.45; text-wrap: pretty;
        }
        .ps-dial[data-level="hot"] .ps-dial-note { color: var(--d-hot); }

        /* Small on purpose — a note beside the symbol, not an alarm. The
           actionable one is filled and nudges on hover; the settled one is a
           quiet outline that just says this position can't lose any more. */
        .ps-flag {
          display: inline-flex; align-items: center; justify-content: center;
          vertical-align: middle; margin-left: 6px; padding: 2px;
          background: none; border: 0; line-height: 0; cursor: pointer;
          color: var(--long); transition: transform 0.12s ease, opacity 0.12s ease;
        }
        .ps-flag svg { fill: currentColor; }
        .ps-flag:hover:not(:disabled) { transform: translateY(-1px) scale(1.15); }
        .ps-flag:disabled { opacity: 0.4; cursor: default; }
        .ps-flag.done {
          cursor: default; opacity: 0.5; padding: 0;
        }
        .ps-flag.done svg { fill: none; }
        .ps-sub-flag {
          display: inline-flex; align-items: center; gap: 4px;
          color: var(--long); font-weight: 600;
        }
        .ps-sub-flag svg { fill: currentColor; }

        /* Tightened when the strip went from four figures to five. The value
           gives up 2px rather than the padding giving up more: shrinking the
           gutters instead would run the numbers into the dividing rules and
           make the row look denser than it reads. */
        .ps-sum { padding: 11px 13px; border-right: 1px solid var(--rule); min-width: 0; }
        .ps-sum:last-child { border-right: 0; }
        .ps-sum-l {
          font-size: 9px; font-weight: 600; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--ink3);
        }
        .ps-sum-v {
          font-size: 17px; font-weight: 500; margin-top: 4px;
          font-variant-numeric: tabular-nums; white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis;
        }
        .ps-sum-v.pos { color: var(--long); }
        .ps-sum-v.neg { color: var(--short); }
        .ps-sum-s { font-size: 11px; color: var(--ink3); margin-top: 3px; }
        /* Reads as text until you go near it — the row is a table row, not a
           list of links, and underlining every symbol would say otherwise. */
        .ps-sym {
          background: none; border: 0; padding: 0; cursor: pointer;
          font: inherit; color: inherit; text-align: left;
          border-bottom: 1px solid transparent;
        }
        .ps-sym:hover { border-bottom-color: var(--brass); }
        .ps-dim { color: var(--ink3); font-size: 11.5px; }
        .ps-locked { color: var(--brass); font-weight: 600; }
        .ps-tag {
          font-size: 8.5px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--brass);
          border: 1px solid var(--brass); border-radius: 2px;
          padding: 1px 4px; margin-left: 6px;
        }
        .ps-openpct, .ps-riskbar { position: relative; display: block; min-width: 58px; }
        .ps-openpct > i, .ps-riskbar > i {
          display: block; height: 3px; margin-top: 3px; border-radius: 1px;
        }
        .ps-openpct > i { background: var(--ink3); opacity: 0.55; }
        .ps-riskbar > i { background: var(--short); opacity: 0.7; }
        .ps-riskbar[data-free="1"] > i { background: var(--long); opacity: 0.5; }
        .ps-riskbar[data-free="1"] span { color: var(--ink3); }
        /* The index column is pinned, so its width has to be a known number
           for the symbol beside it to know where to sit. Fixing it also stops
           the column twitching between one digit and two. */
        .ps-t { --fz-1: 46px; }
        .ps-t th.fz, .ps-t td.fz { width: 46px; min-width: 46px; max-width: 46px; }

        /* Matches the dashboard's open positions, where data-alert has always
           meant breached. It read as stop-above-entry here — the opposite kind
           of news — against a rule that only restated .ps-locked's own colour.
           Qualified past the table.t tbody tr rule, which now sets the row
           background the pinned cells inherit and would otherwise win. */
        table.t tbody tr[data-alert="1"] { background: #FDF3F0; }
        .ps-tostop[data-state="breached"] { color: var(--short); font-weight: 600; }
        .ps-tostop[data-state="locked"] { color: var(--brass); font-weight: 600; }
      `}</style>
    </div>
  );
}
