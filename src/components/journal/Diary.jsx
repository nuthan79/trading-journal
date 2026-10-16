"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, Trash2, Link2, Check, Pencil, Search, ChevronDown, ArrowUp } from "lucide-react";
import { chartUrl } from "@/lib/db";
import ChartViewer from "./ChartViewer";
import { resolveTradingViewChart } from "@/lib/charts";
import { rfmt, dmy, today } from "@/lib/format";
import { EMOTIONS } from "@/lib/constants";
import { useAutosave, loadDraft, DRAFT_KEYS } from "@/lib/useAutosave";
import { filterDiary, monthsOf, emotionsOf, monthLabel, fullDate } from "@/lib/diaryList";
import { SHOW_LAST_TIME_ENTRIES } from "@/lib/flags";
import { lastTime, recallList, moreLabel } from "@/lib/diaryLastTime";
import { dayIndex, dayFacts } from "@/lib/diaryDay";
import { yearMap, cellTone, cellOn, hashDate } from "@/lib/diaryYear";
import { useRegimeHistory } from "@/lib/useRegimeHistory";
import { regimeIndex, REGIME_LABEL, REGIME_LABEL_FOR } from "@/lib/market";
import { level } from "@/components/MarketStrip";
import Money from "@/components/Money";

/**
 * ENTRIES ARE EDITABLE, AND SAY SO.
 *
 * This was read-only-after-save for a long time, which sounds like integrity —
 * a diary you can rewrite is worth less than one you can't — except that the
 * Delete button was already there. Delete and retype achieves a rewrite while
 * losing the date, the emotions and the chart, so the rule cost the careful
 * user everything and the careless one nothing. Editing is allowed, and an
 * edited entry carries a stamp set by a database trigger rather than by this
 * file (024_diary_edited.sql): a marker the client sets is a marker the client
 * can forget to set, and the absence of one reads as a guarantee.
 *
 * THE REASON IT MATTERS is not typos. `trade_id` could only ever be set at the
 * moment of writing, and the useful order is the other one — you write about a
 * stock while it is still a watchlist chart, and days later it sets up and you
 * buy it. The trade does not exist yet when the note is written, so the link
 * that the trade panel, the Trades chart column and the mood analysis all read
 * could never be made for exactly the entries that most deserved it. Editing
 * is what joins the thought you had then to the position you took later.
 */
function newDraft() {
  return {
    id: null,
    entry_date: today(),
    emotions: [], body: "", trade_id: "",
    imagePath: null,
    linkOpen: false, linkInput: "", linkError: "",
  };
}

/**
 * An existing entry, opened for editing.
 *
 * `imagePath` is what is STORED, which is not always what is shown. A pasted
 * TradingView link is its own URL and the two are the same; a chart uploaded
 * back when uploads existed is a path inside the bucket whose viewing URL is
 * signed and expires in an hour. Holding the stored value here and resolving
 * the display separately is what stops a save writing a short-lived signed URL
 * over a permanent path — which would look fine until the link died.
 */
function editDraft(e) {
  return {
    id: e.id,
    entry_date: e.entry_date,
    emotions: [...(e.emotions || [])],
    body: e.body || "",
    trade_id: e.trade_id || "",
    imagePath: e.image_path || null,
    linkOpen: false, linkInput: "", linkError: "",
  };
}

// A pasted link is just text, so the whole draft survives a reload. This used
// to carry a File and a blob: URL for uploaded images, neither of which could
// be persisted — one more thing that got simpler when uploads went away.
function serializeDraft(d) {
  if (!d) return null;
  return {
    id: d.id || null,
    entry_date: d.entry_date,
    emotions: d.emotions,
    body: d.body,
    trade_id: d.trade_id,
    imagePath: d.imagePath || null,
  };
}

function hasContent(payload) {
  return !!payload && (payload.body?.trim() || payload.emotions?.length || payload.imagePath);
}

function hydrateDraft(p) {
  return {
    id: p.id || null,
    entry_date: p.entry_date || today(),
    emotions: Array.isArray(p.emotions) ? p.emotions : [],
    body: p.body || "",
    trade_id: p.trade_id || "",
    imagePath: p.imagePath || null,
    linkOpen: false, linkInput: "", linkError: "",
  };
}

/**
 * The date an entry was last edited, in the reader's own timezone.
 *
 * dmy() takes the first ten characters of an ISO string, which is right for
 * the DATE column it was written for and wrong for a timestamptz: updated_at
 * comes back in UTC, so an edit made at half past midnight in India would
 * render as the day before. Convert first, then format.
 */
function editedOn(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return dmy(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
}

export default function Diary({ diary, trades, closed = [], onSave, onDelete, onRemoveChart, say }) {
  const [draft, setDraft] = useState(null);
  /**
   * Which chart the viewer is on, as an index into `shots` below.
   *
   * Every entry that has a resolved image, in the order they are listed — so
   * paging in the viewer walks the diary the way the page reads, rather than
   * being trapped inside one entry.
   */
  const [zoom, setZoom] = useState(null);
  const [urls, setUrls] = useState({});
  const [saving, setSaving] = useState(false);
  const restoredRef = useRef(false);

  /*
   * READABLE AT A YEAR'S SCALE. Every entry rendered in full with its chart at
   * full width was fine at three and unreadable at a hundred. So an entry is
   * collapsed to what identifies it — the day, the feelings, the trade, two
   * lines of the note, a thumbnail — and opens in place; and the list can be
   * searched and filtered by feeling and month.
   */
  const [q, setQ] = useState("");
  const [emotion, setEmotion] = useState("");
  const [month, setMonth] = useState("");
  const [open, setOpen] = useState(() => new Set());
  const toggleOpen = (id) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const shown = filterDiary(diary || [], { q, emotion, month });

  /*
   * THE DAY STRIP — what each entry's day actually was, beside what was
   * written about it: the regime index's close, move and regime, what was
   * held, bought, closed and banked. Built from data already here (see
   * lib/diaryDay.js); the index history is the one the Process tab loads,
   * through the same hook and the same session cache.
   */
  const regime = useRegimeHistory(diary.length > 0);
  const regimes = useMemo(
    () => (regime.classified.length ? regimeIndex(regime.classified) : null),
    [regime.classified],
  );
  const days = useMemo(() => dayIndex(trades || []), [trades]);

  /*
   * THE YEAR MAP. A year of trading days above the list — the index's own
   * calendar when it has loaded, weekdays until then — coloured by what each
   * day realised, marked where something was written. See lib/diaryYear.js.
   */
  const year = useMemo(() => yearMap({
    today: today(),
    tradingDays: regimes ? new Set(regimes.dates) : null,
    idx: days,
    entries: diary || [],
  }), [regimes, days, diary]);

  /* A day on the map opens its entry: filters cleared so it is in the list,
     opened, and scrolled to — clear of the sticky header.

     SCROLLED AFTER THE RENDER, NOT DURING IT, AND NOT SMOOTHLY. A smooth
     scroll started in the same tick as the entry opening, across a year of
     entries whose thumbnails are still loading, stopped where the target WAS
     — on a real book, at July for a December entry. So the jump waits for
     the list to render with the entry open, lands instantly, and corrects
     once more after images have had a moment to take their height. */
  const [jump, setJump] = useState(null);
  const openEntry = (id) => {
    if (!id) return;
    setQ(""); setEmotion(""); setMonth("");
    setOpen((prev) => new Set(prev).add(id));
    setJump(id);
  };
  /* Every past day on the map does the obvious thing for that day: opens
     what was written on it, or starts an entry dated it. The footer counts
     the days traded with nothing written; a click is how one stops counting. */
  /* …and a day picked is a URL. The hash is set here and not in openEntry,
     which the "Last time" card's links also call and which should not
     rewrite the address. Back then pops the day and the browser restores
     the scroll it left; /diary#d-2026-08-14 is a link a trade note can hold. */
  const appliedHash = useRef(null);
  const jumpTo = (cell) => {
    appliedHash.current = cell.date;
    if (typeof window !== "undefined") window.location.hash = `d-${cell.date}`;
    return cell.entries.length ? openEntry(cell.entries[0].id)
                               : writeOn(cell.date);
  };

  /*
   * LAST TIME — the reason the diary is kept. On a losing run, what was
   * written during the last run like it, and how that one ended. One rule,
   * counted the way the Process tab's losing-run card counts it; see
   * lib/diaryLastTime.js.
   */
  const recall = useMemo(() => lastTime(closed || [], diary || []), [closed, diary]);

  /* BACK TO TOP, once there is a top to go back to, and saying where you
     are. A year of entries runs to five screens; past the first, a pill under
     the column — not tucked into the window's corner — names the month of the
     entry at the top of the view and takes you back up in one press. Hidden
     above that, where it would be a button for going nowhere. */
  const [showTop, setShowTop] = useState(false);
  const [here, setHere] = useState("");
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      setShowTop(window.scrollY > window.innerHeight);
      /* The first entry still showing below everything sticky. */
      const edge = (document.querySelector(".dy-find")?.getBoundingClientRect().bottom || 0) + 8;
      const at = [...document.querySelectorAll(".dy-entry")].find((el) => el.getBoundingClientRect().bottom > edge);
      setHere(at?.dataset.date ? monthLabel(at.dataset.date.slice(0, 7)) : "");
    };
    const on = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    window.addEventListener("scroll", on, { passive: true });
    return () => { window.removeEventListener("scroll", on); if (frame) cancelAnimationFrame(frame); };
  }, []);
  const toTop = () => {
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
  };

  /* The hash, on first paint and on every later change, resolved through
     the map (cellOn) so a weekend's entry finds the session it was rolled
     onto. An empty hash is a no-op, not a reset — that is a Back press, and
     the browser is already restoring the scroll. The ref skips the hash
     jumpTo has just set, which it has already acted on. */
  useEffect(() => {
    const apply = () => {
      const d = hashDate(window.location.hash);
      if (!d || d === appliedHash.current) return;
      const c = cellOn(year, d);
      if (c) jumpTo(c);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [year]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!jump) return undefined;
    const go = () => document.getElementById(`dy-${jump}`)?.scrollIntoView({ block: "start" });
    const el = document.getElementById(`dy-${jump}`);
    go();
    el?.classList.add("dy-hit");
    const again = setTimeout(go, 400);
    const unmark = setTimeout(() => { el?.classList.remove("dy-hit"); setJump(null); }, 1600);
    return () => { clearTimeout(again); clearTimeout(unmark); };
  }, [jump]);
  const filtering = !!(q.trim() || emotion || month);

  useEffect(() => {
    diary.forEach((e) => {
      if (e.image_path && !urls[e.id]) {
        chartUrl(e.image_path).then((url) => {
          if (url) setUrls((p) => ({ ...p, [e.id]: url }));
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diary]);

  /**
   * Restore an in-progress draft left behind by a cold-reload (mobile
   * backgrounding, tab discard) before it can be lost for good.
   *
   * A draft carrying an id is unsaved changes to an entry, and that entry may
   * be gone — deleted from another tab, or from this one before the reload.
   * Restoring it would hand back a form whose save is an upsert on a row that
   * no longer exists, and an upsert with a missing id inserts: the deleted
   * entry would quietly come back. So an edit draft waits for the diary to
   * arrive and is only restored if its row is still there. A new-entry draft
   * has nothing to check against and restores immediately, as it always did.
   */
  useEffect(() => {
    if (restoredRef.current) return;
    const p = loadDraft(DRAFT_KEYS.diary);
    if (!hasContent(p)) { restoredRef.current = true; return; }
    if (p.id) {
      if (!diary.length) return;                       // not loaded yet — try again
      if (!diary.some((e) => e.id === p.id)) { restoredRef.current = true; return; }
    }
    restoredRef.current = true;
    setDraft(hydrateDraft(p));
    say(p.id ? "Restored unsaved changes to an entry." : "Restored an unsaved diary entry.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diary]);

  const serialized = draft ? serializeDraft(draft) : null;
  const { clear: clearPersistedDraft } = useAutosave(
    DRAFT_KEYS.diary,
    hasContent(serialized) ? serialized : null
  );

  /**
   * What the viewer shows, and what it calls each one.
   *
   * The title has to answer "what am I looking at", and in the diary that is
   * not the same answer every time. An entry written against a trade is about
   * that trade and says so; an entry that is a chart and nothing else is just
   * a chart somebody kept, and pretending otherwise would be inventing a link
   * that is not in the data.
   */
  /* Over what is SHOWN: paging the viewer walks the list as filtered, so a
     search for one stock pages through that stock's charts, not every one. */
  const shots = shown
    .filter((e) => e.image_path && urls[e.id])
    .map((e) => {
      const t = trades.find((x) => x.id === e.trade_id);
      return {
        id: e.id,
        src: urls[e.id],
        entry: e,
        title: t ? `${t.symbol} — diary entry` : "Diary entry",
        sub: [dmy(e.entry_date), t ? null : e.body?.trim() ? null : "chart only"]
          .filter(Boolean).join(" · "),
      };
    });

  // What the draft's chart looks like right now: a pasted link is already a
  // URL, an older uploaded chart is a bucket path that has to be signed. See
  // editDraft() for why the draft holds the path rather than this.
  const draftSrc = !draft?.imagePath ? null
    : /^https?:\/\//i.test(draft.imagePath) ? draft.imagePath
    : urls[draft.id] || null;

  const removeImage = () => setDraft((p) => ({ ...p, imagePath: null }));

  const openLink = () => setDraft((p) => ({ ...p, linkOpen: true, linkInput: "", linkError: "" }));

  const useLink = () => {
    const result = resolveTradingViewChart(draft.linkInput);
    if (!result.ok) {
      setDraft((p) => ({ ...p, linkError: result.error }));
      return;
    }
    setDraft((p) => ({
      ...p, imagePath: result.url, linkOpen: false, linkInput: "", linkError: "",
    }));
  };

  const startEdit = (e) => {
    // Only a NEW draft can be lost by this — an edit draft holds nothing that
    // isn't still in the entry underneath it.
    if (draft && !draft.id && hasContent(serializeDraft(draft)) &&
        !window.confirm("You have an unsaved new entry. Opening this one for editing will discard it.")) return;
    setDraft(editDraft(e));
    // The form is at the top and the entry being edited may be a long way
    // down; without this the button appears to do nothing.
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /* A new entry dated a day picked off the map — startEdit's rule exactly,
     confirm included: a new draft with something in it is the one thing a
     click here can destroy. The filters stay: nothing is being found in the
     list, so clearing them would throw away the reader's view for nothing. */
  const writeOn = (date) => {
    if (draft && !draft.id && hasContent(serializeDraft(draft)) &&
        !window.confirm(`You have an unsaved new entry. Writing about ${dmy(date)} will discard it.`)) return;
    setDraft({ ...newDraft(), entry_date: date });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const discard = () => {
    clearPersistedDraft();
    setDraft(null);
  };

  const commit = async () => {
    if (!draft.body.trim() && !draft.imagePath) { say("Write something or paste a chart link first."); return; }
    setSaving(true);
    try {
      await onSave({
        // Only on an edit. A null id would be sent as null rather than left to
        // the column default, and the insert would fail on a not-null primary
        // key.
        ...(draft.id ? { id: draft.id } : {}),
        entry_date: draft.entry_date,
        emotions: draft.emotions,
        body: draft.body,
        trade_id: draft.trade_id || null,
        // Always sent, so that clearing the chart on an edit actually clears
        // it. Omitting the key would leave the old path in place.
        image_path: draft.imagePath || null,
      });
      clearPersistedDraft();
      setDraft(null);
    } finally {
      setSaving(false);
    }
  };

  const toggleEmotion = (em) => setDraft((p) => ({
    ...p, emotions: p.emotions.includes(em) ? p.emotions.filter((x) => x !== em) : [...p.emotions, em],
  }));

  return (
    <div className="sec">
      {showTop && (
        <button type="button" className="dy-top" onClick={toTop}
                aria-label={here ? `Back to top — you are in ${here}` : "Back to top"}>
          <ArrowUp size={13} /><span>Top</span>
          {here && <span className="dy-top-here">{here}</span>}
        </button>
      )}
      {zoom != null && shots.length > 0 && (
        <ChartViewer
          shots={shots}
          index={zoom}
          onIndex={setZoom}
          onClose={() => setZoom(null)}
          onRemove={onRemoveChart ? (sh) => onRemoveChart(sh.entry) : undefined}
        />
      )}

      <div className="sechead">
        <div>
          <div className="eyebrow">Diary</div>
          <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3 }}>
            What you felt, what the market was doing, and the chart in front of you.
          </div>
        </div>
        {!draft && <button className="btn" onClick={() => setDraft(newDraft())}><Plus size={14} />New entry</button>}
      </div>

      {draft && (
        <div className="card" style={{ marginBottom: 18 }}>
          {/*
            * SAVE AND CANCEL AT THE TOP, not under the form.
            *
            * A diary entry with a chart on it is about fifteen hundred pixels
            * tall, nearly all of it the chart. Buttons after that are a long
            * scroll past the thing being read from the thing being written —
            * the note is typed in a box near the top and the save sat off the
            * bottom of the screen.
            *
            * The card gets a proper header to hold them, which a new entry
            * never had: the eyebrow only appeared when editing, so a fresh
            * draft opened with no heading at all.
            */}
          <div style={{ display: "flex", justifyContent: "space-between",
                        alignItems: "center", gap: 12, flexWrap: "wrap",
                        marginBottom: 14 }}>
            <div className="eyebrow">
              {draft.id ? `Editing the entry from ${dmy(draft.entry_date)}` : "New entry"}
            </div>
            <div style={{ display: "flex", gap: 10, flex: "none" }}>
              <button className="btn ghost" onClick={discard}>{draft.id ? "Cancel" : "Discard"}</button>
              <button className="btn" disabled={saving} onClick={commit}>
                <Check size={14} />
                {saving ? "Saving…" : draft.id ? "Save changes" : "Save entry"}
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <label className="f"><span>Date</span>
              <input className="in" type="date" value={draft.entry_date}
                     onChange={(e) => setDraft((p) => ({ ...p, entry_date: e.target.value }))} /></label>
            <label className="f" style={{ flex: 1, minWidth: 200 }}><span>Attach to a trade (optional)</span>
              {/* The point of editing, more than typos: a note written while
                  the stock was still a watchlist chart gets tied to the trade
                  once you actually take it. `trades` arrives newest-first, so
                  a position entered this week is at the top of the list. */}
              <select className="in" value={draft.trade_id}
                      onChange={(e) => setDraft((p) => ({ ...p, trade_id: e.target.value }))}>
                <option value="">Not tied to one trade</option>
                {trades.map((t) => (
                  <option key={t.id} value={t.id}>{t.symbol} · {t.entry_date}</option>
                ))}
              </select></label>
          </div>
          {/* What the day was, from what the book already knows — what makes
              an entry written three weeks later worth writing. Read off the
              date field, so changing the date re-reads the day; a day the
              book knows nothing about renders nothing. */}
          <div style={{ margin: "-6px 0 14px" }}>
            <DayStrip facts={dayFacts(draft.entry_date, days, regimes)}
                      indexLabel={REGIME_LABEL_FOR[regime.indexName] || regime.indexName} />
          </div>

          <div className="eyebrow" style={{ marginBottom: 8 }}>How you were feeling</div>
          <div className="chips" style={{ marginBottom: 14 }}>
            {EMOTIONS.map((em) => (
              <button key={em} className="chip" data-on={draft.emotions.includes(em) ? 1 : 0}
                      onClick={() => toggleEmotion(em)}>{em}</button>
            ))}
          </div>

          <textarea className="in" rows={7} value={draft.body}
            onChange={(e) => setDraft((p) => ({ ...p, body: e.target.value }))}
            placeholder="What happened today. What you did and why. What you would do differently." />

          {draft.imagePath && (
            <div style={{ marginTop: 12 }}>
              {draftSrc && (
                <img src={draftSrc} alt="Attached chart"
                     style={{ maxWidth: "100%", border: "1px solid var(--rule)", borderRadius: 2 }} />
              )}
              <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={removeImage}>
                <X size={12} />Remove chart
              </button>
            </div>
          )}

          {draft.linkOpen && (
            <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
              <input className="in" style={{ flex: 1, minWidth: 220 }}
                     placeholder="https://www.tradingview.com/x/…"
                     value={draft.linkInput}
                     onChange={(e) => setDraft((p) => ({ ...p, linkInput: e.target.value, linkError: "" }))}
                     onKeyDown={(e) => e.key === "Enter" && useLink()} />
              <button className="btn ghost sm" onClick={useLink}>Use link</button>
              <button className="btn ghost sm"
                      onClick={() => setDraft((p) => ({ ...p, linkOpen: false, linkError: "" }))}>Cancel</button>
              {draft.linkError && (
                <div style={{ width: "100%", fontSize: 11.5, color: "var(--short)" }}>{draft.linkError}</div>
              )}
            </div>
          )}

          {/* Only the chart action is left down here, and it stays because it
              is the one button that acts on what it sits beside. Save and
              cancel act on the whole entry and live in the header. */}
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            {/* Links only. An uploaded PNG of a 4000px chart is around 800KB
                in Storage and comes out of your egress every time anyone
                looks at it; the same chart as a TradingView snapshot link is
                51 bytes of text and is served by TradingView. Entries that
                already hold an uploaded file still render — chartUrl signs a
                Storage path and passes a URL straight through. */}
            <button className="btn ghost" onClick={openLink}>
              <Link2 size={13} />{draft.imagePath ? "Replace chart link" : "Paste chart link"}
            </button>
          </div>
        </div>
      )}

      {diary.length === 0 && !draft ? (
        <div className="card empty">
          <div className="eyebrow">Nothing written yet</div>
          <p>The trade sheet records what you did. This records why. Over a year the
            second one usually explains the first.</p>
          <button className="btn" onClick={() => setDraft(newDraft())}><Plus size={14} />Write the first entry</button>
        </div>
      ) : (
        <>
        {recall && <LastTime recall={recall} open={openEntry} />}

        <YearMap year={year} jump={jumpTo} />

        {/* Find an entry. Only feelings and months that occur are offered, so
            no choice in either menu filters to nothing. */}
        <div className="dy-find">
          <label className="dy-q">
            <Search size={13} />
            <input className="in" placeholder="Search what you wrote" value={q}
                   onChange={(ev) => setQ(ev.target.value)} aria-label="Search the diary" />
          </label>
          <select className="in dy-sel" value={emotion} onChange={(ev) => setEmotion(ev.target.value)}
                  aria-label="Filter by feeling">
            <option value="">Every feeling</option>
            {emotionsOf(diary || [], EMOTIONS).map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select className="in dy-sel" value={month} onChange={(ev) => setMonth(ev.target.value)}
                  aria-label="Filter by month">
            <option value="">Every month</option>
            {monthsOf(diary || []).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <span className="dy-count">
            {/* "1 of 44 entries" — the noun goes with the total, not the match. */}
            {filtering ? `${shown.length} of ` : ""}{diary.length} entr{diary.length === 1 ? "y" : "ies"}
          </span>
          {filtering && (
            <button className="btn ghost sm" onClick={() => { setQ(""); setEmotion(""); setMonth(""); }}>
              <X size={12} />Clear
            </button>
          )}
        </div>

        {filtering && shown.length === 0 && (
          <div className="dy-none">Nothing written matches that — try fewer words, or another month.</div>
        )}

        {shown.map((e) => {
          const t = trades.find((x) => x.id === e.trade_id);
          const edited = editedOn(e.updated_at);
          // The copy underneath the form it is loaded into. Left in place
          // rather than hidden — it is what the entry looked like before —
          // but dimmed, so two versions of the same note on one screen can be
          // told apart at a glance.
          const isEditing = draft?.id === e.id;
          const expanded = open.has(e.id);
          /* A click anywhere on the entry that is not a control opens or
             closes it. The keyboard's way in is the chevron button — the
             entry is not itself a button, since it holds three real ones
             and a screen reader could not tell them apart. */
          const onEntry = (ev) => {
            if (ev.target.closest("button, a, input, select, textarea")) return;
            toggleOpen(e.id);
          };
          return (
            <div key={e.id} id={`dy-${e.id}`} className="entry dy-entry" data-open={expanded ? 1 : 0}
                 data-date={e.entry_date}
                 style={isEditing ? { opacity: 0.45 } : undefined}
                 onClick={onEntry}>
              {/* One row: what the entry is on the left, its chart and the
                  controls on the right. A chart-only entry is then a single
                  compact line instead of a thumbnail under an empty left half. */}
              <div className="dy-row">
                <div className="dy-text">
                  <div className="mono" style={{ fontSize: 12, color: "var(--ink2)" }}>{e.entry_date}</div>
                  {t && (
                    <div style={{ fontSize: 11, color: "var(--brass)", marginTop: 3 }}>
                      on {t.symbol} · {isFinite(t.r) ? rfmt(t.r) : "still open"}
                    </div>
                  )}
                  {edited && (
                    <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 3 }}>edited {edited}</div>
                  )}
                  {(e.emotions || []).length > 0 && (
                    <div className="chips" style={{ marginTop: 9 }}>
                      {e.emotions.map((x) => <span key={x} className="chip">{x}</span>)}
                    </div>
                  )}
                  <DayStrip facts={dayFacts(e.entry_date, days, regimes)}
                            indexLabel={REGIME_LABEL_FOR[regime.indexName] || regime.indexName} />
                  {/* Two lines while collapsed, the whole note when open. */}
                  {e.body && <p className="body dy-body">{e.body}</p>}
                </div>
                {/* The chart stays a thumbnail open or shut — full size is
                    the viewer's job. */}
                {e.image_path && urls[e.id] && (
                  <button className="dy-thumb" title="Open the chart full size"
                          onClick={() => setZoom(shots.findIndex((x) => x.id === e.id))}>
                    <img src={urls[e.id]} alt="Chart from this entry" />
                  </button>
                )}
                {!isEditing && (
                  <div style={{ display: "flex", gap: 2, flex: "none", alignItems: "center" }}>
                    <button className="x dy-chev" onClick={() => toggleOpen(e.id)}
                            aria-expanded={expanded}
                            aria-label={expanded ? "Show less of this entry" : "Show all of this entry"}
                            title={expanded ? "Show less" : "Show all"}>
                      <ChevronDown size={13} />
                    </button>
                    <button className="x" onClick={() => startEdit(e)} aria-label="Edit entry"
                            title="Edit this entry">
                      <Pencil size={13} />
                    </button>
                    <button className="x" onClick={() => onDelete(e)} aria-label="Delete entry"
                            title="Delete this entry">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        </>
      )}
    </div>
  );
}

const REGIME_TONE = { uptrend: "var(--long)", pressure: "var(--brass)", correction: "var(--short)" };
const signed = (v, dp = 2) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(dp)}`;
const tone = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");

/**
 * One quiet line of what the day was. Parts that do not apply are absent —
 * see lib/diaryDay.js — so a Saturday shows no index and a flat day no "0".
 * Rendered by a child, so its styles are global under the dy-day prefix.
 */
function DayStrip({ facts, indexLabel }) {
  const parts = [];
  if (facts.index) {
    const x = facts.index;
    parts.push(
      <span key="ix">
        {x.regime && <span className="dy-day-dot" style={{ background: REGIME_TONE[x.regime] }}
                           title={REGIME_LABEL[x.regime]} />}
        {indexLabel} {level(x.close)}
        {x.movePct != null && <> <span className={tone(x.movePct)}>{signed(x.movePct)}%</span></>}
        {x.regime && <> · {REGIME_LABEL[x.regime]}</>}
      </span>
    );
  }
  if (facts.open) parts.push(<span key="op">{facts.open} open</span>);
  if (facts.entered) {
    const shown = facts.entered.slice(0, 3).join(", ");
    parts.push(<span key="in">bought {shown}{facts.entered.length > 3 ? ` +${facts.entered.length - 3}` : ""}</span>);
  }
  if (facts.closed) {
    parts.push(
      <span key="out">
        closed {facts.closed.slice(0, 3).map((c, i) => (
          <span key={i}>{i ? ", " : ""}{c.symbol}
            {c.r != null && <> <span className={tone(c.r)}>{signed(c.r)}R</span></>}</span>
        ))}{facts.closed.length > 3 ? ` +${facts.closed.length - 3}` : ""}
      </span>
    );
  }
  if (facts.banked != null) {
    parts.push(<span key="bk">realised <span className={tone(facts.banked)}><Money v={facts.banked} /></span></span>);
  }
  if (!parts.length) return null;
  return (
    <div className="dy-day">
      {parts.map((p, i) => <span key={i} className="dy-day-part">{i > 0 && <span className="dy-day-sep">·</span>}{p}</span>)}
      <style jsx global>{`
        .dy-day { margin-top: 7px; font-size: 11.5px; color: var(--ink3); line-height: 1.6;
                  display: flex; flex-wrap: wrap; column-gap: 0; font-variant-numeric: tabular-nums; }
        .dy-day-part { white-space: nowrap; }
        .dy-day-sep { margin: 0 7px; color: var(--rule); }
        .dy-day-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%;
                      margin-right: 5px; vertical-align: 1px; }
        .dy-day .pos { color: var(--long); }
        .dy-day .neg { color: var(--short); }
      `}</style>
    </div>
  );
}

/**
 * The year at a glance: a column per week, Monday to Friday, a cell per day
 * the market was open. Rendered by a child, so global styles under dy-ym.
 */
function YearMap({ year, jump }) {
  const { cols, months, stats } = year;
  if (!cols.length) return null;
  const tip = (c) => {
    const bits = [dmy(c.date)];
    if (c.r != null) bits.push(`${c.r > 0 ? "+" : c.r < 0 ? "−" : ""}${Math.abs(c.r).toFixed(2)}R realised`);
    else if (c.traded) bits.push("traded, nothing sold");
    /* Every hover ends with what the click does, because every cell clicks. */
    if (c.entries.length) {
      if (!c.traded) bits.push("no trades");
      const off = c.entries.find((x) => x.written !== c.date);
      bits.push(off ? `entry written ${dmy(off.written)} — click to open` : "entry — click to open");
    } else bits.push(c.traded ? "nothing written — click to write" : "no trades — click to write");
    return bits.join(" · ");
  };
  return (
    <div className="dy-ym">
      <div className="dy-ym-months" style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
        {months.map((m) => (
          <span key={m.ym} style={{ gridColumn: `${m.col + 1} / span 4` }}>{monthLabel(m.ym).slice(0, 3)}</span>
        ))}
      </div>
      <div className="dy-ym-grid" style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
        {cols.map((col, ci) => col.map((c, ri) => {
          if (!c) return <span key={`${ci}-${ri}`} className="dy-ym-gap" style={{ gridColumn: ci + 1, gridRow: ri + 1 }} />;
          const t = cellTone(c);
          const bg = t.kind === "gain" ? `color-mix(in srgb, var(--long) ${Math.round(25 + t.strength * 75)}%, transparent)`
            : t.kind === "loss" ? `color-mix(in srgb, var(--short) ${Math.round(25 + t.strength * 75)}%, transparent)`
            : t.kind === "traded" ? "var(--grid)" : undefined;
          /* Every day is a button: one with an entry opens it, one without
             starts an entry dated it — traded or not, since "stood aside" is
             an entry too. */
          return (
            <button key={c.date} type="button" className="dy-ym-cell" data-kind={t.kind}
                    data-note={c.entries.length ? 1 : 0}
                    style={{ gridColumn: ci + 1, gridRow: ri + 1, background: bg }}
                    title={tip(c)} onClick={() => jump(c)} aria-label={tip(c)} />
          );
        }))}
      </div>
      <div className="dy-ym-foot">
        <span><i className="dy-ym-key" style={{ background: "color-mix(in srgb, var(--short) 75%, transparent)" }} />loss</span>
        <span><i className="dy-ym-key" style={{ background: "var(--grid)" }} />traded, nothing sold</span>
        <span><i className="dy-ym-key" style={{ background: "color-mix(in srgb, var(--long) 75%, transparent)" }} />gain</span>
        <span><i className="dy-ym-key dy-ym-key-note" />entry written</span>
        <span className="dy-ym-stat">
          {stats.traded} day{stats.traded === 1 ? "" : "s"} traded this year · {stats.written} with an entry
          {stats.tradedUnwritten > 0 && <> · <b>{stats.tradedUnwritten} traded and nothing written</b></>}
        </span>
      </div>
      <style jsx global>{`
        .dy-ym { margin: 4px 0 16px; padding: 14px 16px 12px; background: var(--card);
                 border: 1px solid var(--rule); border-radius: 3px; }
        .dy-ym-months, .dy-ym-grid { display: grid; column-gap: 3px; }
        .dy-ym-months { font-size: 10px; color: var(--ink3); margin-bottom: 4px; }
        .dy-ym-months span { white-space: nowrap; }
        .dy-ym-grid { grid-template-rows: repeat(5, auto); row-gap: 3px; }
        .dy-ym-cell, .dy-ym-gap { display: block; aspect-ratio: 1; border-radius: 2px; min-width: 0; }
        .dy-ym-cell { border: 1px solid var(--rule); padding: 0; background: transparent; position: relative;
                      cursor: pointer; }
        .dy-ym-cell[data-kind="gain"], .dy-ym-cell[data-kind="loss"] { border-color: transparent; }
        /* The entry mark: a dot in the cell, dark enough to read on any shade. */
        .dy-ym-cell[data-note="1"]::after {
          content: ""; position: absolute; inset: 0; margin: auto; width: 34%; height: 34%;
          border-radius: 50%; background: var(--ink);
        }
        .dy-ym-cell:hover, .dy-ym-cell:focus-visible { outline: 2px solid var(--brass); outline-offset: 1px; }
        .dy-ym-foot { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center;
                      margin-top: 10px; font-size: 11px; color: var(--ink3); }
        .dy-ym-key { display: inline-block; width: 10px; height: 10px; border-radius: 2px;
                     margin-right: 5px; vertical-align: -1px; border: 1px solid var(--rule); }
        .dy-ym-key-note { position: relative; background: transparent; }
        .dy-ym-key-note::after { content: ""; position: absolute; inset: 0; margin: auto;
                                 width: 4px; height: 4px; border-radius: 50%; background: var(--ink); }
        .dy-ym-stat { margin-left: auto; }
        .dy-ym-stat b { color: var(--ink2); font-weight: 600; }
        /* The entry a day was clicked through to, for a moment. */
        .dy-entry.dy-hit { outline: 2px solid var(--brass); outline-offset: 2px; transition: outline-color 0.6s; }
      `}</style>
    </div>
  );
}

/**
 * "Last time": the run you are on, the last one like it, and what you wrote
 * while it lasted. A child, so its styles are global under dy-lt.
 */
function LastTime({ recall, open }) {
  const { now, then, match, entries } = recall;
  /* Only the entry list folds; the headline above it is the card. */
  const [more, setMore] = useState(false);
  const list = recallList(entries);
  const fold = moreLabel(list);
  const day = (g) => (
    <li key={g.date} className="dy-lt-day">
      <span className="mono">{dmy(g.date)}</span>
      <div className="dy-lt-items">
        {g.entries.map((e) => (
          <button key={e.id} className="dy-lt-item" onClick={() => open(e.id)}
                  title="Open this entry in the list below">
            {(e.emotions || []).length > 0 && <span className="dy-lt-feel">{e.emotions.join(", ")}</span>}
            {(e.body || "").trim() && <span className="dy-lt-body">{e.body.trim().split("\n")[0]}</span>}
          </button>
        ))}
      </div>
    </li>
  );
  const R = (r) => `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}R`;
  return (
    <div className="dy-lt">
      <div className="eyebrow">Last time</div>
      <p className="dy-lt-now">
        You&rsquo;re on a run of <b>{now.n} losing entries</b>, since {fullDate(now.from)}.
        {then ? (
          <>{match === "longest"
              ? <> Nothing earlier ran this long — the longest before this was <b>{then.n} in a row</b></>
              : <> The last run like it was <b>{then.n} in a row</b></>}, {fullDate(then.from)} to {fullDate(then.to)}
            {then.endedBy && (
              <>, ended by {then.endedBy.symbol} on {fullDate(then.endedBy.date)}
                {then.endedBy.r != null && <> (<span className="pos">{R(then.endedBy.r)}</span>)</>}</>
            )}.</>
        ) : (
          <> Nothing earlier in the book ran this long, so there is no run to look back at.</>
        )}
      </p>
      {/* The words lead: at most three entries with text or a mood, newest
          first, a day to a row. An entry with neither is never a row of its
          own, open or shut — only the count on the fold line. And when the
          whole run was silent, that is the observation, said in one line. */}
      {/* Hidden — see SHOW_LAST_TIME_ENTRIES in flags.js. */}
      {SHOW_LAST_TIME_ENTRIES && then && (list.shown.length ? (
        <>
          <div className="dy-lt-h">What you wrote while it lasted</div>
          <ul className="dy-lt-list">
            {list.shown.map(day)}
            {more && list.more.map(day)}
          </ul>
          {fold && (list.moreWorded > 0 ? (
            <button className="dy-lt-more" onClick={() => setMore((m) => !m)} aria-expanded={more}>
              <span className="dy-chev"><ChevronDown size={13} /></span>
              {/* Open, the silent ones are all that is left unshown. */}
              {more ? (moreLabel({ ...list, moreWorded: 0 }) || "Show less") : fold}
            </button>
          ) : (
            <p className="dy-lt-more" data-static="1">{fold}</p>
          ))}
        </>
      ) : list.unworded ? (
        <p className="dy-lt-none">
          Nothing written during that run
          {list.charts ? `, ${list.charts} chart${list.charts === 1 ? "" : "s"} saved` : ""}.
        </p>
      ) : null)}
      <style jsx global>{`
        .dy-lt { margin: 4px 0 14px; padding: 14px 16px; background: var(--card);
                 border: 1px solid var(--brass); border-left-width: 3px; border-radius: 3px; }
        .dy-lt-now { margin: 6px 0 0; font-size: 13px; color: var(--ink); line-height: 1.6; max-width: var(--note-w); }
        .dy-lt-now .pos { color: var(--long); }
        .dy-lt-h { margin-top: 10px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink3); }
        .dy-lt-list { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 4px; }
        /* A day to a row: the date once, its entries stacked beside it. */
        .dy-lt-day { display: grid; grid-template-columns: 8.5ch minmax(0, 1fr); gap: 10px; align-items: baseline; }
        .dy-lt-day > .mono { font-size: 11.5px; color: var(--ink3); padding-top: 4px; }
        .dy-lt-items { display: grid; min-width: 0; }
        .dy-lt-item { display: flex; gap: 10px; align-items: baseline; width: 100%; text-align: left; min-width: 0;
                      background: none; border: 0; padding: 4px 0; cursor: pointer; color: var(--ink2); font: inherit; font-size: 12.5px; }
        .dy-lt-item:hover .dy-lt-body, .dy-lt-item:focus-visible .dy-lt-body { color: var(--ink); text-decoration: underline; }
        /* The entry cards' fold, in their chevron. */
        .dy-lt-more { display: inline-flex; align-items: center; gap: 6px; margin: 8px 0 0; padding: 2px 0;
                      background: none; border: 0; font: inherit; font-size: 12px; color: var(--ink3); cursor: pointer; }
        .dy-lt-more:hover, .dy-lt-more:focus-visible { color: var(--ink); }
        .dy-lt-more[data-static] { cursor: default; }
        .dy-lt-more[data-static]:hover { color: var(--ink3); }
        .dy-lt-more .dy-chev { display: inline-flex; }
        .dy-lt-more[aria-expanded="true"] .dy-chev svg { transform: rotate(180deg); }
        .dy-lt-feel { color: var(--brass); flex: 0 0 auto; }
        .dy-lt-body { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
        .dy-lt-none { margin: 8px 0 0; font-size: 12.5px; color: var(--ink3); }
      `}</style>
    </div>
  );
}
