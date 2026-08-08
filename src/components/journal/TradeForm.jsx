"use client";

import { useState, useEffect, useRef } from "react";
import { X, Check, Plus } from "lucide-react";
import SymbolSearch from "@/components/SymbolSearch";
import ChargesField from "./ChargesField";
import { derivePosition } from "@/lib/positions";
import { rupee, pct } from "@/lib/format";
import { PATTERNS, EXIT_REASONS, MISTAKES, STAGES, slBand } from "@/lib/constants";
import { resolveTradingViewChart } from "@/lib/charts";
import { entryCharges, mergeConfig } from "@/lib/charges";
import { useAutosave, loadDraft, DRAFT_KEYS } from "@/lib/useAutosave";

const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));

/**
 * The live tranche list, coerced for derivePosition. Half-typed rows are
 * dropped rather than fed in as NaN, so the R readout stays quiet until a
 * sell is actually complete instead of flickering nonsense as you type.
 */
function withExits(t) {
  const exits = (t.exits || [])
    .filter((e) => e.exit_date && num(e.quantity) > 0 && num(e.price) > 0)
    .map((e) => ({
      exit_date: e.exit_date,
      quantity: num(e.quantity),
      price: num(e.price),
      reason: e.reason || null,
      charges: 0,   // the figure lives on t.charges; counting it twice would understate P&L
    }));
  return { ...t, exits };
}

/**
 * Split the charge figure between the entry and the individual sells.
 *
 * Buy-side costs — stamp duty, half the STT, the buy brokerage — are incurred
 * the moment the position is opened, so they stay on the trade. Sell-side
 * costs belong to the sell that incurred them, apportioned by size. That is
 * what stops a part-sold position being charged for exits that haven't
 * happened yet: sell a third and only a third of the exit cost is counted.
 *
 * The total never changes, so a figure typed by hand is still respected in
 * full — it is only attributed more precisely.
 */
function splitCharges(t, exits, config) {
  const total = num(t.charges) || 0;
  if (!(total > 0) || !exits.length) {
    return { tradeCharges: total, exits };
  }

  let entrySide = total;
  if (config) {
    const buy = entryCharges(
      { exchange: t.exchange, entry_price: num(t.entry_price), quantity: num(t.quantity) },
      mergeConfig(config)
    );
    if (isFinite(buy?.total)) entrySide = Math.min(total, buy.total);
  }

  const exitSide = Math.max(0, total - entrySide);
  const soldQty = exits.reduce((a, e) => a + e.quantity, 0);
  if (!(soldQty > 0)) return { tradeCharges: total, exits };

  // Apportioned against the size of the position, not the size of what has
  // been sold. Dividing by the latter would hand a single 40-of-100 sell the
  // entire exit bill — the whole thing this is meant to avoid.
  const posQty = num(t.quantity);
  const denom = isFinite(posQty) && posQty > 0 ? posQty : soldQty;
  const fullyOut = soldQty >= denom - 1e-6;

  let allocated = 0;
  const withCharges = exits.map((e, i) => {
    // Only once the position is fully out does the last sell absorb the
    // rounding remainder; while it's part sold there is genuinely cost still
    // to come, and forcing it in early is the same overstatement again.
    const share = i === exits.length - 1 && fullyOut
      ? Math.round((exitSide - allocated) * 100) / 100
      : Math.round((exitSide * (e.quantity / denom)) * 100) / 100;
    allocated += share;
    return { ...e, charges: share };
  });

  return { tradeCharges: Math.round(entrySide * 100) / 100, exits: withCharges };
}

const blankExit = (date) => ({
  exit_date: date || new Date().toISOString().slice(0, 10),
  quantity: "", price: "", reason: "",
});

/** What the database trigger will conclude, worked out here so the form agrees. */
function statusFromExits(exits, quantity) {
  const sold = (exits || []).reduce((a, e) => a + (num(e.quantity) || 0), 0);
  const total = num(quantity);
  if (!(sold > 0)) return "open";
  if (isFinite(total) && sold < total - 1e-6) return "partial";
  return "closed";
}

const blank = () => ({
  status: "open", symbol: "", company: "", exchange: "NSE", side: "long",
  entry_date: new Date().toISOString().slice(0, 10),
  // Blank on a new trade: toPayload() pins it to the opening stop on first save.
  entry_price: "", quantity: "", stop_loss: "", initial_stop_loss: "", stop_source: "",
  pattern: "", pivot_price: "", vol_pct_avg: "", weinstein_stage: "", rs_rank: "",
  thesis: "",
  exit_date: "", exit_price: "", exit_reason: "",
  exits: [],
  charges: "0", charges_auto: true, charges_breakdown: null,
  mistakes: [], notes: "",
});

const str = (v) => (v === null || v === undefined ? "" : String(v));

function fromInitial(row) {
  return {
    id: row.id,
    status: row.status, symbol: row.symbol, company: row.company || "",
    exchange: row.exchange, side: row.side,
    entry_date: row.entry_date, entry_price: str(row.entry_price),
    quantity: str(row.quantity), stop_loss: str(row.stop_loss),
    // Carried, never edited — the form has no field for it. Without this an
    // edit would re-pin 1R to whatever the stop has since been trailed to.
    initial_stop_loss: str(row.initial_stop_loss),
    // Carried so toPayload can tell an untouched assumed stop from one the
    // trader has just replaced with the real thing.
    stop_source: row.stop_source || "",
    _loadedStop: str(row.stop_loss),
    pattern: row.pattern || "", pivot_price: str(row.pivot_price),
    vol_pct_avg: str(row.vol_pct_avg), weinstein_stage: str(row.weinstein_stage),
    rs_rank: str(row.rs_rank),
    thesis: row.thesis || "",
    exit_date: row.exit_date || "", exit_price: str(row.exit_price),
    exit_reason: row.exit_reason || "",
    // Real tranches when the row has them; otherwise the flat columns become
    // the single equivalent sell, so an older trade opens as one editable row
    // rather than looking as though its exit had been lost.
    exits: row.exits?.length
      ? row.exits.map((e) => ({
          exit_date: e.exit_date || "",
          quantity: str(e.quantity),
          price: str(e.price),
          reason: e.reason || "",
        }))
      : row.status === "closed" && row.exit_date
      ? [{
          exit_date: row.exit_date,
          quantity: str(row.quantity),
          price: str(row.exit_price),
          reason: row.exit_reason || "",
        }]
      : [],
    // charges_auto comes straight off the row, never defaulted to true here —
    // an existing trade's figure was either computed or typed by the person
    // who logged it, and only that stored flag says which.
    charges: str(row.charges ?? 0),
    charges_auto: row.charges_auto === true,
    charges_breakdown: row.charges_breakdown || null,
    mistakes: row.mistakes || [], notes: row.notes || "",
  };
}

function toPayload(t) {
  const numOrNull = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

  // The tranches are the truth; these flat columns mirror them. Migration
  // 007's trigger recomputes all three from trade_exits anyway, but sending
  // the same answer keeps the row sane in the moment between the two writes,
  // and keeps a single-exit trade correct if 007 hasn't been run.
  const live = withExits(t).exits;
  const sold = live.reduce((a, e) => a + e.quantity, 0);
  const status = statusFromExits(t.exits, t.quantity);
  const lastExit = live.length ? live[live.length - 1].exit_date : null;
  const avgExit = sold > 0
    ? live.reduce((a, e) => a + e.price * e.quantity, 0) / sold
    : null;

  return {
    ...(t.id ? { id: t.id } : {}),
    symbol: t.symbol.trim().toUpperCase(),
    company: t.company || null,
    exchange: t.exchange,
    side: t.side,
    status,
    entry_date: t.entry_date,
    entry_price: Number(t.entry_price),
    quantity: Number(t.quantity),
    // Nullable since the import migration. Number("") is 0, which would record
    // a stop at zero and hand the trade a nonsense 1R.
    stop_loss: numOrNull(t.stop_loss),
    /**
     * One stop. The one in the field is the one R divides by, always.
     *
     * This used to keep a second, hidden stop — the one the trade "was opened
     * with" — so that trailing could never rebase R. It made a typo
     * unfixable: correct 260 to 269 and the form answered that the stop at
     * entry was 260 and the stop now is 269, when the trader meant there had
     * only ever been one and they had mistyped it.
     *
     * The distinction was solving a problem this journal does not have.
     * Trailing happens at the broker; the stop recorded here is the risk that
     * was taken, and the only reason to change it is that it was wrong.
     */
    initial_stop_loss: numOrNull(t.stop_loss),
    // An assumed stop stays assumed until someone actually changes it. Saving
    // the form for an unrelated field — a note, a pattern — shouldn't quietly
    // promote a number this app invented into one the trader stands behind.
    stop_source: numOrNull(t.stop_loss) == null
      ? null
      : t.stop_source !== "assumed" ||
        String(t.stop_loss) !== String(t._loadedStop ?? "")
      ? "recorded"
      : "assumed",
    pattern: t.pattern || null,
    pivot_price: numOrNull(t.pivot_price),
    vol_pct_avg: numOrNull(t.vol_pct_avg),
    weinstein_stage: t.weinstein_stage ? Number(t.weinstein_stage) : null,
    rs_rank: numOrNull(t.rs_rank),
    thesis: t.thesis?.trim() || null,
    exit_date: lastExit,
    // Only meaningful once the position is fully out; a partial has no single
    // exit price, and inventing one would misreport what's still running.
    exit_price: status === "closed" ? avgExit : null,
    exit_reason: status === "closed"
      ? (live[live.length - 1]?.reason || null)
      : null,
    // Whatever is in state is what ChargesField left there: unchanged from
    // the loaded row when charges_auto was already false (its own effect
    // refuses to touch the value in that case), or its latest proposal
    // otherwise. This is never a fresh recompute performed here.
    charges: numOrNull(t.charges) ?? 0,
    charges_auto: !!t.charges_auto,
    charges_breakdown: t.charges_breakdown || null,
    mistakes: t.mistakes || [],
    notes: t.notes || null,
  };
}

// A draft only counts as "for this form" if it was left behind while
// editing the same trade (or the same blank "new trade" slot) — otherwise
// an in-progress edit on trade A could leak into trade B's form.
const formIdOf = (initial) => initial?.id ?? "new";

export default function TradeForm({ initial, accountSize, defaultRiskPct, chargeConfig, startSelling, onSave, onClose }) {
  const formId = formIdOf(initial);
  const persisted = loadDraft(DRAFT_KEYS.trade);
  const restored = persisted?.formId === formId ? persisted : null;

  const [t, setT] = useState(restored?.t ?? (initial ? fromInitial(initial) : blank()));
  const [riskPct, setRiskPct] = useState(restored?.riskPct ?? defaultRiskPct ?? 0.75);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setT((p) => ({ ...p, [k]: e.target.value }));

  // Charges are attributed the same way here as on save, so the R the form
  // shows is the R that gets stored rather than a slightly different one.
  const split = splitCharges(t, withExits(t).exits, chargeConfig);
  const d = derivePosition(
    { ...t, charges: split.tradeCharges, exits: split.exits },
    accountSize
  );
  const editing = !!t.id;
  const slBandLabel = slBand(d.slPct);

  const { clear: clearDraft } = useAutosave(DRAFT_KEYS.trade, { formId, t, riskPct });
  const closeAndClear = () => { clearDraft(); onClose(); };

  const toggleMistake = (m) =>
    setT((p) => ({ ...p, mistakes: p.mistakes.includes(m)
      ? p.mistakes.filter((x) => x !== m) : [...p.mistakes, m] }));

  /* ---- exit tranches ----------------------------------------------- */

  const qtySold = (t.exits || []).reduce((a, e) => a + (num(e.quantity) || 0), 0);
  const qtyLeft = num(t.quantity) - qtySold;
  const oversold = isFinite(qtyLeft) && qtyLeft < -1e-6;
  const derivedStatus = statusFromExits(t.exits, t.quantity);

  const setExit = (i, key) => (e) =>
    setT((p) => ({
      ...p,
      exits: p.exits.map((x, j) => (j === i ? { ...x, [key]: e.target.value } : x)),
    }));

  // A new row is pre-filled with whatever is still unsold, since selling the
  // rest is much the commoner case than typing a number in again.
  const addExit = () =>
    setT((p) => {
      const sold = p.exits.reduce((a, e) => a + (num(e.quantity) || 0), 0);
      const left = num(p.quantity) - sold;
      return {
        ...p,
        exits: [...p.exits, {
          ...blankExit(),
          quantity: isFinite(left) && left > 0 ? String(left) : "",
        }],
      };
    });

  const removeExit = (i) =>
    setT((p) => ({ ...p, exits: p.exits.filter((_, j) => j !== i) }));

  // Opened through Exit: land on a sell that's ready to fill instead of on the
  // setup. Once only, and never when a restored draft already has the row —
  // reopening after switching apps shouldn't quietly grow a second one.
  const exitRef = useRef(null);
  const openedSelling = useRef(false);
  useEffect(() => {
    if (!startSelling || openedSelling.current || restored) return;
    openedSelling.current = true;
    const sold = t.exits.reduce((a, e) => a + (num(e.quantity) || 0), 0);
    if (num(t.quantity) - sold > 0) addExit();
    exitRef.current?.scrollIntoView({ block: "center" });
  }, [startSelling]); // eslint-disable-line react-hooks/exhaustive-deps

  const sellRemaining = () =>
    setT((p) => {
      const sold = p.exits.reduce((a, e) => a + (num(e.quantity) || 0), 0);
      const left = num(p.quantity) - sold;
      if (!(left > 0)) return p;
      return { ...p, exits: [...p.exits, { ...blankExit(), quantity: String(left) }] };
    });

  const sizeIt = () => {
    const rps = Math.abs(num(t.entry_price) - num(t.stop_loss));
    if (!(rps > 0) || !(accountSize > 0)) return;
    setT((p) => ({ ...p, quantity: String(Math.floor((accountSize * (riskPct / 100)) / rps)) }));
  };

  // A blank stop is allowed — imported trades genuinely have none, and
  // requiring one here would make every imported trade uneditable. A stop
  // that IS given still has to be a positive number. R stays uncomputable
  // until it's filled in, which is honest rather than invented.
  const stopOk = t.stop_loss === "" || num(t.stop_loss) > 0;

  // Every sell that's been started has to be finished, and you can't sell
  // more than you hold. A position with no sells at all is simply still open.
  const exitsOk =
    !oversold &&
    (t.exits || []).every((e) => e.exit_date && num(e.quantity) > 0 && num(e.price) > 0);

  const valid = t.symbol.trim() && num(t.entry_price) > 0 &&
    num(t.quantity) > 0 && stopOk && exitsOk;

  const overRisk = isFinite(d.riskPct) && d.riskPct > 2;


  /**
   * The chart at entry.
   *
   * Deliberately not part of `t`: there is no chart column on trades, and
   * there should not be. It travels beside the payload and is written as a
   * diary entry once the trade has an id, the same way exit tranches are.
   *
   * WHY IT IS WORTH CAPTURING HERE rather than only on the trade panel. A
   * snapshot taken now shows the base before it resolved — the pivot untested,
   * the volume dry-up, the thing actually being looked at. Come back in three
   * months and TradingView shows what happened instead; the outcome is baked
   * into the picture and cannot be taken back out. It is the same reason the
   * thesis above locks once the trade closes.
   */
  /**
   * The setup fields that can wait, folded away.
   *
   * The section had grown to where logging a trade felt like filling in a
   * survey, and the fix is not to cut fields but to sort them by WHEN they
   * are knowable.
   *
   * Pattern, pivot, volume and stage are all still readable off the chart in
   * six months — the base is on it, the pivot is on it, the volume bar is on
   * it. Nothing about them decays, so nothing is lost by filling them in
   * later, or never.
   *
   * RS rank, the thesis and the entry chart stay in the open because all
   * three stop being recoverable the moment the trade resolves. RS is a
   * point-in-time ranking nobody can look up for a past date; memory rewrites
   * a thesis once the outcome is known; and a chart pulled later shows what
   * happened rather than what was in front of you.
   *
   * Nothing is removed. Every column, every recorded value and every cut on
   * the performance sheet that reads them is untouched.
   *
   * Opens by itself when any of them already holds a value. Hiding a field
   * that has something in it is how the something gets dropped on the next
   * save.
   */
  const [showMore, setShowMore] = useState(false);

  const [chartLink, setChartLink] = useState("");
  const [chartOk, setChartOk] = useState(null);
  const chart = resolveTradingViewChart(chartLink);
  useEffect(() => {
    if (t.pattern || t.pivot_price || t.vol_pct_avg || t.weinstein_stage) setShowMore(true);
  }, [t.pattern, t.pivot_price, t.vol_pct_avg, t.weinstein_stage]);
  useEffect(() => { setChartOk(null); }, [chart.url]);

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      // Tranches travel alongside the row, not in it — they belong to
      // trade_exits and the trade has to exist before they can reference it.
      // The charge figure is attributed across the two on the way out, so a
      // part-sold position isn't billed for sells that haven't happened.
      // A chart that resolved AND rendered. Never a blocker: a bad link, or a
      // link nobody pasted, must not stand between someone and a logged trade.
      const chartSrc = chart.ok && chartOk === true ? chart.url : null;
      await onSave({ ...toPayload(t), charges: split.tradeCharges }, split.exits, chartSrc);
      clearDraft();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && closeAndClear()}>
      <div className="sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheethead">
          <div>
            <div className="eyebrow">{editing ? "Edit trade" : "New trade"}</div>
            <div className="disp" style={{ fontSize: 17, marginTop: 2 }}>
              {t.symbol ? t.symbol.toUpperCase() : "Untitled position"}
            </div>
          </div>
          <button className="x" onClick={closeAndClear} aria-label="Close"><X size={19} /></button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>

          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Position</div>
            <div className="grid4" style={{ gap: 12 }}>
              <label className="f" style={{ gridColumn: "span 2" }}><span>Symbol</span>
                <SymbolSearch
                  value={t.symbol}
                  exchange={t.exchange}
                  onPick={({ symbol, company, exchange }) =>
                    setT((p) => ({ ...p, symbol, company, exchange }))}
                />
                {/* Always say what's going to be recorded — showing nothing
                    for a hand-typed symbol made the field look like it hadn't
                    taken. No claim about the symbol list here: a missing
                    company only means nobody looked one up, which is true of
                    every imported trade. SymbolSearch owns the list and says
                    so there, where it has actually checked. */}
                {t.symbol && (
                  <div className="hint">
                    {t.company
                      ? `${t.company} · ${t.exchange}`
                      : `Recording as ${t.symbol.trim().toUpperCase()} · ${t.exchange}`}
                  </div>
                )}
              </label>
              <label className="f"><span>Direction</span>
                <select className="in" value={t.side} onChange={set("side")}>
                  <option value="long">Long</option><option value="short">Short</option>
                </select></label>
              <label className="f"><span>Entry date</span>
                <input className="in" type="date" value={t.entry_date} onChange={set("entry_date")} /></label>
            </div>
            <div className="grid3" style={{ gap: 12, marginTop: 12 }}>
              <label className="f"><span>Entry price</span>
                <input className="in" inputMode="decimal" value={t.entry_price} onChange={set("entry_price")} /></label>
              <label className="f"><span>Stop loss</span>
                <input className="in" inputMode="decimal" value={t.stop_loss} onChange={set("stop_loss")} />
                <div className="hint" style={{ color: slBandLabel === "wide" || slBandLabel === "very wide" ? "var(--brass)" : undefined }}>
                  {isFinite(d.slPct) ? `${d.slPct.toFixed(1)}% from entry — ${slBandLabel}` : "How far the stop sits from entry"}
                </div></label>
              <label className="f"><span>Quantity</span>
                <input className="in" inputMode="numeric" value={t.quantity} onChange={set("quantity")} /></label>
            </div>
          </div>

          <div className="readout">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <span className="eyebrow" style={{ color: "var(--ink2)" }}>Size it for me</span>
              <input className="in mono" style={{ width: 68, padding: "4px 7px", fontSize: 13 }}
                     value={riskPct} inputMode="decimal"
                     onChange={(e) => setRiskPct(e.target.value)} />
              <span style={{ fontSize: 12, color: "var(--ink2)" }}>% of account at risk</span>
              <button className="btn ghost sm" type="button" onClick={sizeIt}>Set quantity</button>
            </div>
            <div className="row"><span>Risk per share</span>
              <b>{isFinite(d.riskPerShare) ? d.riskPerShare.toFixed(2) : "—"}</b></div>
            <div className="row">
              <span>
                1R — total risk
                {/* On a trade that already has one, 1R is measured against the
                    stop it was opened with, not the one in the box above —
                    that's the whole point of pinning it. Say which, or the two
                    numbers look like they disagree. */}
              </span>
              <b>{rupee(d.riskAmt)}</b></div>
            <div className="row"><span>Risk as % of account</span>
              <b style={{ color: overRisk ? "var(--short)" : "inherit" }}>{pct(d.riskPct, 2)}</b></div>
            <div className="row"><span>Position value / exposure</span>
              <b>{rupee(d.exposure)}</b></div>
            {overRisk && (
              <div className="warn" style={{ marginTop: 9 }}>
                This position risks more than 2% of the account. Reduce the quantity or tighten the stop.
              </div>
            )}
          </div>

          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>The setup</div>
            {/* What survives the trade, first. RS rank, the thesis and the
                chart cannot be recovered once the outcome is known; the four
                behind the link below can, off the same chart, any time. */}
            <div className="grid2" style={{ gap: 12 }}>
              <label className="f" style={{ maxWidth: 280 }}><span>RS rank</span>
                <input className="in" inputMode="numeric" placeholder="1–99" value={t.rs_rank} onChange={set("rs_rank")} />
                <div className="hint">Where it ranked the day you bought — not something you can look up later.</div>
              </label>
              <label className="f"><span>Why this trade</span>
                <input className="in" value={t.thesis} onChange={set("thesis")}
                       readOnly={derivedStatus === "closed"}
                       style={derivedStatus === "closed" ? { color: "var(--ink2)", background: "var(--paper)" } : undefined}
                       placeholder="The one-line reason, written now — not reconstructed after you know the outcome." />
                <div className="hint">
                  {derivedStatus === "closed"
                    ? "Locked once closed — this is what you thought at entry, not a rewrite after the fact."
                    : "Read back after the trade closes, this is often the most honest line in the journal."}
                </div></label>
            </div>

            {/* Under the thesis because it is the other half of it — the words
                and the picture, both taken before the outcome is known. Only
                on a new trade: an existing one is attached to from its own
                panel, where the charts already saved are visible and a second
                place to add them would just be a way to add duplicates. */}
            {!editing && (
              <div style={{ marginTop: 12 }}>
                <label className="f"><span>Chart at entry <i className="tf-opt">optional</i></span>
                  <input className="in" value={chartLink} onChange={(e) => setChartLink(e.target.value)}
                         placeholder="Paste a TradingView snapshot link — tradingview.com/x/…" />
                  <div className="hint">
                    {chart.ok && chartOk === true
                      ? "Saved with the trade, as it looks right now — before you know how it turned out."
                      : chart.ok && chartOk === false
                      ? "That link is the right shape but TradingView has no snapshot at it."
                      : chart.empty
                      ? "The camera icon on the TradingView toolbar (or Alt+S) makes one. Never required."
                      : chart.error}
                  </div>
                </label>
                {chart.ok && (
                  <img className="tf-chart" src={chart.url} alt="Chart at entry"
                       data-bad={chartOk === false ? 1 : 0}
                       onLoad={() => setChartOk(true)} onError={() => setChartOk(false)} />
                )}
              </div>
            )}

            {showMore ? (
              <div className="grid4" style={{ gap: 12, marginTop: 14 }}>
                <label className="f"><span>Base pattern</span>
                  <select className="in" value={t.pattern} onChange={set("pattern")}>
                    <option value="">—</option>
                    {PATTERNS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select></label>
                <label className="f"><span>Pivot price</span>
                  <input className="in" inputMode="decimal" value={t.pivot_price} onChange={set("pivot_price")} />
                  <div className="hint">
                    {isFinite(d.distPivot)
                      ? `Entered ${d.distPivot >= 0 ? "" : "−"}${Math.abs(d.distPivot).toFixed(1)}% ${d.distPivot >= 0 ? "above" : "below"} pivot`
                      : "Sets your extension at entry"}
                  </div></label>
                <label className="f"><span>Volume % of avg</span>
                  <input className="in" inputMode="decimal" placeholder="240" value={t.vol_pct_avg} onChange={set("vol_pct_avg")} />
                  <div className="hint" style={{ color: isFinite(num(t.vol_pct_avg)) && num(t.vol_pct_avg) < 100 ? "var(--short)" : undefined }}>
                    {isFinite(num(t.vol_pct_avg))
                      ? num(t.vol_pct_avg) >= 100
                        ? `${(num(t.vol_pct_avg) - 100).toFixed(0)}% above the 30-day average`
                        : `${(100 - num(t.vol_pct_avg)).toFixed(0)}% below average — thin breakout`
                      : "100 = the 30-day average"}
                  </div></label>
                <label className="f"><span>Weinstein stage</span>
                  <select className="in" value={t.weinstein_stage} onChange={set("weinstein_stage")}>
                    <option value="">—</option>
                    {STAGES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                  </select></label>
              </div>
            ) : (
              <button type="button" className="lnk" style={{ marginTop: 14 }}
                      onClick={() => setShowMore(true)}>
                + Pattern, pivot, volume and stage
              </button>
            )}
            {!showMore && (
              <div className="hint" style={{ marginTop: 5 }}>
                All four are still on the chart later — add them now or when you review.
              </div>
            )}
          </div>

          <div ref={exitRef}>
            <div className="ex-head">
              <div className="eyebrow">Exit</div>
              <div className="ex-state">
                <span className="ex-badge" data-s={derivedStatus}>
                  {derivedStatus === "open" ? "Still open"
                    : derivedStatus === "partial" ? "Part sold" : "Closed"}
                </span>
                {qtySold > 0 && (
                  <span className="ex-sold mono">
                    {qtySold} of {t.quantity || "—"} sold
                    {isFinite(qtyLeft) && qtyLeft > 0 && <> · {qtyLeft} left</>}
                  </span>
                )}
              </div>
            </div>

            {/* No open/closed toggle: status is settled by what's been sold,
                and a switch that could disagree with the tranches — or with
                the trigger that owns status in the database — is a way for
                the two to drift apart. */}
            {t.exits.length > 0 && (
              <div className="ex-rows">
                {t.exits.map((e, i) => (
                  <div className="ex-row" key={i}>
                    <label className="f"><span>{i === 0 ? "Sold on" : ""}</span>
                      <input className="in" type="date" value={e.exit_date}
                             onChange={setExit(i, "exit_date")} /></label>
                    <label className="f"><span>{i === 0 ? "Quantity" : ""}</span>
                      <input className="in" inputMode="numeric" value={e.quantity}
                             onChange={setExit(i, "quantity")} /></label>
                    <label className="f"><span>{i === 0 ? "Price" : ""}</span>
                      <input className="in" inputMode="decimal" value={e.price}
                             onChange={setExit(i, "price")} /></label>
                    <label className="f"><span>{i === 0 ? "Why" : ""}</span>
                      <select className="in" value={e.reason} onChange={setExit(i, "reason")}>
                        <option value="">—</option>
                        {EXIT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select></label>
                    <button type="button" className="x ex-del" aria-label="Remove this sell"
                            onClick={() => removeExit(i)}><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}

            <div className="ex-actions">
              <button className="btn ghost sm" type="button" onClick={addExit}>
                <Plus size={12} />{t.exits.length ? "Another sell" : "Record a sell"}
              </button>
              {isFinite(qtyLeft) && qtyLeft > 0 && t.exits.length > 0 && (
                <button className="btn ghost sm" type="button" onClick={sellRemaining}>
                  Sell the remaining {qtyLeft}
                </button>
              )}
              {oversold && (
                <span className="ex-warn">
                  Sold {qtySold} of a {t.quantity} position — more than you hold.
                </span>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <ChargesField
                trade={t}
                value={t.charges}
                auto={t.charges_auto}
                config={chargeConfig}
                onChange={(charges, charges_auto, charges_breakdown) =>
                  setT((p) => ({ ...p, charges, charges_auto, charges_breakdown }))}
              />
            </div>

            {derivedStatus !== "open" && (
              <>
                {(isFinite(d.r) || isFinite(d.realisedR)) && (
                  <div className="readout" style={{ marginTop: 12 }}>
                    {derivedStatus === "partial" ? (
                      <>
                        <div className="row"><span>Banked so far (net of charges)</span>
                          <b className={d.realisedPnl >= 0 ? "pos" : "neg"}>{rupee(d.realisedPnl)}</b></div>
                        <div className="row"><span>Banked in R</span>
                          <b className={d.realisedR >= 0 ? "pos" : "neg"}>
                            {isFinite(d.realisedR) ? `${d.realisedR >= 0 ? "+" : ""}${d.realisedR.toFixed(2)}R` : "—"}</b></div>
                        <div className="row"><span>Still running</span>
                          <b>{d.qtyOpen} of {t.quantity}</b></div>
                        {isFinite(d.unrealisedR) && (
                          <div className="row"><span>Open R on the rest</span>
                            <b className={d.unrealisedR >= 0 ? "pos" : "neg"}>
                              {d.unrealisedR >= 0 ? "+" : ""}{d.unrealisedR.toFixed(2)}R</b></div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="row"><span>Realised P&amp;L (net of charges)</span>
                          <b className={d.pnl >= 0 ? "pos" : "neg"}>{rupee(d.pnl)}</b></div>
                        <div className="row"><span>Outcome in R</span>
                          <b className={d.r >= 0 ? "pos" : "neg"} style={{ fontSize: 15 }}>
                            {isFinite(d.r) ? `${d.r >= 0 ? "+" : ""}${d.r.toFixed(2)}R` : "—"}</b></div>
                        {d.exitsCount > 1 && (
                          <div className="row"><span>Scaled out over</span>
                            <b>{d.exitsCount} sells · avg {d.avgExitPrice?.toFixed(2)}</b></div>
                        )}
                      </>
                    )}
                    {isFinite(d.heldDays) && (
                      <div className="row"><span>Held</span><b>{d.heldDays} days</b></div>)}
                  </div>
                )}
                <div style={{ marginTop: 14 }}>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>Anything you got wrong</div>
                  <div className="chips">
                    {MISTAKES.map((m) => (
                      <button key={m} type="button" className="chip rd" data-on={t.mistakes.includes(m) ? 1 : 0}
                              onClick={() => toggleMistake(m)}>{m}</button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <label className="f"><span>Notes on this trade</span>
            <textarea className="in" rows={3} value={t.notes} onChange={set("notes")}
              placeholder="What the chart looked like, what the market was doing, what you were thinking." /></label>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end",
                        borderTop: "1px solid var(--rule)", paddingTop: 16 }}>
            <button className="btn ghost" onClick={closeAndClear}>Cancel</button>
            <button className="btn" disabled={!valid || saving} style={{ opacity: valid ? 1 : 0.4 }}
                    onClick={submit}>
              <Check size={14} />{saving ? "Saving…" : editing ? "Save changes" : "Log trade"}
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .tf-opt {
          font-style: normal; font-weight: 400; color: var(--ink3);
          font-size: 9.5px; letter-spacing: 0.06em; margin-left: 6px;
        }
        .tf-chart {
          width: 100%; height: auto; display: block; margin-top: 10px;
          border: 1px solid var(--rule); border-radius: 3px; max-height: 260px;
          object-fit: contain; object-position: top; background: var(--paper);
        }
        /* A broken image renders as an alt-text stub; the hint above already
           says what went wrong, so the stub is only noise. */
        .tf-chart[data-bad="1"] { display: none; }
        .ex-head {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 12px; margin-bottom: 10px; flex-wrap: wrap;
        }
        .ex-state { display: flex; align-items: baseline; gap: 9px; }
        .ex-badge {
          font-size: 9px; font-weight: 700; letter-spacing: 0.09em;
          text-transform: uppercase; padding: 2px 7px; border-radius: 2px;
          border: 1px solid var(--rule); color: var(--ink3);
        }
        .ex-badge[data-s="partial"] { color: var(--brass); border-color: var(--brass); }
        .ex-badge[data-s="closed"]  { color: var(--ink); border-color: var(--ink2); }
        .ex-sold { font-size: 11.5px; color: var(--ink3); }
        .ex-rows { display: flex; flex-direction: column; gap: 8px; }
        .ex-row {
          display: grid; grid-template-columns: 1.1fr 0.7fr 0.8fr 1.1fr auto;
          gap: 9px; align-items: end;
        }
        .ex-del { align-self: end; margin-bottom: 5px; }
        .ex-actions {
          display: flex; align-items: center; gap: 9px;
          margin-top: 11px; flex-wrap: wrap;
        }
        .ex-warn { font-size: 11.5px; color: var(--short); }
        @media (max-width: 640px) {
          .ex-row { grid-template-columns: 1fr 1fr; }
          .ex-del { grid-column: 2; justify-self: end; }
        }
      `}</style>
    </div>
  );
}
