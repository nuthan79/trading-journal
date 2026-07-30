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

/** Weekdays between two dates. Exchange holidays aren't known here, so this
 *  slightly overstates — it's a sense of pace, not a settlement calculation. */
function tradingDays(from, to) {
  const a = new Date(from), b = new Date(to);
  if (!isFinite(a) || !isFinite(b)) return NaN;
  let n = 0;
  const d = new Date(a);
  while (d <= b) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) n++;
    d.setDate(d.getDate() + 1);
  }
  return Math.max(0, n - 1);
}

function Summary({ label, value, sub, tone }) {
  return (
    <div className="ps-sum">
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
 * How far the realised R curve sits below its own best.
 *
 * The ring is the high-water mark: green to where you stand, coloured from
 * there to the peak for what's been handed back. At a new high it's all green.
 *
 * The give-back is the centre number rather than the total, because the ring's
 * proportions stop carrying it — 12R off a 127R peak is a tenth of the circle
 * and easy to read, 12R off 400R is a sliver. The figure that matters has to
 * stay the same size whatever the account has grown to.
 *
 * Amber while the give-back is inside the worst there's been, red once it goes
 * past it: at that point the colour is saying this is the deepest hole yet,
 * which is the moment worth noticing.
 */
function GiveBackDial({ curve }) {
  const { current, peak, giveBack, worstDD, n } = curve;
  const framed = n > 0 && peak > 0;
  const held = framed ? Math.max(0, Math.min(1, current / peak)) : 0;
  const green = held * DIAL_C;

  const level = !n ? "none"
    : giveBack <= 1e-9 ? "high"
    : giveBack >= worstDD - 1e-9 ? "deep" : "off";

  return (
    <div className="ps-dial" data-level={level} data-kind="giveback">
      <div className="ps-dial-ring">
        <svg viewBox="0 0 140 140" role="img"
             aria-label={n
               ? `${giveBack.toFixed(2)}R below a peak of ${peak.toFixed(2)}R`
               : "No realised R yet"}>
          <g transform="rotate(-90 70 70)">
            <circle className="ps-dial-track" cx="70" cy="70" r={DIAL_R}
                    fill="none" strokeWidth={DIAL_SW} />
            {/* Given back — drawn first, so the green sits over its start */}
            <circle className="ps-gb-lost" cx="70" cy="70" r={DIAL_R}
                    fill="none" strokeWidth={DIAL_SW}
                    strokeDasharray={`${DIAL_C - green} ${green}`}
                    strokeDashoffset={-green} />
            <circle className="ps-gb-held" cx="70" cy="70" r={DIAL_R}
                    fill="none" strokeWidth={DIAL_SW}
                    strokeDasharray={`${green} ${DIAL_C - green}`} />
          </g>
        </svg>
        <div className="ps-dial-mid">
          <span className="ps-dial-v mono">
            {!n ? "—" : giveBack <= 1e-9 ? "0.0" : `−${giveBack.toFixed(1)}`}
            {n > 0 && <i>R</i>}
          </span>
          <span className="ps-dial-s mono">
            {!n ? "no R yet"
              : framed ? `${current.toFixed(1)} of ${peak.toFixed(1)}R`
              : "never above the start"}
          </span>
        </div>
      </div>
      <div className="ps-dial-note">
        {!n ? "Fill in some stops and this fills in."
          : level === "high" ? "At a new high."
          : level === "deep" ? "The deepest you have been."
          : `Worst has been ${worstDD.toFixed(1)}R.`}
      </div>
    </div>
  );
}

/**
 * The flag beside a symbol: this trade has run far enough that its stop can go
 * to breakeven.
 *
 * It's a notice, not an instruction the app carries out — the stop that matters
 * lives at the broker. Clicking records that you've moved it, which is what
 * lets the dial stop counting this position's risk.
 *
 * Deliberately the same click for both. Releasing R on the noticing alone would
 * let the dial read zero while a wide stop was still genuinely exposed, and the
 * dial is the one number on this page that can't be allowed to flatter you.
 */
function BreakevenFlag({ c, busy, onMark }) {
  return (
    <button
      className="ps-flag"
      disabled={busy}
      onClick={() => onMark(c)}
      aria-label={`${c.symbol} can go to breakeven`}
      title={
        `${c.symbol} is up ${c.gainR.toFixed(2)}R.\n\n` +
        `Move its stop to ${c.entry.toFixed(2)} at your broker, then click this ` +
        `to record it here — that takes ${c.releasesR.toFixed(2)}R off the open-risk dial.\n\n` +
        `Nothing else changes: 1R stays ${isFinite(c.initialStop) ? c.initialStop.toFixed(2) : "—"}, ` +
        `so P&L and every R already recorded stay exactly as they are.`
      }
    >
      <Flag size={11} />
    </button>
  );
}

export default function Holdings({
  open, closed, onRefresh, refreshing, onMarkRiskFree, onEditTrade, onExitTrade, onDeleteTrade,
}) {
  const [marked, setMarked] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [detailId, setDetailId] = useState(null);

  const rows = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return open
      .map((t) => {
        const qtyOpen = isFinite(t.qtyOpen) ? t.qtyOpen : Number(t.quantity);
        const openPct = Number(t.quantity) > 0 ? (qtyOpen / Number(t.quantity)) * 100 : NaN;
        const liveExposure = isFinite(t.mark) ? t.mark * qtyOpen : Number(t.entry_price) * qtyOpen;
        const changePct = isFinite(t.mark) && Number(t.entry_price) > 0
          ? ((t.mark - Number(t.entry_price)) / Number(t.entry_price)) * 100 * (t.side === "short" ? -1 : 1)
          : NaN;
        // How far CMP has to fall before the stop is hit, as a share of CMP —
        // the same reading the dashboard's open positions give. Breached means
        // price is already through it and the position is running on borrowed
        // time; for a short that's price rising into the stop instead.
        const stop = t.currentStop;
        const canRead = isFinite(t.mark) && isFinite(stop);
        const toStop = canRead ? ((t.mark - stop) / t.mark) * 100 : NaN;
        const breached = canRead && (t.side === "short" ? t.mark >= stop : t.mark <= stop);

        return {
          ...t,
          qtyOpen,
          openPct,
          liveExposure,
          changePct,
          toStop,
          breached,
          days: isFinite(t.heldDays) ? t.heldDays : NaN,
          tdays: tradingDays(t.entry_date, today),
        };
      })
      .sort((a, b) => new Date(b.entry_date) - new Date(a.entry_date));
  }, [open]);

  const totals = useMemo(() => {
    const sum = (f) => rows.reduce((a, r) => a + (isFinite(f(r)) ? f(r) : 0), 0);
    const openRisk = sum((r) => r.openRiskAmt);
    return {
      exposure: sum((r) => r.liveExposure),
      openRisk,
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
   * The realised R curve, walked in exit order — the order the money actually
   * landed, which is what a high-water mark is about. Same shape as calc.js's
   * maxDD (peak starts at 0, before any trade), so the worst-ever figure here
   * is the one the dashboard reports.
   */
  const curve = useMemo(() => {
    let cum = 0, peak = 0, worstDD = 0, n = 0;
    for (const t of closed) {
      if (!isFinite(t.r)) continue;
      n++;
      cum += t.r;
      peak = Math.max(peak, cum);
      worstDD = Math.max(worstDD, peak - cum);
    }
    return { current: cum, peak, giveBack: Math.max(0, peak - cum), worstDD, n };
  }, [closed]);

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
    if (!onMarkRiskFree) return m;
    for (const r of rows) {
      if (marked.includes(r.id)) continue;
      const entry = Number(r.entry_price);
      const dir = r.side === "short" ? -1 : 1;
      const perShare = Math.abs(entry - r.initialStop);
      const gainR = isFinite(r.mark) && perShare > 0
        ? ((r.mark - entry) * dir) / perShare
        : NaN;
      // What comes off the dial once this position can no longer lose.
      const releasesR = Math.max(0, isFinite(r.netRiskR) ? r.netRiskR : 0);
      if (gainR >= FREE_AT_R && releasesR > 0
          && isFinite(r.currentStop) && isFinite(r.initialStop)) {
        m.set(r.id, {
          id: r.id, symbol: r.symbol, entry, gainR, releasesR,
          // Sent back on save so the 1R shown here is the 1R that gets pinned.
          initialStop: r.initialStop,
        });
      }
    }
    return m;
  }, [rows, marked, onMarkRiskFree]);

  const markRiskFree = async (c) => {
    setBusyId(c.id);
    try {
      await onMarkRiskFree(c);
      // Drop the flag straight away. The reload that follows clears it anyway
      // once the new stop is in, but this keeps the row from flickering back.
      setMarked((d) => [...d, c.id]);
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

        {/* Same pairing as open risk: the ring beside the figure it describes.
            Realised all-time has left the strip because this is that number. */}
        <div className="ps-riskcard">
          <GiveBackDial curve={curve} />
          <div className="ps-riskfig">
            <div className="ps-sum-l">Realised all-time</div>
            <div className={`ps-sum-v mono ${realised.all >= 0 ? "pos" : "neg"}`}>
              {rupee(realised.all)}
            </div>
            <div className="ps-sum-s mono">
              {isFinite(realised.allR) ? rfmt(realised.allR) : "—"}
              {curve.n > 0 && ` over ${curve.n} trade${curve.n === 1 ? "" : "s"}`}
            </div>
            <div className="ps-riskfig-note">
              The ring reads against your own best, not a target.
            </div>
          </div>
        </div>

        <div className="ps-strip">
          <Summary label="Exposure" value={rupee(totals.exposure)} sub="at CMP" />
          <Summary
            label="Unrealised"
            value={rupee(totals.unrealised)}
            sub={isFinite(totals.unrealisedR) ? rfmt(totals.unrealisedR) : "—"}
            tone={totals.unrealised >= 0 ? "pos" : "neg"}
          />
          <Summary
            label={`Realised ${realised.fyLabel}`}
            value={rupee(realised.year)}
            sub={isFinite(realised.yearR) ? rfmt(realised.yearR) : "—"}
            tone={realised.year >= 0 ? "pos" : "neg"}
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
              <th className="num">Trading</th>
              <th className="num">Open qty</th>
              <th className="num">Open %</th>
              <th className="num">Entry</th>
              <th className="num">Initial SL</th>
              <th className="num">SL %</th>
              <th className="num">Current SL</th>
              <th className="num">To stop</th>
              <th className="num">Exposure</th>
              <th className="num">Open risk</th>
              <th className="num">Open risk R</th>
              <th className="num">CMP</th>
              <th className="num">Change %</th>
              <th className="num">Banked</th>
              <th className="num">Unrealised</th>
              <th className="num">Unreal. R</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const riskFree = r.isRiskFree || !(r.openRiskAmt > 0);
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
                                     onMark={markRiskFree} />
                    )}
                    {riskFree && (
                      <span className="ps-flag done" title="Risk-free — the stop is at or past entry, so this position has nothing left to lose">
                        <Flag size={11} />
                      </span>
                    )}
                    {r.status === "partial" && <span className="ps-tag">part sold</span>}
                  </td>
                  <td className="mono ps-dim">{r.entry_date}</td>
                  <td className="num ps-dim">{isFinite(r.days) ? r.days : "—"}</td>
                  <td className="num ps-dim">{isFinite(r.tdays) ? r.tdays : "—"}</td>
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
                  <td className="num ps-dim">
                    {isFinite(r.initialStop) ? r.initialStop.toFixed(2) : "—"}
                  </td>
                  <td className="num ps-dim">{isFinite(r.slPct) ? pct(r.slPct) : "—"}</td>
                  <td className={`num ${r.stopAboveEntry ? "ps-locked" : ""}`}
                      title={r.stopAboveEntry ? "Stop is past entry — this position can no longer lose" : undefined}>
                    {isFinite(r.currentStop) ? r.currentStop.toFixed(2) : "—"}
                  </td>
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
                  <td className="num">{rupee(r.liveExposure)}</td>
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
                  <td className="num">{isFinite(r.mark) ? Number(r.mark).toFixed(2) : "—"}</td>
                  <td className={`num ${r.changePct >= 0 ? "pos" : "neg"}`}>
                    {isFinite(r.changePct) ? signedPct(r.changePct) : "—"}
                  </td>
                  <td className={`num ${r.realisedPnl >= 0 ? "pos" : "neg"}`}>
                    {isFinite(r.realisedPnl) && r.qtyExited > 0 ? rupee(r.realisedPnl) : <span className="ps-dim">—</span>}
                  </td>
                  <td className={`num ${r.unrealisedPnl >= 0 ? "pos" : "neg"}`} style={{ fontWeight: 500 }}>
                    {isFinite(r.unrealisedPnl) ? rupee(r.unrealisedPnl) : "—"}
                  </td>
                  <td className={`num ${r.unrealisedR >= 0 ? "pos" : "neg"}`}>
                    {isFinite(r.unrealisedR) ? rfmt(r.unrealisedR) : "—"}
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
        Trading days count weekdays only — exchange holidays aren&apos;t known here.
        Open risk is what the current stop still exposes, so a stop moved past entry reads zero.
        The {RISK_WARN_R}R dial is there to be read, not obeyed: there&apos;s no cap on how many
        holdings you can carry at once, and nothing is blocked past the line.
        A flag means the trade is up past {FREE_AT_R}R and its stop could go to breakeven — move it
        at your broker first, then click the flag to record it here and take that risk off the dial.
      </div>

      <style jsx>{`
        .ps-head {
          display: flex; align-items: flex-end; justify-content: space-between;
          gap: 14px; flex-wrap: wrap; margin-bottom: 12px;
        }
        .ps-sub { font-size: 12px; color: var(--ink2); margin-top: 3px; }
        .ps-top {
          display: grid; grid-template-columns: 290px 290px 1fr;
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
          display: grid; grid-template-columns: repeat(3, 1fr);
          border: 1px solid var(--rule); border-radius: 3px;
          background: var(--card); overflow: hidden;
        }
        /* Two dials then the strip; the dials pair up before the strip drops
           under them, so neither ring ends up alone on a row. */
        @media (max-width: 1240px) {
          .ps-top { grid-template-columns: 1fr 1fr; }
          .ps-strip { grid-column: 1 / -1; }
        }
        @media (max-width: 720px) {
          .ps-top { grid-template-columns: 1fr; }
          .ps-strip { grid-template-columns: repeat(3, 1fr); }
        }
        @media (max-width: 520px) {
          .ps-riskcard { flex-direction: column; align-items: flex-start; }
          .ps-strip { grid-template-columns: repeat(2, 1fr); }
        }
        .ps-table { max-height: 62vh; }
        .ps-foot {
          font-size: 11px; color: var(--ink3); margin-top: 9px;
          line-height: 1.6; max-width: 720px; text-wrap: pretty;
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
          --d-held:  #3F5E8C;
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
        .ps-gb-held { stroke: var(--d-held); transition: stroke-dasharray 0.4s ease; }
        .ps-gb-lost {
          stroke: var(--d-warm);
          transition: stroke-dasharray 0.4s ease, stroke 0.3s ease;
        }
        .ps-dial[data-level="deep"] .ps-gb-lost { stroke: var(--d-hot); }
        .ps-dial[data-level="high"] .ps-gb-lost { stroke: none; }
        .ps-dial[data-level="none"] .ps-gb-held,
        .ps-dial[data-level="none"] .ps-gb-lost { stroke: none; }
        .ps-dial[data-kind="giveback"] .ps-dial-v { color: var(--d-warm); }
        .ps-dial[data-kind="giveback"][data-level="high"] .ps-dial-v { color: var(--d-held); }
        .ps-dial[data-kind="giveback"][data-level="deep"] .ps-dial-v { color: var(--d-hot); }
        .ps-dial[data-kind="giveback"][data-level="none"] .ps-dial-v { color: var(--ink3); }
        .ps-dial[data-kind="giveback"][data-level="deep"] .ps-dial-note { color: var(--d-hot); }
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

        .ps-sum { padding: 12px 15px; border-right: 1px solid var(--rule); min-width: 0; }
        .ps-sum:last-child { border-right: 0; }
        .ps-sum-l {
          font-size: 9px; font-weight: 600; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--ink3);
        }
        .ps-sum-v {
          font-size: 19px; font-weight: 500; margin-top: 5px;
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
