"use client";

import { useEffect, useMemo, useState } from "react";
import { matchesEdgeFilter, describeEdgeFilter } from "@/lib/edge";
import { Plus, Pencil, Trash2, Download, Image as ImageIcon, X, Check } from "lucide-react";
import { rupee, rfmt, pct, signedPct, exportFilename } from "@/lib/format";
import PositionDetail from "./PositionDetail";
import { SETUP_FIELDS } from "@/lib/gaps";
import { noStopOnRecord, hasRealStop, canHaveStop } from "@/lib/stops";
import { matches, describeFilter, seedFromTab, sortForFilter } from "@/lib/filters";
import SavedViews from "./SavedViews";

const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));

/**
 * WHAT IS ON SCREEN, NOT WHAT IS IN THE BOOK.
 *
 * This took `all` and exported the whole journal however the table was
 * filtered — so a view narrowed to twenty-seven trades handed back
 * ninety-seven, and nothing about the file said which. A download button
 * sitting inside a filtered table is a claim about that table.
 *
 * Rows arrive already filtered AND sorted, so the file opens in the order the
 * screen was in, which is the other half of the same promise.
 */
function exportCsv(rows, label) {
  const cols = ["symbol", "exchange", "side", "entry_date", "entry_price", "quantity", "stop_loss",
    "exposure", "riskAmt", "riskPct", "pattern", "pivot_price", "distPivot", "vol_pct_avg",
    "weinstein_stage", "rs_rank",
    "exit_date", "exit_price", "avgExitPrice", "exitPct", "exit_reason", "charges", "pnl", "r",
    "heldDays", "mistakes", "notes"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [cols.join(",")].concat((rows || []).map((t) =>
    cols.map((c) => esc(Array.isArray(t[c]) ? t[c].join(" | ") :
      typeof t[c] === "number" ? (isFinite(t[c]) ? t[c].toFixed(4) : "") : t[c])).join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = exportFilename(label);
  a.click(); URL.revokeObjectURL(a.href);
}

export default function Trades({ all, diary = [], onEdit, onExit, onDelete, onNew,
                                 onAttachChart, onRemoveChart, onSaveStop,
                                 filters = [], onSaveView, onDeleteView,
                                 mistake = "", missing = "", edge = null, onClearFilter }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ k: "entry_date", dir: -1 });

  const [view, setView] = useState(null);

  /**
   * Each tab opens in the order that suits what it holds.
   *
   * Newest first either way — the question is which date. A closed trade is
   * read by when it FINISHED: a position opened last January and sold last
   * week is recent news, and entry order buried it eleven rows down among
   * trades that closed months earlier. An open one has no exit to sort by, so
   * it stays on entry.
   *
   * All and No stop mix the two and keep entry order, because an open
   * position sorted on a date it does not have collects at one end whichever
   * way the arrow points — which is not an ordering, just a partition.
   *
   * Clicking a column still wins, until the next tab change.
   */
  const OPENING_SORT = { closed: { k: "exit_date", dir: -1 } };
  const chooseFilter = (id) => {
    setFilter(id);
    setView(null);
    setSort(OPENING_SORT[id] || { k: "entry_date", dir: -1 });
  };

  /**
   * A saved view and a tab are alternatives, not layers.
   *
   * Both answer "which trades", so leaving a tab switched on underneath a view
   * would silently intersect the two — you would apply "Everything over 2R",
   * see nine trades, and have no way to tell that Losers was still narrowing
   * it. Choosing either one clears the other, so what is on screen is always
   * explained by exactly one control.
   *
   * A view also brings its own opening order, since a view that asks about the
   * big R multiples is not answered by entry-date order. Clearing one restores
   * the order the current tab would have opened in, so leaving a view leaves
   * the table where picking that tab would have put it.
   */
  const applyView = (v) => {
    setView(v);
    if (v) {
      setFilter("all");
      setSort(sortForFilter(v) || { k: "entry_date", dir: -1 });
    } else {
      setSort(OPENING_SORT[filter] || { k: "entry_date", dir: -1 });
    }
  };
  const noStopCount = useMemo(() => (all || []).filter(noStopOnRecord).length, [all]);

  /**
   * THE PENCIL BELONGS TO ONE VIEW, NOT TO EVERY VIEW.
   *
   * It was on every row on every tab, which left the No stop tab with no job
   * of its own: if you could fix a stop from All or Closed, the tab was only
   * a filter you could approximate by sorting on SL %. Two things doing
   * almost the same work is how a screen stops being explainable.
   *
   * So the tabs read and this one edits. All / Open / Closed / Winners /
   * Losers are views of the book; No stop is the worklist, it carries the
   * count, and it is the only place a stop can be typed into a row. That is
   * a rule somebody can hold in their head, which the previous arrangement
   * was not.
   */
  const onNoStopView = filter === "nostop" || missing === "stop";

  /**
   * ONE PENCIL, TWO LINKED BOXES.
   *
   * The full form stays for pattern, chart, exit reason and emotion — those
   * want a chart open beside you and a modal is the right shape for them. A
   * stop usually needs neither, so charging a modal for the commonest edit on
   * this screen was the wrong price.
   *
   * "746.42" is what the broker shows; "seven percent" is what a rule says
   * and what somebody actually recalls about a trade from two years ago.
   * Two separate editors would have made you decide which you were about to
   * remember before you started typing.
   *
   * So the pencil sits between the two columns and opens both. Type a price
   * and the percent fills in; type a percent and the price does. Whichever
   * you used, ONE number is stored — the price — because that is what 1R is
   * measured from. The percent is a way in, not a second fact.
   */
  const [editStop, setEditStop] = useState(null);   // trade id
  const [priceDraft, setPriceDraft] = useState("");
  const [pctDraft, setPctDraft] = useState("");
  const [savingStop, setSavingStop] = useState(false);
  const [stopErr, setStopErr] = useState("");

  /* A short's stop sits ABOVE entry, so the sign follows the side rather than
     assuming long — the same rule the bulk fill uses. */
  const dirOf = (t) => (t.side === "short" ? -1 : 1);
  const priceFromPct = (t, pct) => {
    const entry = Number(t.entry_price);
    if (!(entry > 0) || !isFinite(pct) || !(pct > 0) || pct >= 100) return NaN;
    return Math.round(entry * (1 - (dirOf(t) * pct) / 100) * 100) / 100;
  };
  const pctFromPrice = (t, price) => {
    const entry = Number(t.entry_price);
    if (!(entry > 0) || !isFinite(price) || !(price > 0)) return NaN;
    return Math.round(((entry - price) / entry) * dirOf(t) * 1000) / 10;
  };

  const beginStop = (t) => {
    setEditStop(t.id);
    /* Empty on a trade with no stop on record — there is nothing to correct.
       On an assumed one the guess is carried in, exactly as the stops queue
       does it: you are editing a number somebody invented, and an empty box
       would make you reconstruct it from nothing. Either way a value has to
       be TYPED before anything saves, so the one-click "the guess was right"
       that the stops queue deliberately lacks is absent here too. */
    const p = noStopOnRecord(t) ? NaN : Number(t.stop_loss);
    setPriceDraft(isFinite(p) ? String(p) : "");
    const pc = pctFromPrice(t, p);
    setPctDraft(isFinite(pc) ? String(pc) : "");
  };
  const cancelStop = () => { setEditStop(null); setPriceDraft(""); setPctDraft(""); setStopErr(""); };

  const typePrice = (t, v) => {
    setPriceDraft(v);
    const pc = pctFromPrice(t, Number(v));
    setPctDraft(v === "" || !isFinite(pc) ? "" : String(pc));
  };
  const typePct = (t, v) => {
    setPctDraft(v);
    const p = priceFromPct(t, Number(v));
    setPriceDraft(v === "" || !isFinite(p) ? "" : String(p));
  };

  const commitStop = async (t) => {
    const price = Number(priceDraft);
    const entry = Number(t.entry_price);
    /* The same guards the stops queue applies: a stop on the wrong side of
       entry produces a negative 1R and poisons every R that follows from it. */
    if (!(price > 0) || !(entry > 0) || price === entry) {
      setStopErr("Type a stop price, or a percent from entry.");
      return;
    }
    if (t.side === "short" ? price <= entry : price >= entry) {
      setStopErr(t.side === "short"
        ? "A short's stop sits above entry."
        : "A stop has to sit below entry.");
      return;
    }
    setSavingStop(true); setStopErr("");
    try {
      await onSaveStop?.(t.id, Math.round(price * 100) / 100);
      cancelStop();
    } catch (e) {
      /**
       * A SAVE THAT FAILS HAS TO SAY SO.
       *
       * There was no catch here, so when the handler threw — the page called
       * saveStops without importing it, a plain ReferenceError — the promise
       * rejected into nothing. The editor stayed open with the typed numbers
       * in it and no message, which reads as a button that does not work
       * rather than as a save that failed. Silence is the worst outcome
       * available to a write.
       *
       * The editor deliberately stays open on failure: the typed value is
       * still the best thing on screen and closing would throw it away.
       */
      setStopErr(e?.message || "Could not save that stop.");
    } finally {
      setSavingStop(false);
    }
  };

  /* Moving between the two boxes must not close the editor, and they live in
     different cells — so the marker travels with them and blur checks where
     focus actually went. */
  const stopKeys = (t) => ({
    "data-stopedit": t.id,
    disabled: savingStop,
    onKeyDown: (e) => {
      if (e.key === "Enter") { e.preventDefault(); commitStop(t); }
      if (e.key === "Escape") { e.preventDefault(); cancelStop(); }
    },
    onBlur: (e) => {
      if (e.relatedTarget?.dataset?.stopedit === String(t.id)) return;
      cancelStop();
    },
  });

  const [detailId, setDetailId] = useState(null);

  /**
   * Trades that have a chart, by trade id.
   *
   * Charts are not attached to trades — they hang off diary entries, which
   * point back at a trade through trade_id. That link is real in the data and
   * was surfaced nowhere, so "did I save a chart for this one" could only be
   * answered by scrolling the diary. A Set of ids is enough for the column;
   * the images themselves are fetched only when a row is opened.
   */
  const charted = useMemo(() => {
    const m = new Map();
    for (const d of diary || []) {
      if (!d.trade_id || !d.image_path) continue;
      m.set(d.trade_id, (m.get(d.trade_id) || 0) + 1);
    }
    return m;
  }, [diary]);

  /**
   * `?missing=stop` reaches the trades marked as having no stop on record.
   *
   * Deliberately NOT added to SETUP_FIELDS: those are the chart-read fields
   * the Edge screen needs, and putting a stop among them would add a sixth
   * row to the Review data-gaps card duplicating the /stops queue. This is a
   * different question with a different home.
   *
   * It exists because those trades leave /stops once resolved — correctly,
   * they are answered — and there was then no list of them anywhere. One at
   * a time through this table always worked; finding them did not.
   */
  const NO_STOP_FIELD = { key: "stop", label: "stop", has: hasRealStop };
  const missingField = SETUP_FIELDS.find((f) => f.key === missing)
    || (missing === "stop" ? NO_STOP_FIELD : null);
  const edgeDesc = useMemo(() => (edge ? describeEdgeFilter(edge) : null), [edge]);

  /* Switching tabs mid-edit would leave an editor open on a row that is no
     longer on screen, and its state pointing at a trade nobody can see. */
  useEffect(() => { if (!onNoStopView) cancelStop(); }, [onNoStopView]);   // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    let r = all;
    // Arrives from the mistakes table on Performance. Exact match, not a
    // substring — "Sold too early" and "Sold a little late" both contain
    // "Sold", and a fuzzy filter would quietly mix two different errors.
    if (mistake) r = r.filter((t) => (t.mistakes || []).includes(mistake));

    // Arrives from the gaps prompt on Review. Closed only, matching how the
    // count was made — offering to fix a hundred and then listing a hundred
    // and forty is how a prompt stops being trusted.
    if (missingField) {
      r = r.filter((t) => t.status === "closed" && !missingField.has(t));
    }

    /*
      Arrives from a row on "Where the edge is". CLOSED ONLY, because that
      table is built from closed trades — an open position has no R and was
      never in the bucket, so including it here would show more trades than
      the row said and make the count look wrong.

      The membership test is edge.js's own, the same function that put the
      trade in the bucket. Writing a second one here would eventually disagree
      with the first, and the disagreement would surface as a row claiming 26
      trades and this list showing 24.
    */
    if (edge) {
      r = r.filter((t) => t.status === "closed" && matchesEdgeFilter(t, edge));
    }
    if (filter === "open") r = r.filter((t) => t.status === "open");
    if (filter === "closed") r = r.filter((t) => t.status === "closed");
    /**
     * WON OR LOST IS A QUESTION ABOUT MONEY, NOT ABOUT R.
     *
     * These filtered on `r`, which is NaN wherever there is no stop to divide
     * by — so on a book with ninety-six stopless trades both tabs were nearly
     * empty while Closed listed the same trades with their profits and losses
     * printed beside them. A trade that made forty-five thousand rupees is a
     * winner whether or not anybody wrote down a stop.
     *
     * Nothing is reclassified by this. For any trade that HAS a stop,
     * r = pnl / riskAmt with riskAmt positive, so `r > 0` and `pnl > 0` pick
     * out exactly the same trades. The only difference is that the ones R
     * could never see stop being dropped in silence.
     */
    if (filter === "winners") r = r.filter((t) => isFinite(t.pnl) && t.pnl > 0);
    if (filter === "losers") r = r.filter((t) => isFinite(t.pnl) && t.pnl <= 0);
    if (filter === "nostop") r = r.filter(noStopOnRecord);
    /* Applied to the same derived rows the table draws, which is what makes a
       rule on pnl, r, slPct or heldDays possible at all — none of those are
       columns, they come out of derivePosition. */
    if (view) r = r.filter((t) => matches(t, view));
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      r = r.filter((t) => (t.symbol || "").toLowerCase().includes(s) ||
        (t.pattern || "").toLowerCase().includes(s) || (t.notes || "").toLowerCase().includes(s));
    }
    return [...r].sort((a, b) => {
      const av = a[sort.k], bv = b[sort.k];
      if (typeof av === "number" || typeof bv === "number")
        return ((isFinite(av) ? av : -1e12) - (isFinite(bv) ? bv : -1e12)) * sort.dir;
      return String(av || "").localeCompare(String(bv || "")) * sort.dir;
    });
  }, [all, mistake, missingField, edge, filter, view, q, sort]);

  // Resolved by id against the filtered list, not held as an object: change
  // the filter or the sort while it's open and the panel follows the row,
  // or closes if that row is no longer on screen.
  /**
   * What is on screen, added up.
   *
   * Only worth having because the list filters: eight GARFIBRES rows raise
   * "so what did this stock cost me altogether", and nothing answered it.
   *
   * R is counted separately from money and says how many trades it covers. A
   * trade with no stop has a P&L and no R, so the two totals are drawn from
   * different sets of rows — printing them side by side without saying so
   * invites reading one as the other's explanation.
   */
  /**
   * What the table is currently showing, in a few words, for the filename.
   *
   * Ordered by how specific each control is rather than by how it is reached:
   * a saved view is the narrowest thing on screen and a tab the broadest, so
   * a view wins even though both are active. Search is appended rather than
   * substituted, because "closed" and "closed, matching GODREJ" are different
   * files and a name that called them both "closed" would be the same problem
   * this replaces.
   */
  const viewLabel = useMemo(() => {
    const parts = [];
    if (view) parts.push(view.name);
    else if (mistake) parts.push(`tagged ${mistake}`);
    else if (missingField) parts.push(`missing ${missingField.label}`);
    else if (edgeDesc) parts.push(`${edgeDesc.label} ${edgeDesc.value}`);
    else if (filter !== "all") parts.push(filter === "nostop" ? "no stop" : filter);
    if (q.trim()) parts.push(`matching ${q.trim()}`);
    return parts.join(" ") || "all trades";
  }, [view, mistake, missingField, edgeDesc, filter, q]);

  const totals = useMemo(() => {
    const pnl = rows.map((t) => t.pnl).filter(isFinite);
    const rs = rows.map((t) => t.r).filter(isFinite);
    return {
      n: rows.length,
      pnl: pnl.reduce((a, b) => a + b, 0),
      r: rs.reduce((a, b) => a + b, 0),
      withR: rs.length,
    };
  }, [rows]);

  const detailAt = detailId == null ? -1 : rows.findIndex((t) => t.id === detailId);

  const th = (k, label, cls) => {
    const active = sort.k === k;
    return (
      <th className={cls} data-sortable
          onClick={() => setSort((s) => ({ k, dir: s.k === k ? -s.dir : -1 }))}>
        {label}
        <span className="arrow">{active ? (sort.dir === 1 ? "↑" : "↓") : ""}</span>
      </th>
    );
  };

  return (
    <div className="sec">
      {onNoStopView && !missingField && (
        <div className="tr-chip">
          <span>
            No stop on record, so no R — they still count in every money figure.
            Click the pencil to type one, as a price or a percent.
          </span>
          <span className="tr-chip-n">{rows.length} of {all.length}</span>
        </div>
      )}
      {view && (
        <div className="tr-chip">
          {/* The rules spelled out, not just the name. A view called "Q3 pain"
              is a label somebody chose months ago; this is what it actually
              asks, so the list never narrows for a reason you cannot read. */}
          <span>Showing <b>{view.name}</b> — {describeFilter(view).toLowerCase()}</span>
          <span className="tr-chip-n">{rows.length} of {all.length}</span>
          <button className="btn ghost sm" onClick={() => applyView(null)}>
            <X size={12} />Clear
          </button>
        </div>
      )}
      {(mistake || missingField || edgeDesc) && (
        <div className="tr-chip">
          <span>
            {mistake
              ? <>Showing trades tagged <b>{mistake}</b></>
              : missingField
              ? <>Closed trades with no <b>{missingField.label}</b> recorded — open each and add it</>
              /* The band label is the row's own string, carried in the URL and
                 printed verbatim — so this can never describe a slightly
                 different slice than the row that sent you here. */
              : <>Closed trades where <b>{edgeDesc.label}</b> is <b>{edgeDesc.value}</b></>}
          </span>
          <span className="tr-chip-n">{rows.length} of {all.length}</span>
          <button className="btn ghost sm" onClick={onClearFilter}>
            <X size={12} />Clear
          </button>
        </div>
      )}
      <div className="sechead">
        <div className="seg">
          {/**
            * "No stop" appears only when there are some, because a chip for an
            * empty set is a question nobody asked.
            *
            * It lives here rather than only on the stops queue, which is where
            * the link to these trades was. That screen is reachable while it
            * has work in it and through Settings afterwards — so the one list
            * somebody might want months later sat behind a route they would
            * have to already know about. A filter over trades belongs with the
            * other filters over trades.
            */}
          {[["all","All"],["open","Open"],["closed","Closed"],["winners","Winners"],["losers","Losers"],
            ...(noStopCount > 0 ? [["nostop", `No stop · ${noStopCount}`]] : [])].map(([id,l]) => (
            <button key={id} data-on={view ? 0 : filter === id ? 1 : 0}
                    onClick={() => chooseFilter(id)}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/**
            * THE TABS STAY VISIBLE; ONLY THE SAVED ONES GO IN A MENU.
            *
            * The obvious move is to sweep All / Open / Closed / Winners /
            * Losers into this dropdown too, under a "Quick filters" heading.
            * That trades one click for two on the five filters used most, and
            * hides which one is active behind a closed menu. Six buttons is
            * not enough to be worth a menu; a growing list of saved views is.
            */}
          <SavedViews
            all={all}
            filters={filters}
            activeId={view?.id || null}
            onApply={applyView}
            onSave={onSaveView}
            onDelete={async (id) => {
              await onDeleteView(id);
              setView((v) => (v && v.id === id ? null : v));
            }}
            seed={{ rules: seedFromTab(filter), conjunction: "and" }}
          />
          {/*
            The clear button lives INSIDE the field, which is why the wrapper
            exists. Extra right padding on the input keeps a long symbol from
            running underneath it.

            It renders only when there is something to clear — a permanent X
            beside an empty box is a control that does nothing most of the time,
            and it would sit there competing with the placeholder.
          */}
          <div className="tr-search">
            <input className="in" placeholder="Search" value={q}
                   onChange={(e) => setQ(e.target.value)} />
            {q && (
              <button type="button" className="tr-clear" aria-label="Clear search"
                      onClick={() => setQ("")}>
                <X size={13} />
              </button>
            )}
          </div>
          {/* `rows`, not `all` — see the note on exportCsv. The count is on the
              button so what you are about to download is stated before you
              click it, not discovered when the file opens. */}
          <button className="btn ghost sm" title={`Download the ${rows.length} trade${
                    rows.length === 1 ? "" : "s"} shown, as ${exportFilename(viewLabel)}`}
                  onClick={() => exportCsv(rows, viewLabel)}>
            <Download size={13} />CSV · {rows.length}
          </button>
        </div>
      </div>

      <div className="card scroll">
        {rows.length === 0 ? (
          <div className="empty">
            <div className="eyebrow">Nothing here yet</div>
            <p>Every trade you log becomes a row here and a bar on the plot. Start with
              one — even an old trade you still remember clearly.</p>
            <button className="btn" onClick={onNew}><Plus size={14} />Log a trade</button>
          </div>
        ) : (
          <table className="t">
            <thead><tr>
              {th("symbol", "Symbol", "fz fz-last")}
              {th("entry_date", "In")}
              {th("exit_date", "Out")}
              {th("heldDays", "Held", "num")}
              {/* Left to right, the life of the trade: what went on, how it
                  came off, what it came to. Risk sits after R because it is
                  the denominator R was measured against — useful once you
                  have seen the multiple, noise before it. */}
              {th("entry_price", "Entry", "num")}
              {th("stop_loss", "Stop", "num")}
              {th("slPct", "SL %", "num")}
              {th("quantity", "Qty", "num")}
              {th("exposure", "Size", "num")}
              {th("avgExitPrice", "Exit", "num")}
              {th("exitPct", "Exit %", "num")}
              {th("pnl", "P&L", "num")}
              {th("r", "R", "num")}
              {th("riskAmt", "Risk", "num")}
              {/* The setup — what the chart looked like going in. Behind the
                  outcome because most rows have none of it recorded, and a
                  block of dashes shouldn't sit between a symbol and its P&L. */}
              <th title="Charts saved against this trade in the diary">Chart</th>
              {th("pattern", "Pattern")}
              {th("distPivot", "Δ pivot", "num")}
              {th("vol_pct_avg", "Vol %", "num")}
              {th("weinstein_stage", "Stg", "num")}
              {th("rs_rank", "RS", "num")}
              <th></th>
            </tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="fz fz-last">
                    <button className="tr-sym" onClick={() => setDetailId(t.id)}
                            title={`Open ${t.symbol}`}>
                      <b className="disp">{t.symbol}</b>
                    </button>
                    <span style={{ color: "var(--ink3)", fontSize: 11 }}> {t.exchange}</span>
                    {t.side === "short" && <span style={{ color: "var(--short)", fontSize: 10 }}> ▾</span>}
                    {(t.mistakes || []).length > 0 && (
                      <span title={t.mistakes.join(", ")}
                            style={{ color: "var(--brass)", fontSize: 11, marginLeft: 4 }}>▲</span>)}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{t.entry_date}</td>
                  <td className="mono" style={{ fontSize: 12, color: t.exit_date ? "inherit" : "var(--ink3)" }}>
                    {t.exit_date || "open"}</td>
                  <td className="num" style={{ fontSize: 12, color: "var(--ink2)" }}
                      title={t.exit_date ? undefined : "Still open — counted to today"}>
                    {isFinite(t.heldDays) ? `${t.heldDays}d` : "—"}</td>
                  <td className="num" title={t.acquisition === "bonus"
                        ? "Bonus, split or allotment — these shares cost nothing, "
                          + "so the sale is all profit and there is no R to compute"
                        : undefined}>
                    {t.acquisition === "bonus"
                      ? <span className="tr-free">free</span>
                      : Number(t.entry_price).toFixed(2)}</td>
                  <td className="num" title={t.stop_source === "assumed"
                        ? "Assumed at import, not a stop you set — every R on this row follows from it"
                        : undefined}>
                    {editStop === t.id ? (
                      <span className="tr-stopedit">
                        <input className="in" inputMode="decimal" autoFocus
                               aria-label={`Stop price for ${t.symbol}`}
                               value={priceDraft}
                               onChange={(e) => typePrice(t, e.target.value)}
                               {...stopKeys(t)} />
                        {/* onMouseDown, not onClick: blur fires first and would
                            close the editor before a click could land. */}
                        <button className="tr-stopok" data-stopedit={t.id}
                                disabled={savingStop}
                                onMouseDown={(e) => { e.preventDefault(); commitStop(t); }}
                                title="Save this stop">
                          <Check size={12} />
                        </button>
                        {stopErr && <i className="tr-stoperr">{stopErr}</i>}
                      </span>
                    ) : (
                      <>
                        {isFinite(num(t.stop_loss)) ? Number(t.stop_loss).toFixed(2) : "—"}
                        {/* Sits at the right edge of this cell, which puts it
                            between the two numbers it edits. */}
                        {onNoStopView && !hasRealStop(t) && canHaveStop(t) && onSaveStop && (
                          <button className="tr-stoppen"
                                  title="Type the stop — as a price or a percent"
                                  onClick={(e) => { e.stopPropagation(); beginStop(t); }}>
                            <Pencil size={11} />
                          </button>
                        )}
                      </>
                    )}
                    {t.stop_source === "assumed" && <i className="tr-assumed">assumed</i>}
                    {noStopOnRecord(t) && <i className="tr-assumed">no stop</i>}</td>
                  <td className="num" style={{ fontSize: 12 }}>
                    {editStop === t.id ? (
                      <span className="tr-stopedit">
                        <input className="in tr-pctin" inputMode="decimal"
                               aria-label={`Stop percent for ${t.symbol}`}
                               value={pctDraft}
                               onChange={(e) => typePct(t, e.target.value)}
                               {...stopKeys(t)} />
                        <i className="tr-stophint">%</i>
                      </span>
                    ) : (
                      isFinite(t.slPct) ? pct(t.slPct, 1) : "—"
                    )}</td>
                  <td className="num">{t.quantity}</td>
                  <td className="num" style={{ fontSize: 12 }}
                      title="Entry price × quantity — what the position cost">
                    {isFinite(t.exposure) ? rupee(t.exposure) : "—"}</td>
                  <td className="num" title={t.status === "partial"
                        ? "Average of the sells so far — the rest is still open"
                        : undefined}>
                    {isFinite(t.avgExitPrice) ? t.avgExitPrice.toFixed(2) : "—"}
                    {t.status === "partial" && <i className="tr-part">part</i>}</td>
                  <td className={`num ${isFinite(t.exitPct) ? (t.exitPct >= 0 ? "pos" : "neg") : ""}`}
                      style={{ fontSize: 12 }}
                      title="Price move from entry to the average exit, before charges">
                    {isFinite(t.exitPct) ? signedPct(t.exitPct) : "—"}</td>
                  <td className={`num ${isFinite(t.pnl) ? (t.pnl >= 0 ? "pos" : "neg") : ""}`}>
                    {isFinite(t.pnl) ? rupee(t.pnl) : "—"}</td>
                  <td className={`num ${isFinite(t.r) ? (t.r >= 0 ? "pos" : "neg") : ""}`}
                      style={{ fontWeight: 500 }}>{isFinite(t.r) ? rfmt(t.r) : "—"}</td>
                  <td className="num" style={{ fontSize: 12 }}
                      title={isFinite(t.riskPct)
                        ? `${pct(t.riskPct, 2)} of the account — the 1R every R above divides by`
                        : "No stop, so no 1R to divide by"}>
                    {isFinite(t.riskAmt) ? rupee(t.riskAmt) : "—"}</td>
                  {/* Clickable when there is one: opens the trade, where the
                      chart is actually rendered. A count only shows past one,
                      since "1" beside every charted row is noise. */}
                  <td style={{ textAlign: "center" }}>
                    {charted.has(t.id) ? (
                      <button className="tr-chart" onClick={() => setDetailId(t.id)}
                              title={`${charted.get(t.id)} chart${charted.get(t.id) === 1 ? "" : "s"} — open ${t.symbol}`}>
                        <ImageIcon size={13} />
                        {charted.get(t.id) > 1 && <span>{charted.get(t.id)}</span>}
                      </button>
                    ) : (
                      <span style={{ color: "var(--rule)", fontSize: 11 }}>—</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--ink2)" }}>{t.pattern || "—"}</td>
                  <td className="num" style={{ fontSize: 12,
                        color: t.distPivot > 5 ? "var(--short)" : "inherit" }}>
                    {isFinite(t.distPivot) ? `${t.distPivot >= 0 ? "+" : ""}${t.distPivot.toFixed(1)}%` : "—"}</td>
                  <td className="num" style={{ fontSize: 12,
                        color: isFinite(num(t.vol_pct_avg)) && num(t.vol_pct_avg) < 100 ? "var(--short)" : "inherit" }}>
                    {t.vol_pct_avg ? `${t.vol_pct_avg}%` : "—"}</td>
                  <td className="num" style={{ fontSize: 12 }}>{t.weinstein_stage || "—"}</td>
                  <td className="num" style={{ fontSize: 12 }}>{t.rs_rank || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="x" onClick={() => onEdit(t)} aria-label="Edit"><Pencil size={13} /></button>
                    <button className="x" onClick={() => onDelete(t.id)} aria-label="Delete"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
            {/* 21 columns: 11 spanned here, P&L, R, then 8 spanned to the end.
                Get that sum wrong and the whole row slides out of line under
                the headers without anything erroring. */}
            <tfoot className="stick">
              <tr className="tr-tot">
                <td colSpan={11}>
                  <b>{totals.n}</b> {totals.n === 1 ? "trade" : "trades"} shown
                </td>
                <td className={`num ${totals.pnl >= 0 ? "pos" : "neg"}`}>
                  {rupee(totals.pnl)}
                </td>
                <td className={`num ${totals.r >= 0 ? "pos" : "neg"}`}
                    title={totals.withR < totals.n
                      ? `${totals.n - totals.withR} of these have no stop recorded, so no R`
                      : undefined}>
                  {totals.withR ? rfmt(totals.r, 1) : "—"}
                  {totals.withR > 0 && totals.withR < totals.n && (
                    <i className="tr-tot-sub">of {totals.withR}</i>
                  )}
                </td>
                <td colSpan={8}></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      {rows.length > 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          ▲ marks a trade where you tagged a mistake · ▾ marks a short · click a symbol to open it
          · click any column to sort
        </div>
      )}

      {detailAt >= 0 && (
        <PositionDetail
          row={rows[detailAt]}
          diary={diary}
          onAttachChart={onAttachChart}
          onRemoveChart={onRemoveChart}
          onClose={() => setDetailId(null)}
          onEdit={(t) => { setDetailId(null); onEdit(t); }}
          onExit={onExit ? (t) => { setDetailId(null); onExit(t); } : undefined}
          onDelete={async (t) => { setDetailId(null); await onDelete(t.id); }}
          // Steps through the list as filtered and sorted on screen, so the
          // order under the arrows is the order being looked at.
          onPrev={detailAt > 0 ? () => setDetailId(rows[detailAt - 1].id) : undefined}
          onNext={detailAt < rows.length - 1 ? () => setDetailId(rows[detailAt + 1].id) : undefined}
        />
      )}

      <style jsx>{`
        .tr-search { position: relative; width: 180px; }
        .tr-search .in {
          padding: 6px 28px 6px 10px; font-size: 13px;
        }
        /*
          Centred on the field rather than the text, and sized to the tap
          target rather than to the glyph — so it stays comfortable to hit
          while the mark itself stays small enough to read as punctuation
          instead of as a second control competing with CSV beside it.
        */
        .tr-clear {
          position: absolute; top: 50%; right: 4px; transform: translateY(-50%);
          display: flex; align-items: center; justify-content: center;
          width: 20px; height: 20px; padding: 0;
          background: none; border: 0; border-radius: 50%;
          color: var(--ink3); cursor: pointer;
          transition: color 120ms ease, background 120ms ease;
        }
        .tr-clear:hover { color: var(--ink); background: var(--rule); }
        .tr-clear:active { transform: translateY(-50%) scale(0.92); }
        .tr-chip {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          border-left: 2px solid var(--brass); padding: 7px 0 7px 10px;
          margin-bottom: 12px; font-size: 12.5px; color: var(--ink2);
        }
        .tr-chip b { font-weight: 500; color: var(--ink); }
        .tr-chip-n { color: var(--ink3); font-size: 11.5px; }
        .tr-tot td {
          border-top: 1px solid var(--ink3); border-bottom: 0;
          font-size: 12px; padding-top: 8px;
        }
        .tr-tot b { font-weight: 500; }
        /* Under the figure, not beside it — inline, it pushed a right-aligned
           column out of true with the R values above it. */
        .tr-tot-sub {
          display: block; font-style: normal; font-size: 10px;
          color: var(--ink3); margin-top: 1px;
        }
        .tr-chart {
          background: none; border: 0; padding: 2px 4px; cursor: pointer;
          color: var(--brass); display: inline-flex; align-items: center; gap: 3px;
          font: inherit; font-size: 11px;
        }
        .tr-chart:hover { color: var(--ink); }
        /* Reads as text until you go near it — a sheet of rows, not a list
           of links. Same affordance as the Holdings table. */
        .tr-sym {
          background: none; border: 0; padding: 0; cursor: pointer;
          font: inherit; color: inherit; text-align: left;
          border-bottom: 1px solid transparent;
        }
        .tr-sym:hover { border-bottom-color: var(--brass); }
        /* Small, but never absent. Reading an R off a stop this app invented
           without knowing that is the one mistake this column can cause. */
        .tr-stopedit { display: inline-flex; align-items: center; gap: 4px; }
        .tr-stopedit .in { width: 78px; padding: 3px 6px; font-size: 12px; text-align: right; }
        .tr-stopedit .tr-pctin { width: 52px; }
        .tr-stophint { font-style: normal; font-size: 11px; color: var(--ink3); }
        .tr-stoperr {
          display: block; font-style: normal; font-size: 10px;
          color: var(--short); text-align: right; margin-top: 2px;
          white-space: normal; max-width: 150px;
        }
        .tr-stopok {
          display: inline-flex; align-items: center; justify-content: center;
          width: 20px; height: 20px; padding: 0; border-radius: 3px;
          border: 1px solid var(--long); background: var(--long);
          color: var(--paper); cursor: pointer;
        }
        /* Quiet until the row is hovered: it sits on ninety-seven rows at
           once, and a full column of icons reads as a column of buttons
           rather than as an offer. Always visible where there is no hover. */
        .tr-stoppen {
          margin-left: 5px; padding: 0; border: 0; background: none;
          color: var(--ink3); cursor: pointer; vertical-align: middle;
          opacity: 0; transition: opacity 120ms;
        }
        tr:hover .tr-stoppen, .tr-stoppen:focus-visible { opacity: 1; }
        .tr-stoppen:hover { color: var(--brass); }
        @media (hover: none) { .tr-stoppen { opacity: 1; } }
        .tr-assumed {
          display: block; font-style: normal; font-size: 9px;
          letter-spacing: 0.06em; text-transform: uppercase; color: var(--brass);
        }
        /* Reads as a word rather than a price, because 0.00 in this column
           looks like a broken row and that is exactly the confusion that
           started all this. */
        /* An average of the sells so far reads as a final price unless it
           says otherwise, and a half-sold position's average is not where
           the trade ended. */
        .tr-part {
          display: block; font-style: normal; font-size: 9px;
          letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink3);
        }
        .tr-free {
          font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase;
          color: var(--ink3);
        }
      `}</style>
    </div>
  );
}
