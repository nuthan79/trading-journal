"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X, Trash2, Link2, Check, Pencil } from "lucide-react";
import { chartUrl } from "@/lib/db";
import ChartViewer from "./ChartViewer";
import { resolveTradingViewChart } from "@/lib/charts";
import { rfmt, dmy } from "@/lib/format";
import { EMOTIONS } from "@/lib/constants";
import { useAutosave, loadDraft, DRAFT_KEYS } from "@/lib/useAutosave";

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
    entry_date: new Date().toISOString().slice(0, 10),
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
    entry_date: p.entry_date || new Date().toISOString().slice(0, 10),
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

export default function Diary({ diary, trades, onSave, onDelete, onRemoveChart, say }) {
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
  const shots = (diary || [])
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
          {draft.id && (
            <div className="eyebrow" style={{ marginBottom: 12 }}>
              Editing the entry from {dmy(draft.entry_date)}
            </div>
          )}
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

          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", marginTop: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn ghost" onClick={discard}>{draft.id ? "Cancel" : "Discard"}</button>
              <button className="btn" disabled={saving} onClick={commit}>
                <Check size={14} />
                {saving ? "Saving…" : draft.id ? "Save changes" : "Save entry"}
              </button>
            </div>
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
        diary.map((e) => {
          const t = trades.find((x) => x.id === e.trade_id);
          const edited = editedOn(e.updated_at);
          // The copy underneath the form it is loaded into. Left in place
          // rather than hidden — it is what the entry looked like before —
          // but dimmed, so two versions of the same note on one screen can be
          // told apart at a glance.
          const isEditing = draft?.id === e.id;
          return (
            <div key={e.id} className="entry" style={isEditing ? { opacity: 0.45 } : undefined}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--ink2)" }}>{e.entry_date}</div>
                  {t && (
                    <div style={{ fontSize: 11, color: "var(--brass)", marginTop: 3 }}>
                      on {t.symbol} · {isFinite(t.r) ? rfmt(t.r) : "still open"}
                    </div>
                  )}
                  {edited && (
                    <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 3 }}>edited {edited}</div>
                  )}
                </div>
                {!isEditing && (
                  <div style={{ display: "flex", gap: 2, flex: "none" }}>
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
              {(e.emotions || []).length > 0 && (
                <div className="chips" style={{ marginTop: 9 }}>
                  {e.emotions.map((x) => <span key={x} className="chip">{x}</span>)}
                </div>
              )}
              {e.body && <p className="body">{e.body}</p>}
              {e.image_path && urls[e.id] && (
                <button className="dy-shot" title="Open full size"
                        onClick={() => setZoom(shots.findIndex((x) => x.id === e.id))}>
                  <img src={urls[e.id]} alt="Chart from this entry" />
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
