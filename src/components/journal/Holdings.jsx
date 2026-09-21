"use client";

import { Fragment, useMemo, useState } from "react";
import { RefreshCw, Flag, Rocket, CornerDownRight, Download, ChevronRight } from "lucide-react";
import { money, rfmt, pct, signedPct, moneyParts, currencySign, exportFilename,
         monthShort, dmy } from "@/lib/format";
import { COLUMN_HINTS } from "@/lib/columns";
import { hasMtf, activeRegion } from "@/lib/regions";
import { useColumnPrefs } from "@/lib/useColumnPrefs";
import Qty from "@/components/Qty";
import { qty } from "@/lib/format";
import ColumnPicker from "./ColumnPicker";
import Money from "@/components/Money";
import { downloadCsv } from "@/lib/csv";
import { SHOW_HOLDINGS_CSV } from "@/lib/flags";
import { fyStartYear, fyLabel } from "@/lib/calc";
import { bankedEvents } from "@/lib/positions";
/* The same thresholds the measurement used, so a badge here and a finding on
   Review can never describe the same trade with two different numbers. */
import { FREE_AT_R, POWER_R, POWER_DAYS, breakevenPrompt } from "@/lib/path";
import PositionDetail from "./PositionDetail";
import { soldSinceSnapshot } from "@/lib/snapshots";

/**
 * The columns of the holdings table, in the order the table shows them, plus
 * the two facts the table encodes as styling rather than as text.
 *
 * Readable headers rather than field names, which the trades export cannot
 * have — that file has always written raw keys and somebody may be keying a
 * spreadsheet on them. A new export has no such history to keep.
 *
 * `stop_source` and `unknown_risk` are here because on screen they are a tint
 * and a word: a stop the importer invented is labelled ASSUMED under the
 * number, and a position with no stop at all is what the risk column refuses
 * to call zero. Exported without them, an assumed stop becomes an ordinary
 * one and the distinction the whole app is built around dies in the download.
 */
const HOLDING_COLS = [
  { key: "symbol", header: "symbol" },
  { key: "exchange", header: "exchange" },
  { key: "entry_date", header: "entered" },
  { key: "days", header: "days_held" },
  { key: "qtyOpen", header: "open_qty" },
  { key: "openPct", header: "open_pct" },
  { key: "entry_price", header: "entry" },
  { key: "stop", header: "stop" },
  { key: "stop_source", header: "stop_source" },
  { key: "unknownRisk", header: "no_stop_on_record" },
  { key: "slPct", header: "sl_pct" },
  { key: "toStop", header: "to_stop_pct" },
  { key: "buyValue", header: "buy_value" },
  { key: "liveExposure", header: "exposure_at_cmp" },
  { key: "openRiskAmt", header: "open_risk" },
  { key: "netRiskR", header: "open_risk_r" },
  { key: "mark", header: "cmp" },
  { key: "changePct", header: "change_pct" },
  { key: "realisedPnl", header: "banked" },
  { key: "unrealisedPnl", header: "unrealised" },
  { key: "atR", header: "now_at_r" },
  { key: "margin", header: "mtf_cost_so_far" },
  { key: "charges", header: "charges_so_far" },
  { key: "broker", header: "broker" },
];

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
// Imported from path.js above rather than declared here: this screen's flag and
// the measurement that fills `became_free_on` have to agree about where "risk
// free" starts, and two copies of the number is how they would stop agreeing.


/**
 * Written out to the rupee. Used by Today, and deliberately by nothing else.
 *
 * The whole strip was tried this way and put back. Read together, five figures
 * in full turn a summary into a ledger — the tiers are what let the eye take
 * the row in at a glance, and losing them cost more than the precision was
 * worth.
 *
 * Today is the exception because of what it IS. It is the only figure here
 * that changes between one visit and the next, and the only one somebody
 * checks against what their broker app is showing them this morning. "−₹10.9k"
 * cannot be checked against anything. The other four are aggregates nobody
 * reconciles to the money, and "₹10.92 L" is the faster read for those.
 *
 * The paise are set smaller and dimmer. At this length one uniform size makes
 * the eye stop on the wrong group of digits; the rupees are what is being read
 * and the decimals only need to be there, not to compete.
 */
/* NOT the shared <Money>, which shows a compact figure and hides the digits in
   a hover. This is the opposite: every digit on the page, no hover at all,
   for the one tile that exists to be reconciled. */
function ToTheRupee({ v }) {
  const p = moneyParts(v);
  if (!p) return "—";
  return (
    /* The sign of the book being read, not a rupee — this is the one figure
       here that writes its own, because it is split into parts so the paise
       can be set smaller. In a US book it was printing ₹ over dollars. */
    <>{p.sign}{currencySign()}{p.int}<span className="ps-dec">.{p.dec}</span></>
  );
}

/**
 * `foot` is a second figure below a hairline, for the one tile that carries
 * two readings of the same thing.
 *
 * It sits at the BOTTOM of the tile rather than under the sub-line, because
 * the strip is a grid and every cell is already as tall as the tallest. Placed
 * directly under the text it would push that tile down and leave the other
 * five with a ragged gap at the base; pinned to the bottom, the rule lands on
 * the same baseline the tile already ends on and the row stays level.
 */
function Summary({ label, value, sub, tone, hint, foot, footLabel }) {
  return (
    <div className="ps-sum" title={hint || undefined}>
      <div className="ps-sum-l">{label}</div>
      <div className={`ps-sum-v mono ${tone || ""}`}>{value}</div>
      {sub != null && <div className="ps-sum-s mono">{sub}</div>}
      {foot != null && (
        <div className="ps-sum-foot">
          <span className="ps-sum-foot-v mono">{foot}</span>
          <span className="ps-sum-foot-l">{footLabel}</span>
        </div>
      )}
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

/**
 * `measured` is how many holdings actually contributed to `riskR`.
 *
 * Zero of them means the ring is drawn over nothing, and every word underneath
 * would be a claim about a book the journal cannot see — "Room to the 5R line"
 * over ten stopless positions is an all-clear derived from an absence.
 */
function RiskDial({ riskR, measured = null }) {
  const blind = measured === 0;
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
    <div className="ps-dial" data-level={level}
         title={blind ? undefined
           : (level === "hot"
             ? past
               ? `Past the ${RISK_WARN_R}R line — more is riding on this than usual.`
               : `Right on the ${RISK_WARN_R}R line.`
             : level === "warm"
             ? `Inside the ${RISK_WARN_R}R line, but filling up.`
             : `Room to the ${RISK_WARN_R}R line.`)
             + ` ${RISK_WARN_R}R is a warning line, not a limit — hold as many as you like.`}>
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
          {/* A dash rather than 0.00R when nothing was measurable. The figure
              is the most confident thing on the page and it should not be
              confident about a book with no stops in it. */}
          <span className="ps-dial-v mono">
            {blind ? "—" : <>{magnitude.toFixed(2)}<i>R</i></>}
          </span>
          <span className="ps-dial-s mono">of {RISK_WARN_R}R</span>
        </div>
      </div>
      {/* Keyed off the same level the colour uses. Testing `past` on its own
          left exactly 5.00R — five untrailed positions, which is not a rare
          place to be — showing a red ring over the words "room to the line". */}
      {/* Only the case the ring cannot show. Where it stands against the line
          — room, filling up, past it — is what the ring and its colour already
          say, so those words moved to the hover. */}
      {blind && <div className="ps-dial-note">Nothing to measure yet — no stops recorded.</div>}
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
      aria-label={c.faded
        ? `${c.symbol} reached ${FREE_AT_R}R and is now up ${c.gainR.toFixed(2)}R — dismiss the breakeven reminder`
        : `${c.symbol} is up ${c.gainR.toFixed(2)}R — dismiss the breakeven reminder`}
      /* The wording follows the fact. Once the flag is sticky, "is up past
         1.5R" is not always true any more — and a tooltip contradicting the R
         column two cells away is the fastest way to lose a reader's trust in
         both. */
      title={
        (c.faded
          ? `${c.symbol} reached ${
              Number.isFinite(c.peakR) ? `${c.peakR.toFixed(2)}R` : `${FREE_AT_R}R`
            }${c.freeOn ? ` on ${c.freeOn}` : ""} and is now up ` +
            `${c.gainR.toFixed(2)}R.\n\n` +
            `Still above what you paid, so the stop can still go to ` +
            `${c.entry.toFixed(2)} — breakeven — at your broker.\n\n`
          : `${c.symbol} is up ${c.gainR.toFixed(2)}R.\n\n` +
            `Its stop can go to ${c.entry.toFixed(2)} — breakeven — at your broker.\n\n`) +
        `Click to dismiss this reminder. Nothing else changes: no stop moves, ` +
        `no R changes, and the open-risk dial goes on counting the stop you ` +
        `recorded here.`
      }
    >
      <Flag size={11} />
    </button>
  );
}

/* Hidden in the Essentials view. Every one of them is still a click away, and
   every one is detail about a position rather than its standing. The date is
   here because Days says the same thing more usefully; the rest are the
   workings behind Open risk and Unrealised, which stay. */
const BEYOND_ESSENTIALS = new Set([
  "entry_date", "qtyOpen", "openPct", "slPct", "toStop", "buyValue", "netRiskR", "realisedPnl",
]);
/* The picker's list, in table order. Labels match the headers exactly — the
   list is how somebody finds a column they can see, so it must use its name. */
const HOLDINGS_COLUMNS = [
  { k: "entry_date", label: "Entered" }, { k: "days", label: "Days" },
  { k: "qtyOpen", label: "Open qty" }, { k: "openPct", label: "Open %" },
  { k: "entry_price", label: "Entry" }, { k: "stop", label: "Stop" },
  { k: "slPct", label: "SL %" }, { k: "toStop", label: "To stop" },
  { k: "buyValue", label: "Buy value" }, { k: "openRiskAmt", label: "Open risk" },
  { k: "netRiskR", label: "Open risk R" }, { k: "mark", label: "CMP" },
  { k: "changePct", label: "Change %" }, { k: "realisedPnl", label: "Banked" },
  { k: "unrealisedPnl", label: "Unrealised" }, { k: "atR", label: "Now at" },
  { k: "margin", label: "MTF cost" }, { k: "charges", label: "Charges" },
];

export default function Holdings({
  open, closed, diary = [], journalName = "", onRefresh, refreshing, onAckBreakeven,
  onEditTrade, onExitTrade, onDeleteTrade, onAttachChart, onRemoveChart,
  onFixSoldSnapshots, splitPlan: splitPlanRows = [], onFixSplits,
  onSweepSplits, sweepingSplits = false, splitsUnsure = [],
}) {
  const [detailId, setDetailId] = useState(null);
  const [acked, setAcked] = useState([]);
  const [busyId, setBusyId] = useState(null);

  /**
   * Newest first, which is what this table has always opened on.
   *
   * Kept as the default rather than "no sort" because a holdings page has a
   * natural reading order — the thing you bought most recently is the thing
   * you are still deciding about — and a refresh landing on an arbitrary order
   * would lose it. Same key and direction the hardcoded sort used.
   */
  const [sort, setSort] = useState({ k: "entry_date", dir: -1 });

  /* Holdings sold after they were imported, proven by the closed trades' own
     sells — see lib/snapshots.js. Offered as a fix, never done silently. */
  const soldPlan = useMemo(() => soldSinceSnapshot([...(open || []), ...(closed || [])]), [open, closed]);
  const soldFixable = soldPlan.filter((p) => p.action !== "unclear");
  const [fixingSold, setFixingSold] = useState(false);
  const fixSold = async () => {
    const removes = soldFixable.filter((p) => p.action === "remove").length;
    const shrinks = soldFixable.length - removes;
    if (!window.confirm(
      [removes && `Remove ${removes} holding row${removes === 1 ? "" : "s"} whose shares were all sold`,
       shrinks && `trim ${shrinks} to what is still held`].filter(Boolean).join(" and ")
      + "? The closed trades that record the sales stay exactly as they are.")) return;
    setFixingSold(true);
    try { await onFixSoldSnapshots?.(soldFixable); } finally { setFixingSold(false); }
  };

  const [fixingSplits, setFixingSplits] = useState(false);
  const fixSplits = async () => {
    if (!window.confirm(
      `Restate ${splitPlanRows.length} position${splitPlanRows.length === 1 ? "" : "s"} for the ` +
      `splits shown? Quantities go up and prices — including stops — come down by the same ratio. ` +
      `Nothing is deleted, and what each row becomes is listed above.`)) return;
    setFixingSplits(true);
    try { await onFixSplits?.(splitPlanRows); } finally { setFixingSplits(false); }
  };

  /* "10:1" reads better than "×10", and "3:2" better than "×1.5" — it is how
     the action was announced. */
  const ratioText = (r) => {
    if (Number.isInteger(r)) return `${r}:1`;
    const halves = Math.round(r * 2);
    if (Math.abs(halves / 2 - r) < 1e-9) return `${halves}:2`;
    return `${Math.round(r * 100) / 100}×`;
  };

  /**
   * WHICH COLUMNS. Seventeen is a wall to somebody opening this for the first
   * time, on the screen they will check most often, so the default is the
   * essentials — where each position stands and what it can still cost — and
   * the picker adds back whatever else you want. Reset returns to those
   * essentials rather than to everything, because that is this table's
   * default. Remembered per browser; see useColumnPrefs.
   */
  const colPrefs = useColumnPrefs("holdings", {
    defaults: [...BEYOND_ESSENTIALS],
    legacyKey: "ledgerr:holdings-columns",
  });
  /* Same as Trades: a market without margin funding has no MTF column, and
     hiding it in one place keeps the header, the cell and the CSV in step. */
  const mtfHere = hasMtf(activeRegion());
  const show = (k) => (k === "margin" && !mtfHere ? false : colPrefs.show(k));

  const rows = useMemo(() => {
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
          /**
           * A STOP WE WERE NEVER GIVEN IS NOT A RISK OF ZERO.
           *
           * These are opposite facts that produced the same number. A position
           * whose stop sits above its entry genuinely cannot lose; a position
           * with no stop recorded can lose all of it, and we simply do not
           * know how much. Both arrived here as `openRiskAmt` not being greater
           * than zero, so both were called risk-free.
           *
           * That is the worst direction for this app to be wrong in. A
           * holdings import lands every position without a stop, so ten
           * holdings and ₹42 lakh of exposure drew the risk-free flag on every
           * row, printed ₹0 in the open-risk column, contributed nothing to
           * the rupee or R totals, and left the dial reporting "room to the 5R
           * line" — an all-clear, computed from an absence of information.
           */
          unknownRisk: t.stop_loss == null,
          // Decided once, here, because it was being decided twice: the row
          // printed 0 for a position that had banked past its own risk, while
          // the dial beside it went on adding that position's full openRiskAmt
          // to the rupee total. Same page, same word, two answers — the table
          // said nothing left to lose and the figure said fifty-eight thousand.
          riskFree: t.stop_loss != null && (t.isRiskFree || !(t.openRiskAmt > 0)),
          days: isFinite(t.heldDays) ? t.heldDays : NaN,
        };
      })
      /**
       * The same comparator as the trade sheet, deliberately.
       *
       * Two tables side by side in one app that sorted differently would be a
       * worse answer than either. Non-finite numbers go to one end rather than
       * scattering: a position with no stop has no risk figure, and those rows
       * should gather where they can be seen rather than interleave with real
       * ones.
       */
      .sort((a, b) => {
        const av = a[sort.k], bv = b[sort.k];
        if (typeof av === "number" || typeof bv === "number")
          return ((isFinite(av) ? av : -1e12) - (isFinite(bv) ? bv : -1e12)) * sort.dir;
        return String(av || "").localeCompare(String(bv || "")) * sort.dir;
      });
  }, [open, sort]);

  const totals = useMemo(() => {
    const sum = (f) => rows.reduce((a, r) => a + (isFinite(f(r)) ? f(r) : 0), 0);
    // A position with nothing left to lose contributes nothing, exactly as its
    // row shows. The R figure below already worked this way; the rupee one did
    // not, which is the whole of the discrepancy.
    //
    // A position with no stop also contributes nothing, because there is
    // nothing to add — but that is a gap in the total rather than a zero in
    // it, so it is COUNTED and said out loud beside the figure. A number that
    // silently omits part of the book is the one thing worse than no number.
    const openRisk = sum((r) => (r.riskFree || r.unknownRisk ? 0 : r.openRiskAmt));
    const unknownCount = rows.filter((r) => r.unknownRisk).length;
    /**
     * What is not being counted, so the caption can weigh the omission rather
     * than just mention it. Ten holdings missing a stop matters differently at
     * ₹42 lakh than at ₹4,000.
     *
     * `liveExposure`, the same measure the Exposure card totals, NOT the cost
     * basis. Both exist on the row and they differ by the whole unrealised
     * P&L — on this book ₹49.87L against ₹42.46L — so taking the other one put
     * two different numbers under the same word on one screen. Falls back to
     * cost only where there is no mark yet, which is the one case where cost
     * is the best available answer rather than a different question.
     */
    const unknownExposure = rows
      .filter((r) => r.unknownRisk)
      .reduce((a, r) => a + (isFinite(r.liveExposure) ? r.liveExposure
                            : isFinite(r.exposure) ? r.exposure : 0), 0);
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
      /**
       * What the shares still held actually cost — the cash that went out and
       * has not come back yet.
       *
       * Uses each row's `buyValue`, which is entry price times the quantity
       * STILL OPEN, so a position sold down to a third contributes a third of
       * its cost. Anything else would compare a cost that includes sold shares
       * against an exposure that does not, and the gap between the two tiles
       * would read as a gain the book never made.
       */
      invested: sum((r) => r.buyValue),
      openRisk,
      unknownCount,
      unknownExposure,
      today,
      todayN,
      /* What the positions bought on margin cost to carry: per day now, and
         the interest they have run up so far — sold parts and held parts. */
      mtfN: rows.filter((r) => r.marginPerDay > 0).length,
      mtfPerDay: sum((r) => r.marginPerDay),
      mtfSoFar: sum((r) => (r.marginPerDay > 0
        ? (Number(r.realisedMargin) || 0) + (Number(r.openInterest) || 0) : NaN)),
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
      /**
       * Money already taken off the table from positions that are STILL OPEN.
       *
       * It belongs under Unrealised for the same reason invested belongs under
       * Exposure: the two halves of one position. A holding sold down to a
       * third has banked something real, and until now the only place that
       * appeared was the per-row Banked column — so the strip could show a
       * modest unrealised figure on a position that had already paid for
       * itself twice over, with nothing to say so.
       *
       * A SUBSET of the Realised tiles, not a separate pot. Those count every
       * sell there has ever been, this counts the ones out of positions still
       * running — so this money appears in both, said twice on purpose. Here
       * it qualifies the unrealised figure beside it ("that ₹6.5 L is on a
       * book that has already banked ₹1.4 L"); there it is simply money
       * realised in the period.
       *
       * It used to be the only place a part-sold position's banked money
       * appeared at all, because the Realised tiles walked closed trades
       * alone. That was the bug, not this figure.
       */
      banked: rows
        .filter((r) => r.qtyExited > 0 && isFinite(r.realisedPnl))
        .reduce((a, r) => a + r.realisedPnl, 0),
      bankedFrom: rows.filter((r) => r.qtyExited > 0 && isFinite(r.realisedPnl)).length,
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
    /**
     * BY THE SELL, NOT BY THE POSITION.
     *
     * `exit_date` is a position's LAST tranche, so filtering on it credited a
     * position sold across 1 April entirely to the later year — ₹5.77 lakh of
     * one real book sitting in the wrong financial year. Each sell is now
     * counted in the year it happened, the same way the period tables do it.
     *
     * A position with no tranches recorded falls back to its own dates, so a
     * legacy row still counts somewhere rather than disappearing.
     */
    /**
     * EVERY SELL, INCLUDING THE ONES OUT OF POSITIONS STILL HELD.
     *
     * This walked `closed` alone, so a position sold down but not out
     * contributed nothing — sell 13 of 139 shares today at a profit and
     * "Realised Sep" did not move, because the position is `partial` and
     * partial is not closed. The money was real, was in the row's own Banked
     * column, and was missing from the only figure that answers "what did I
     * bank this month".
     *
     * Realised means the money came off the table. Whether the REST of the
     * position is still running is a different question, and the one the
     * Unrealised tile beside this answers.
     *
     * `open` carries both open and part-sold; those with nothing sold yield no
     * events anyway, so the filter is for clarity rather than correctness.
     */
    const banking = [...closed, ...open.filter((t) => Number(t.qtyExited) > 0)];
    /* bankedEvents, not a fallback written out here: on a part-sold position
       `pnl` is realised PLUS unrealised, and the shared helper is where that
       trap is handled once. */
    const events = banking.flatMap(bankedEvents);
    /* Read off the STRING, not through Date — `new Date("2025-04-01")` is UTC
       midnight and fyStartYear reads it back local, so west of Greenwich the
       first day of a financial year falls into the previous one. Same rule as
       fyStartYear, April to March, without the zone. */
    const fyOf = (iso) => {
      const y = Number(iso.slice(0, 4));
      return Number(iso.slice(5, 7)) < 4 ? y - 1 : y;
    };
    const inFy = events.filter((e) => fyOf(e.date) === thisFy);
    /**
     * The calendar month, on the EXIT date only.
     *
     * The financial-year figure above falls back to entry_date when there is
     * no exit, which is right for a bucket a whole year wide — a trade closed
     * without a recorded exit date still belongs to the year it was taken in,
     * and dropping it would understate the year. A MONTH cannot afford that
     * guess: a position entered in September and closed in November is not
     * September's result, and counting it there would put money in a month it
     * was never made in. So a trade with no exit date sits out of this figure
     * rather than being placed by its entry.
     */
    const now = new Date();
    /**
     * COMPARED AS TEXT, NOT PARSED INTO A DATE.
     *
     * `new Date("2026-09-01")` is UTC midnight, and `.getMonth()` reads it
     * back in the LOCAL zone — so west of Greenwich that trade belongs to
     * August, and a month's realised total would be wrong by however many
     * trades closed on the first. format.js already carries this warning
     * against `dmy`, which parses by hand for exactly this reason; this used
     * Date and walked into it anyway.
     *
     * Both sides are "YYYY-MM", so comparing the prefixes settles it with no
     * parsing and no zone at all. The month itself is still taken from the
     * local clock, which is right: "this month" means the user's month.
     */
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    /* `placedByEntry` excluded — this is the rule the comment above states,
       and the filter that was missing it. Both buckets read the same events
       array, so the year kept its fallback while the month silently inherited
       it, and a trade closed without an exit date landed in the month it was
       BOUGHT — the one thing this figure must never do. */
    const inMonth = events.filter((e) => !e.placedByEntry && e.date.slice(0, 7) === ym);
    const sumPnl = (list) => list.reduce((a, x) => a + (isFinite(x.pnl) ? x.pnl : 0), 0);
    const sumR = (list) => list.reduce((a, x) => a + (isFinite(x.r) ? x.r : 0), 0);
    /* Distinct POSITIONS, not sells — "6 trades" must not become "9" because
       three of them were scaled out of. */
    const positions = (list) => new Set(list.map((e) => e.trade?.id ?? e)).size;
    return {
      fyLabel: fyLabel(now),
      monthLabel: monthShort(now),
      month: sumPnl(inMonth), monthR: sumR(inMonth), monthN: positions(inMonth),
      year: sumPnl(inFy), yearR: sumR(inFy),
      /* All-time is every sell there has ever been, which is the same money as
         summing the positions — and now arrived at the same way as the two
         above it, so the three cannot drift. */
      all: sumPnl(events), allR: sumR(events),
    };
  }, [closed, open]);

  /**
   * HAS BEEN up past 1.5R, with a stop still under entry.
   *
   * This read the live mark, so the reminder vanished the moment a position
   * slipped back under 1.5R — unacknowledged, unrecorded, and with nothing
   * left to say it had ever been earned. The comment here used to argue that
   * "this trade has run 1.5R" is a fact about where the mark IS. It is a fact
   * about where the mark has BEEN, and that one word was the bug.
   *
   * It mattered more than it looked. A position back at 1.05R is still above
   * entry, so the stop can still go to breakeven and still take the risk off
   * the dial — the prompt disappeared while the thing it prompts for was
   * still available.
   *
   * `became_free_on` is the durable half: measurement covers open positions
   * too, running them to today and refreshing weekly, so the first close at
   * or past 1.5R is already recorded. The live check stays for the position
   * that crossed TODAY, before that week's measurement has run. Neither is
   * complete alone.
   *
   * Still measured on price rather than on open quantity, which was always
   * right: a third of the position left or all of it, the trade has run.
   */
  const flagged = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      // Dismissed once, dismissed for good. It does not come back if the
      // trade dips under 1.5R and climbs again — the stop was moved, and
      // asking twice is what makes a reminder noise. `acked` is this
      // session's optimistic half, before the reload carries the timestamp.
      if (acked.includes(r.id)) continue;
      const p = breakevenPrompt(r);
      if (p) m.set(r.id, { id: r.id, symbol: r.symbol, ...p });
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

  /**
   * A sortable header, matching the trade sheet's.
   *
   * First click on a column sorts it descending, because on every column here
   * the interesting end is the big one — the largest risk, the deepest
   * drawdown, the position closest to its stop. Clicking again flips it.
   */
  const th = (k, label, cls, title) => {
    const active = sort.k === k;
    return (
      <th className={cls} data-sortable title={title ?? COLUMN_HINTS[k]}
          onClick={() => setSort((s) => ({ k, dir: s.k === k ? -s.dir : -1 }))}>
        {label}
        <span className="arrow">{active ? (sort.dir === 1 ? "\u2191" : "\u2193") : ""}</span>
      </th>
    );
  };

  /**
   * One buy. The row this table has always drawn, lifted into a function so a
   * stock bought several times can draw the same rows under its own summary.
   */
  /**
   * The buys of one stock, gathered.
   *
   * WHAT AN AGGREGATE MAY HONESTLY SAY. Quantity, what it cost and what it is
   * worth all add up. The average entry is the money divided by the shares —
   * the price the whole holding was paid at, which is the figure a broker
   * shows and the one somebody means by "my average". Open risk adds up only
   * while every buy has a stop; one without leaves the total unknowable, and
   * a number that silently drops a stopless lot would understate the risk.
   *
   * WHAT IT MAY NOT. R, days held, the breakeven flags and the excursion
   * badges belong to a buy and to no group of them — a lot bought in April
   * and one bought last week have different stops and different R. Those stay
   * one level down, on the rows this expands into.
   */
  const grouped = useMemo(() => {
    const by = new Map();
    rows.forEach((r, index) => {
      const key = String(r.symbol || "").toUpperCase();
      const g = by.get(key) || { symbol: r.symbol, exchange: r.exchange, lots: [], index };
      g.lots.push(r);
      by.set(key, g);
    });
    return [...by.values()].map((g) => {
      const qty = g.lots.reduce((a, r) => a + (Number(r.qtyOpen) || 0), 0);
      const buyValue = g.lots.reduce((a, r) => a + (Number(r.buyValue) || 0), 0);
      const everyStop = g.lots.every((r) => !r.unknownRisk);
      return {
        ...g,
        qtyOpen: qty,
        buyValue,
        entry_price: qty > 0 ? buyValue / qty : NaN,
        mark: g.lots.find((r) => isFinite(r.mark))?.mark,
        liveExposure: g.lots.reduce((a, r) => a + (Number(r.liveExposure) || 0), 0),
        unrealisedPnl: g.lots.reduce((a, r) => a + (Number(r.unrealisedPnl) || 0), 0),
        realisedPnl: g.lots.reduce((a, r) => a + (Number(r.realisedPnl) || 0), 0),
        charges: g.lots.reduce((a, r) => a + (Number(r.charges) || 0), 0),
        margin: g.lots.reduce((a, r) => a + (Number(r.margin) || 0), 0),
        openRiskAmt: everyStop
          ? g.lots.reduce((a, r) => a + (r.riskFree ? 0 : Math.abs(Number(r.openRiskAmt) || 0)), 0)
          : NaN,
        everyStop,
        days: Math.max(...g.lots.map((r) => Number(r.days) || 0)),
      };
    });
  }, [rows]);

  const [expanded, setExpanded] = useState([]);
  const toggleGroup = (symbol) =>
    setExpanded((prev) => (prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol]));

  /** The summary line for a stock bought more than once. */
  const groupRow = (g, open) => {
    const changePct = isFinite(g.mark) && isFinite(g.entry_price) && g.entry_price > 0
      ? ((g.mark - g.entry_price) / g.entry_price) * 100 : NaN;
    return (
      <tr key={`s-${g.symbol}`} className="ps-group" data-open={open ? 1 : 0}>
        <td className="num ps-dim fz">
          <button className="ps-chev" onClick={() => toggleGroup(g.symbol)}
                  aria-expanded={open}
                  title={open ? "Hide the buys" : `Show the ${g.lots.length} buys behind this`}>
            <ChevronRight size={13} />
          </button>
        </td>
        <td className="fz2 fz-last">
          <button className="ps-sym" onClick={() => toggleGroup(g.symbol)} title={`${g.lots.length} buys`}>
            <b className="disp">{g.symbol}</b>
          </button>
          <span className="ps-dim"> {g.exchange}</span>
          <i className="ps-lots">{g.lots.length} buys</i>
        </td>
        {show("entry_date") && <td className="ps-dim fz">—</td>}
        {show("days") && <td className="num ps-dim">{isFinite(g.days) ? `${g.days}` : "—"}</td>}
        {show("qtyOpen") && <td className="num"><Qty v={g.qtyOpen} /></td>}
        {show("openPct") && <td className="num ps-dim">—</td>}
        {show("entry_price") && (
          <td className="num" title="The whole holding's average: what it cost, divided by the shares">
            {isFinite(g.entry_price) ? g.entry_price.toFixed(2) : "—"}
          </td>
        )}
        {show("stop") && <td className="num ps-dim">—</td>}
        {show("slPct") && <td className="num ps-dim">—</td>}
        {show("toStop") && <td className="num ps-dim">—</td>}
        {show("buyValue") && <td className="num"><Money v={g.buyValue} note="What every buy of this stock still held cost" /></td>}
        {show("openRiskAmt") && (
          <td className={`num ${g.everyStop ? "neg" : "ps-dim"}`}
              title={g.everyStop ? undefined : "One of these buys has no stop, so the total risk cannot be added up"}>
            {g.everyStop ? money(-Math.abs(g.openRiskAmt)) : "—"}
          </td>
        )}
        {show("netRiskR") && <td className="num ps-dim">—</td>}
        {show("mark") && <td className="num">{isFinite(g.mark) ? g.mark.toFixed(2) : "—"}</td>}
        {show("changePct") && (
          <td className={`num ${changePct >= 0 ? "pos" : "neg"}`}>
            {isFinite(changePct) ? signedPct(changePct) : "—"}
          </td>
        )}
        {show("realisedPnl") && <td className="num ps-dim">{g.realisedPnl ? <Money v={g.realisedPnl} /> : "—"}</td>}
        {show("unrealisedPnl") && (
          <td className={`num ${g.unrealisedPnl >= 0 ? "pos" : "neg"}`} style={{ fontWeight: 500 }}>
            {isFinite(g.unrealisedPnl) ? money(g.unrealisedPnl) : "—"}
          </td>
        )}
        {show("atR") && (
          <td className="num ps-dim"
              title="R belongs to a buy: each of these has its own stop, so the group has no single R">—</td>
        )}
        {show("margin") && <td className="num ps-dim">{g.margin > 0 ? <Money v={g.margin} /> : "—"}</td>}
        {show("charges") && <td className="num ps-dim">{g.charges > 0 ? <Money v={g.charges} /> : "—"}</td>}
      </tr>
    );
  };

  const lotRow = (r, i, nested = false) => {
              const riskFree = r.riskFree;
              // The reminder has been put down. Held here as well as in the
              // row so the flag turns hollow on the click rather than on the
              // reload that follows it.
              const ackd = !!r.breakeven_ack_at || acked.includes(r.id);
              return (
                <tr key={r.id} data-alert={r.breached ? 1 : 0} data-nested={nested ? 1 : 0}>
                  <td className="num ps-dim fz">{nested ? "" : i + 1}</td>
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
                    {/* A mark the price has since gone back through is drawn in the
                        short colour, with the reason — it no longer takes the
                        position off the dial, and the row should not look settled. */}
                    {!flagged.has(r.id) && (ackd || riskFree) && (
                      <span className={`ps-flag done${r.breakevenBroken ? " broken" : ""}`}
                            title={r.breakevenBroken
                              ? "You marked this stop at breakeven, but the price has been below entry since — "
                                + "a stop at entry would have sold it. Counting the risk to your recorded stop "
                                + "again. Check the stop at your broker."
                              : ackd
                              ? "Stop moved to breakeven at your broker, so this no longer counts towards "
                                + "open risk or the dial. Your recorded stop, and every R measured from it, is unchanged."
                              : "Risk-free — enough is banked that this position can no longer lose overall"}>
                        <Flag size={11} />
                      </span>
                    )}
                    {/**
                      * Two badges read off the measured path, not off the mark.
                      *
                      * The breakeven flag beside them is a LIVE reading — it
                      * asks where price is now — and these are the opposite:
                      * facts about what this position already did, which stay
                      * true on a day the stock is down. That difference is the
                      * whole point of storing the path. A trade that ran to 3R
                      * in its first week and has since come back shows no live
                      * flag at all, and used to leave no trace anywhere.
                      */}
                    {r.is_power && (
                      <span className="ps-badge ps-badge-power"
                            title={`Closed at or past ${POWER_R}R within ${POWER_DAYS} sessions of `
                              + `entry — the move a breakout is bought for. Measured on daily `
                              + `closes, so it is a price this actually finished a day at.`}>
                        <Rocket size={11} />
                      </span>
                    )}
                    {/* Was free, and is not any more. The only badge here that
                        needs both halves: the path says it got in front, the
                        mark says where it is now. */}
                    {r.became_free_on && isFinite(r.atR) && r.atR < 0 && (
                      <span className="ps-badge ps-badge-back"
                            title={`Closed past ${FREE_AT_R}R on ${r.became_free_on} and is now back `
                              + `below what you paid. Nothing here says what to do about it — it is `
                              + `the fact the journal could never see before.`}>
                        <CornerDownRight size={11} />
                      </span>
                    )}
                    {r.status === "partial" && <span className="ps-tag">part sold</span>}
                  </td>
                  {show("entry_date") && (
                  <td className="mono ps-dim">
                    {r.entry_date}
                    {/* A holdings file carries no purchase date, so the import
                        had to put one in. Marked here because this table is
                        where those positions land, and an unmarked guess is
                        indistinguishable from a date somebody checked. The
                        days column beside it already reads "—" for these. */}
                    {r.entry_date_source === "assumed" && (
                      <span className="ps-assumed" title={
                        "Assumed — your holdings file didn't say when you bought this. " +
                        "Nothing counts it as a holding period until you correct it; " +
                        "open the trade and set the real date."
                      }>assumed</span>
                    )}
                  </td>
                  )}
                  {show("days") && (
                  <td className="num ps-dim">{isFinite(r.days) ? r.days : "—"}</td>
                  )}
                  {show("qtyOpen") && (
                  /* Fractional shares came with the US book — nine decimals of
                     a Netflix position is noise in a column of round numbers,
                     and every digit is still in the hover. */
                  <td className="num"><Qty v={r.qtyOpen} /></td>
                  )}
                  {show("openPct") && (
                  <td className="num">
                    {/* A bar rather than only a number: how much of the position
                        is still on is easier to scan than to read. */}
                    <div className="ps-openpct">
                      <span>{isFinite(r.openPct) ? `${r.openPct.toFixed(0)}%` : "—"}</span>
                      <i style={{ width: `${Math.min(100, Math.max(0, r.openPct || 0))}%` }} />
                    </div>
                  </td>
                  )}
                  {show("entry_price") && (
                  <td className="num">{Number(r.entry_price).toFixed(2)}</td>
                  )}
                  {/* Marked assumed here as it is on the trade sheet, and for a
                      sharper reason: this screen already prints ASSUMED beside
                      the entry date two columns to the left. Both values come
                      from the same import and are equally invented, so marking
                      one and not the other reads as a statement that the stop
                      IS yours — the exact belief the flag exists to prevent.
                      Every R on the row follows from this number. */}
                  {show("stop") && (
                  <td className={`num ${r.stopAboveEntry ? "ps-locked" : ""}`}
                      title={r.stop_source === "assumed"
                        ? "Assumed at import, not a stop you set — every R on this row follows from it"
                        : r.stopAboveEntry
                        ? "Stop is past entry — this position can no longer lose"
                        : undefined}>
                    {isFinite(r.stop) ? r.stop.toFixed(2) : "—"}
                    {r.stop_source === "assumed" && isFinite(r.stop) && (
                      <span className="ps-assumed">assumed</span>
                    )}
                  </td>
                  )}
                  {show("slPct") && (
                  <td className="num ps-dim">{isFinite(r.slPct) ? pct(r.slPct) : "—"}</td>
                  )}
                  {show("toStop") && (
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
                  )}
                  {show("buyValue") && (
                  <td className="num">
                    <Money v={r.buyValue}
                           note="What the shares still held cost — entry price × open quantity" /></td>
                  )}
                  {/* A dash, not a zero, when no stop was ever recorded. "0"
                      here is a measurement saying there is nothing to lose;
                      the dash says nobody has told us. The column already uses
                      "—" for every other figure it cannot compute. */}
                  {show("openRiskAmt") && (
                  <td className={`num ${r.unknownRisk ? "ps-dim" : riskFree ? "ps-dim" : "neg"}`}
                      title={r.unknownRisk
                        ? "No stop recorded, so there is no risk figure — not a risk of zero. Set a stop and this fills in."
                        : undefined}>
                    {r.unknownRisk ? "—" : riskFree ? "0" : money(-Math.abs(r.openRiskAmt))}
                  </td>
                  )}
                  {show("netRiskR") && (
                  <td className="num">
                    {/* Same distinction as the rupee column, and the bar is
                        drawn at zero width either way — but "0.00R" claims a
                        measurement the journal does not have. */}
                    <div className="ps-riskbar" data-free={riskFree ? 1 : 0}>
                      <span className="mono">
                        {r.unknownRisk ? "—"
                          : riskFree ? "0.00R"
                          : `−${Math.abs(r.netRiskR ?? 0).toFixed(2)}R`}
                      </span>
                      <i style={{
                        width: `${Math.min(100, (Math.abs(r.netRiskR || 0) / RISK_WARN_R) * 100)}%`,
                      }} />
                    </div>
                  </td>
                  )}
                  {/* The mark, and — only when it is near an end of the day's
                      range — where in that day it landed. Under the price
                      rather than beside the symbol, because it is a fact
                      about this number and the association should not need
                      explaining. Lowercase like `breached` in the To stop
                      column, which is the same kind of remark. */}
                  {show("mark") && (
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
                  )}
                  {show("changePct") && (
                  <td className={`num ${r.changePct >= 0 ? "pos" : "neg"}`}>
                    {isFinite(r.changePct) ? signedPct(r.changePct) : "—"}
                  </td>
                  )}
                  {show("realisedPnl") && (
                  <td className={`num ${r.realisedPnl >= 0 ? "pos" : "neg"}`}>
                    {isFinite(r.realisedPnl) && r.qtyExited > 0 ? money(r.realisedPnl) : <span className="ps-dim">—</span>}
                  </td>
                  )}
                  {show("unrealisedPnl") && (
                  <td className={`num ${r.unrealisedPnl >= 0 ? "pos" : "neg"}`} style={{ fontWeight: 500 }}>
                    {isFinite(r.unrealisedPnl) ? money(r.unrealisedPnl) : "—"}
                  </td>
                  )}
                  {show("atR") && (
                  <td className={`num ${r.atR >= 0 ? "pos" : "neg"}`}
                      title={"Where price stands against this trade's 1R. It does not change when "
                        + "you sell part of the position — sell a third at 6R and this still reads "
                        + "6R, then follows the price from there. The rupee column beside it is "
                        + "what the shares you still hold are worth."}>
                    {isFinite(r.atR) ? rfmt(r.atR) : "—"}
                  </td>
                  )}
                  {/* SO FAR, not in total: a position still running has paid
                      its buy-side charges and is still accruing interest, so
                      both figures grow until it is sold. Said in the hover
                      rather than in a longer header. */}
                  {show("margin") && (
                  <td className="num" style={{ fontSize: 12, color: "var(--ink2)" }}>
                    {Number(r.margin) > 0
                      ? <Money v={r.margin} note={`MTF so far — interest to today with the pledge fee${
                          r.marginPerDay > 0 ? `. Another ${money(r.marginPerDay)} a day while you hold` : ""}`} />
                      : r.interestUnknown
                      ? <span title="Interest not counted — the entry date was estimated">—</span>
                      : "—"}
                  </td>
                  )}
                  {show("charges") && (
                  <td className="num" style={{ fontSize: 12, color: "var(--ink2)" }}>
                    {Number(r.charges) > 0
                      ? <Money v={r.charges} note="Charges on this position so far — the buy, plus any sells already made. The sell still to come will add to it" />
                      : "—"}
                  </td>
                  )}
                </tr>
    );
  };

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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* The count is on the button so what is about to be downloaded is
              stated before the click, not discovered when the file opens. */}
          {SHOW_HOLDINGS_CSV && (
            <button className="btn ghost sm" disabled={!rows.length}
                    title={`Download the ${rows.length} holding${rows.length === 1 ? "" : "s"}
                            shown, in this order, as ${exportFilename("holdings", { prefix: journalName })}`}
                    onClick={() => downloadCsv(rows, HOLDING_COLS.filter((c) => mtfHere || c.key !== "margin"), exportFilename("holdings", { prefix: journalName }))}>
              <Download size={13} />CSV
            </button>
          )}
          <button className="btn ghost sm" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={13} />{refreshing ? "Refreshing…" : "Refresh prices"}
          </button>
        </div>
      </div>

      {/* The dial sits with the open-risk figure it describes, rather than as a
          separate band that has to be tied back to a number above it. */}
      {/*
        * SOLD SINCE THE SNAPSHOT. A holdings row is what was held on the day
        * it was imported; when the tax P&L later shows those shares sold, the
        * holding is a stale copy of shares that are gone. Said plainly, with
        * the evidence per stock, and fixed only on a click.
        */}
      {soldPlan.length > 0 && (
        <div className="ps-sold">
          <div className="ps-sold-head">
            <div>
              <b>{soldPlan.length} holding{soldPlan.length === 1 ? " was" : "s were"} sold after you imported {soldPlan.length === 1 ? "it" : "them"}</b>
              <p>Your holdings file showed {soldPlan.length === 1 ? "this" : "these"} as held on the day you imported it.
                Your closed trades show the shares sold since — so each is in your journal twice.</p>
            </div>
            {soldFixable.length > 0 && onFixSoldSnapshots && (
              <button className="btn sm" onClick={fixSold} disabled={fixingSold}>
                {fixingSold ? "Fixing…" : `Fix ${soldFixable.length} row${soldFixable.length === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
          <ul>
            {soldPlan.map((p) => (
              <li key={p.id}>
                <b>{p.symbol}</b>{" "}
                {p.action === "remove"
                  ? <>— {p.held} held on {dmy(p.snapshot)}, all sold since. The row goes; the closed trade keeps the whole purchase.</>
                  : p.action === "shrink"
                  ? <>— {p.held} held on {dmy(p.snapshot)}, {p.soldSince} sold since. It will show the {p.stillHeld} still held.</>
                  : <span className="ps-sold-unclear">— more sold since {dmy(p.snapshot)} ({p.soldSince}) than it held ({p.held}). Left alone: check it by hand.</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/**
        * A SPLIT, OR A BONUS, THAT THE JOURNAL HAS NOT BEEN TOLD ABOUT.
        *
        * A broker's order book states the day's price and quantity. After a
        * ten-for-one split the same holding is ten times the shares at a
        * tenth the price, and left alone the row reads as a 94% loss with an
        * R built on a stop ten times too far away. The figures are shown
        * before and after, and nothing moves without a click.
        */}
      {(splitPlanRows.length > 0 || splitsUnsure.length > 0) && (
        <div className="ps-sold">
          <div className="ps-sold-head">
            <div>
              <b>{splitPlanRows.length} position{splitPlanRows.length === 1 ? "" : "s"} {splitPlanRows.length === 1 ? "has" : "have"} been through a split</b>
              <p>Your broker&apos;s file states the price and quantity of the day you
                bought. A split — or a bonus issue, which is the same arithmetic —
                restates both, so these rows are in old money until they are adjusted.</p>
            </div>
            {onFixSplits && splitPlanRows.length > 0 && (
              <button className="btn sm" onClick={fixSplits} disabled={fixingSplits}>
                {fixingSplits ? "Adjusting…" : `Adjust ${splitPlanRows.length} position${splitPlanRows.length === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
          <ul>
            {splitPlanRows.map((p) => (
              <li key={p.id}>
                <b>{p.symbol}</b> — {p.splits.map((x) => `${ratioText(x.ratio)} on ${dmy(x.date)}`).join(", ")}.{" "}
                {qty(p.was.quantity)} at {p.was.entry_price} becomes{" "}
                <b>{qty(p.quantity)} at {p.entry_price}</b>.
                {/* The proof, on the row it belongs to: adjusting a position a
                    broker already adjusted leaves the P&L unchanged and the
                    position nonsense, so the price on the day is what
                    separates the two. */}
                {p.why && <i className="ps-why"> {p.why}</i>}
              </li>
            ))}
            {splitsUnsure.map((p) => (
              <li key={p.id} className="ps-unsure">
                <b>{p.symbol}</b> — left alone.{" "}
                <i className="ps-why">{p.why}</i>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="ps-top">
        <div className="ps-riskcard">
          <RiskDial riskR={totals.openRiskR}
                    measured={rows.length - totals.unknownCount} />
          <div className="ps-riskfig">
            <div className="ps-sum-l">Open risk</div>
            {/* Matches the dial. With nothing measured, ₹0 is a claim and "—"
                is the fact — and the two sitting side by side, one hedging and
                one certain, is worse than either alone. */}
            <div className={`ps-sum-v mono ${totals.unknownCount === rows.length && rows.length ? "ps-dim" : "neg"}`}>
              {totals.unknownCount === rows.length && rows.length
                ? "—"
                : money(-Math.abs(totals.openRisk))}
            </div>
            <div className="ps-sum-s mono">
              {/* Counts only what the figure above actually covers. Saying
                  "across 10 holdings" over a total that measured none of them
                  is the specific way this read as an all-clear. */}
              across {rows.length - totals.unknownCount} of {rows.length} holding
              {rows.length === 1 ? "" : "s"}
            </div>
            {totals.unknownCount > 0 ? (
              /**
               * The gap, said before the reassurance.
               *
               * A dial reading 0.00R next to "room to the 5R line" is an
               * all-clear, and it was being drawn over positions whose risk is
               * not zero but unmeasured — every holdings import lands that way.
               * The exposure is named because it is the part that is known:
               * we cannot say what is at risk, but we can say how much is on
               * the table while nobody has said where to get out.
               */
              <div className="ps-riskfig-note ps-riskfig-gap">
                <b>{totals.unknownCount} of these {rows.length} {totals.unknownCount === 1 ? "has" : "have"} no stop</b>,
                so {totals.unknownCount === 1 ? "it is" : "they are"} not in that figure —
                {" "}<Money v={totals.unknownExposure} /> of exposure with nothing recorded to get out at.
                {" "}<a href="/stops">Set them</a> and this starts counting.
              </div>
            ) : null /* "5R is a warning line, not a limit" is in the dial's hover now. */}
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
            value={<ToTheRupee v={totals.today} />}
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
            /* Under today's move, what margin costs every day — the one live
               version of that figure, and the one that changes decisions: a
               position going nowhere on MTF is paying for the privilege. Only
               when something open is on margin. */
            foot={totals.mtfN > 0 ? `−${money(totals.mtfPerDay)}` : null}
            footLabel={totals.mtfN > 0
              ? `MTF a day · ${money(totals.mtfSoFar)} so far`
              : undefined}
          />
          {/* Ordered by how close each figure is to right now: today, then
              what is still riding on the open book, then what that book is
              worth, then the year, then all of it. Realised all-time last
              also puts the longest sub-line at the end of the row, where
              running on has nothing to push out of line. */}
          <Summary
            label="Unrealised"
            value={<Money v={totals.unrealised} />}
            sub={isFinite(totals.unrealisedR) ? rfmt(totals.unrealisedR) : "—"}
            hint={`Money still on the table across every holding, and what it comes to in R. This
                  one IS weighted by size, so it will not match the Now at column added up —
                  that column is where each price stands, which is not a thing you can sum.${
                    totals.bankedFrom > 0
                      ? ` Under the line is what part-selling has already banked out of ${
                          totals.bankedFrom} position${totals.bankedFrom === 1 ? "" : "s"} that
                          are still open — real money, on trades that are not finished.`
                      : ""}`}
            tone={totals.unrealised >= 0 ? "pos" : "neg"}
            /* No line at all when nothing has been sold down. A rule under a
               ₹0 is a reading somebody has to make, and there is nothing to
               read. */
            foot={totals.bankedFrom > 0 ? money(totals.banked) : null}
            footLabel="banked"
          />
          <Summary
            label="Exposure"
            value={<Money v={totals.exposure} />}
            sub="at CMP"
            foot={<Money v={totals.invested} />}
            footLabel="invested"
            hint="What the open book is worth at the last price fetched, and under it what those
                  same shares cost you. The difference between the two is the Unrealised figure
                  beside it. A position sold in part counts only the shares still held, on both
                  lines."
          />
          {/* The month sits between what is open and the year, keeping the
              row in order of how much time each figure covers: today, the
              open book, what it is worth, this month, this year, all of it. */}
          <Summary
            label={`Realised ${realised.monthLabel}`}
            value={<Money v={realised.month} />}
            sub={realised.monthN === 0
              ? "nothing closed yet"
              : `${isFinite(realised.monthR) ? rfmt(realised.monthR) : "—"} · ${
                  realised.monthN} trade${realised.monthN === 1 ? "" : "s"}`}
            tone={realised.monthN === 0 ? undefined : realised.month >= 0 ? "pos" : "neg"}
            hint="Closed in this calendar month, by exit date. A trade with no exit date
                  recorded is left out rather than placed by when it was entered — a
                  position opened in one month and closed in another is not the first
                  month's result."
          />
          <Summary
            label={`Realised ${realised.fyLabel}`}
            value={<Money v={realised.year} />}
            sub={isFinite(realised.yearR) ? rfmt(realised.yearR) : "—"}
            tone={realised.year >= 0 ? "pos" : "neg"}
          />
          <Summary
            label="Realised all-time"
            value={<Money v={realised.all} />}
            sub={isFinite(realised.allR)
              ? `${rfmt(realised.allR)}${curve.n > 0 ? ` · ${curve.n} trades` : ""}`
              : "—"}
            tone={realised.all >= 0 ? "pos" : "neg"}
          />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", margin: "0 0 8px" }}>
        <ColumnPicker columns={HOLDINGS_COLUMNS.filter((c) => mtfHere || c.k !== "margin")}
                      prefs={colPrefs} resetLabel="Essentials" />
      </div>

      <div className="card scroll ps-table">
        <table className="t ps-t">
          <thead>
            <tr>
              {/* The index is pinned with the symbol rather than left behind
                  it — on its own it would slide under and disappear. */}
              <th className="num fz">#</th>
              {th("symbol", "Symbol", "fz2 fz-last")}
              {show("entry_date") && th("entry_date", "Entered")}
              {show("days") && th("days", "Days", "num")}
              {show("qtyOpen") && th("qtyOpen", "Open qty", "num")}
              {show("openPct") && th("openPct", "Open %", "num")}
              {show("entry_price") && th("entry_price", "Entry", "num")}
              {show("stop") && th("stop", "Stop", "num")}
              {show("slPct") && th("slPct", "SL %", "num")}
              {show("toStop") && th("toStop", "To stop", "num")}
              {show("buyValue") && th("buyValue", "Buy value", "num")}
              {show("openRiskAmt") && th("openRiskAmt", "Open risk", "num")}
              {show("netRiskR") && th("netRiskR", "Open risk R", "num")}
              {show("mark") && th("mark", "CMP", "num")}
              {show("changePct") && th("changePct", "Change %", "num")}
              {show("realisedPnl") && th("realisedPnl", "Banked", "num")}
              {show("unrealisedPnl") && th("unrealisedPnl", "Unrealised", "num")}
              {show("atR") && th("atR", "Now at", "num")}
              {/* Their own wording here, not the shared hint: on a closed
                  trade these are the final bill, on a position still running
                  they are only what has been paid so far. */}
              {show("margin") && th("margin", "MTF cost", "num",
                "MTF so far on this position — interest to today, with the pledge fee. "
                + "It grows every day you hold")}
              {show("charges") && th("charges", "Charges", "num",
                "Charges on this position so far — the buy, and any sells already made. "
                + "Selling the rest will add to it")}
            </tr>
          </thead>
          <tbody>
            {grouped.map((g) => {
              /**
               * ONE ROW PER STOCK, opened to show the buys behind it.
               *
               * A position built a month at a time is a dozen rows of the same
               * name, and the table stops answering the question anybody
               * actually has — how much Apple do I own, and what is it doing.
               * So a stock bought more than once shows as itself: total
               * quantity, the average it was paid at, and what the whole
               * holding is worth. The buys are still there, one click down,
               * because that is where the dates, stops and R of each one live.
               *
               * A stock bought once looks exactly as it always did — no
               * chevron, no summary, nothing to open.
               */
              if (g.lots.length === 1) return lotRow(g.lots[0], g.index);
              const open = expanded.includes(g.symbol);
              return (
                <Fragment key={`g-${g.symbol}`}>
                  {groupRow(g, open)}
                  {open && g.lots.map((r, i) => lotRow(r, i, true))}
                </Fragment>
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

      {/*
        * A KEY TO THE MARKS, NOT A MANUAL. This was 323 words in two columns,
        * and most of them defined columns — Buy value, Now at, Open risk —
        * which now explain themselves on hover and in the column picker. The
        * 5R dial's "a warning, not a limit" is printed on the dial itself.
        * What nothing else explains is the four marks beside a symbol, so that
        * is all this says, each next to the mark it describes.
        *
        * The marks here are spans, not the flag button, so hovering the key
        * does not look like it will do something.
        */}
      <div className="ps-key">
        <span className="ps-key-item">
          <span className="ps-flag ps-key-mark"><Flag size={11} /></span>
          Up past {FREE_AT_R}R. Move the stop to breakeven at your broker, then click the flag.
        </span>
        <span className="ps-key-item">
          <span className="ps-flag done ps-key-mark"><Flag size={11} /></span>
          Can no longer lose: stop at breakeven, or enough banked. Left out of open risk.
        </span>
        <span className="ps-key-item">
          <span className="ps-flag done broken ps-key-mark"><Flag size={11} /></span>
          Marked at breakeven, but the price has been below entry. Counted in open risk again — check your stop.
        </span>
        <span className="ps-key-item">
          <span className="ps-badge ps-badge-power ps-key-mark"><Rocket size={11} /></span>
          Closed at or past {POWER_R}R within {POWER_DAYS} sessions of entry.
        </span>
        <span className="ps-key-item">
          <span className="ps-badge ps-badge-back ps-key-mark"><CornerDownRight size={11} /></span>
          Was past {FREE_AT_R}R, now back below what you paid.
        </span>
        <span className="ps-key-item ps-key-aside">
          Rocket and arrow record what already happened. Neither is advice.
        </span>
      </div>

      {/* The routine check covers what is still held — ten symbols on this
          book against nearly three hundred once the sold ones are counted. A
          trade that opened before a split and closed after it is the one case
          where history can still be wrong, so it is a button rather than a
          cost everybody pays on every visit. */}
      {onSweepSplits && (
        <p className="ps-sweep">
          <button className="lk" onClick={onSweepSplits} disabled={sweepingSplits}>
            {sweepingSplits ? "Checking…" : "Also check the stocks you no longer hold"}
          </button>
          {" "}— splits are checked on what you hold. A trade that opened before a
          split and closed after it is the only sold one that can still be wrong.
        </p>
      )}

      <style jsx>{`
        .ps-sweep { font-size: 11.5px; color: var(--ink3); margin: 12px 0 0;
                    line-height: 1.6; max-width: 80ch; }
        .ps-why { font-style: normal; color: var(--ink3); }
        .ps-unsure { color: var(--ink3); }
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
        /* Reads at the weight of the figure it qualifies, not as small print
           under it. This is the sentence that stops a 0.00R dial being taken
           as an all-clear, so it cannot be the quietest thing in the card. */
        .ps-riskfig-gap { color: var(--ink2); }
        .ps-riskfig-gap b { color: var(--short); font-weight: 600; }
        .ps-riskfig-gap a {
          color: var(--ink); text-underline-offset: 2px;
          border-bottom: 1px solid var(--rule);
        }
        .ps-riskfig-gap a:hover { border-bottom-color: var(--brass); }
        .ps-strip {
          display: grid; grid-template-columns: repeat(6, 1fr);
          border: 1px solid var(--rule); border-radius: 3px;
          background: var(--card); overflow: hidden;
        }
        /* Below this the strip cannot hold its figures beside a 290px card
           without clipping them, so it takes its own full-width row. Raised
           twice: 1100 when Today made it five, and again when the month made
           it six. Each column added moves the wrap earlier. */
        @media (max-width: 1460px) {
          .ps-top { grid-template-columns: 1fr; }
        }
        /* Three, then two — factors of six, so every row is full and the strip
           never ends with one figure alone against four empty cells. That was
           already untidy at five, where the odd one sat by itself; six divides
           where five did not. */
        @media (max-width: 1100px) {
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
        /* One wrapping row across the full width, not a column with the right
           half empty. Each mark sits beside the words it explains. */
        .ps-sold {
          border: 1px solid var(--brass); background: var(--card); border-radius: 3px;
          padding: 14px 16px; margin-bottom: 14px;
        }
        .ps-sold-head { display: flex; justify-content: space-between; align-items: flex-start;
                        gap: 14px; flex-wrap: wrap; }
        .ps-sold-head b { font-size: 14px; }
        .ps-sold-head p { margin: 4px 0 0; font-size: 12.5px; color: var(--ink2); max-width: var(--note-w); }
        .ps-sold ul { margin: 10px 0 0; padding-left: 18px; font-size: 12.5px; color: var(--ink2);
                      display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 3px 24px; }
        .ps-sold li b { color: var(--ink); }
        .ps-sold-unclear { color: var(--short); }
        .ps-key {
          display: flex; flex-wrap: wrap; gap: 8px 26px; align-items: baseline;
          margin-top: 10px; font-size: 11.5px; color: var(--ink3); line-height: 1.5;
        }
        .ps-key-item { display: inline-flex; align-items: center; gap: 6px; }
        .ps-key-aside { font-style: italic; }
        .ps-key :global(.ps-key-mark) { margin-left: 0; cursor: default; }
        .ps-key :global(.ps-key-mark:hover) { transform: none; }
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
        /* Sized and spaced like the flag so a row carrying all three reads as
           one group rather than three separate marks. Not buttons: there is
           nothing to dismiss, because neither of these is a reminder. */
        .ps-badge {
          display: inline-flex; align-items: center; vertical-align: middle;
          margin-left: 5px; line-height: 1;
        }
        .ps-badge svg { display: block; }
        .ps-badge-power { color: var(--brass); }
        .ps-badge-back { color: var(--short); }
        .ps-flag:hover:not(:disabled) { transform: translateY(-1px) scale(1.15); }
        .ps-flag:disabled { opacity: 0.4; cursor: default; }
        .ps-flag.done {
          cursor: default; opacity: 0.5; padding: 0;
        }
        .ps-flag.done svg { fill: none; }
        .ps-flag.done.broken { color: var(--short); opacity: 1; }
        .ps-sub-flag {
          display: inline-flex; align-items: center; gap: 4px;
          color: var(--long); font-weight: 600;
        }
        .ps-sub-flag svg { fill: currentColor; }

        /* Tightened when the strip went from four figures to five. The value
           gives up 2px rather than the padding giving up more: shrinking the
           gutters instead would run the numbers into the dividing rules and
           make the row look denser than it reads. */
        .ps-sum {
          padding: 11px 13px; border-right: 1px solid var(--rule); min-width: 0;
          /* Column so a tile carrying a foot can push it to the bottom edge
             while the label and value stay at the top. */
          display: flex; flex-direction: column;
        }
        .ps-sum:last-child { border-right: 0; }
        /* margin-top:auto is what pins it to the base of the cell, so the rule
           lines up with where every other tile already ends. */
        .ps-sum-foot {
          margin-top: auto; padding-top: 7px;
          border-top: 1px solid var(--rule);
          display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
        }
        .ps-sum-foot-v {
          font-size: 13px; font-weight: 500; color: var(--ink2);
          font-variant-numeric: tabular-nums; white-space: nowrap;
        }
        .ps-sum-foot-l {
          font-size: 9px; font-weight: 600; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--ink3);
        }
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
        /* The paise, set back. Inherits colour through opacity rather than
           taking one of its own, so it stays a quieter version of whichever
           tone the figure is wearing instead of turning grey on a red total. */
        .ps-dec { font-size: 0.68em; opacity: 0.55; }

        /* A stock bought more than once: its summary line, and the buys under
           it. Global, because these rows are drawn by lotRow/groupRow rather
           than by this component's own JSX — see the styled-jsx note in
           CLAUDE.md. */
        /* GLOBAL, because the row that carries it is drawn by the lotRow
           function rather than by this component's own JSX — scoped, the rule
           stopped applying the day the rows moved into a function, and "at
           high" went back to sitting beside the price instead of under it.
           See the styled-jsx note in CLAUDE.md. Note also: no backticks in a
           comment inside a styled-jsx template, which ends the string. */
        .hd-dayend {
          display: block; font-size: 10px; margin-top: 1px;
          letter-spacing: 0.01em; font-weight: 500; opacity: 0.9;
        }
        .ps-group { background: var(--bg); }
        .ps-group td { font-weight: 500; }
        .ps-lots { font-style: normal; font-size: 10.5px; color: var(--ink3);
                   border: 1px solid var(--rule); border-radius: 2px;
                   padding: 1px 5px; margin-left: 7px; white-space: nowrap; }
        .ps-chev { background: none; border: 0; cursor: pointer; padding: 0;
                   color: var(--ink3); display: inline-flex; }
        .ps-chev svg { transition: transform .12s ease; }
        .ps-group[data-open="1"] .ps-chev svg { transform: rotate(90deg); }
        tr[data-nested="1"] td:nth-child(2) { padding-left: 26px; }
        tr[data-nested="1"] td { color: var(--ink2); }
        .qty { font-variant-numeric: tabular-nums; }
        /* Tabular figures so the five totals line up as a row of balances.
           The strip is monospaced already; this also pins the foot line, which
           carries the same numbers one size down. */
        .ps-sum-v, .ps-sum-foot-v { font-variant-numeric: tabular-nums; }
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
        /**
         * The assumed markers, which are NOT the boxed tag above.
         *
         * "part sold" is a status and earns a box; "assumed" is a footnote on
         * the number it sits under. Boxed and inline it competed with the
         * figure and pushed the column wide — two of them on one row made it
         * look like the row was mostly labels. Under the value, unboxed, it
         * reads as a caption, which is what it is. Same rule as the trade
         * sheet, which had it right already.
         */
        .ps-assumed {
          display: block; font-style: normal; font-size: 9px;
          letter-spacing: 0.06em; text-transform: uppercase; color: var(--brass);
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
