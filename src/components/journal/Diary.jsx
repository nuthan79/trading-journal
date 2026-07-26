"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X, Trash2, Image as ImageIcon, Link2, Check } from "lucide-react";
import { chartUrl } from "@/lib/db";
import { resolveTradingViewChart } from "@/lib/charts";
import { rfmt } from "@/lib/format";
import { EMOTIONS } from "@/lib/constants";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function newDraft() {
  return {
    entry_date: new Date().toISOString().slice(0, 10),
    emotions: [], body: "", trade_id: "",
    imageFile: null, imagePreview: null, imageUrl: null,
    linkOpen: false, linkInput: "", linkError: "",
  };
}

export default function Diary({ diary, trades, onSave, onDelete, say }) {
  const [draft, setDraft] = useState(null);
  const [urls, setUrls] = useState({});
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

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

  const pickFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > MAX_IMAGE_BYTES) { say("That image is too large — keep it under 8MB."); e.target.value = ""; return; }
    if (draft.imagePreview) URL.revokeObjectURL(draft.imagePreview);
    setDraft((p) => ({ ...p, imageFile: f, imagePreview: URL.createObjectURL(f), imageUrl: null, linkOpen: false }));
    e.target.value = "";
  };

  const removeImage = () => {
    if (draft.imagePreview) URL.revokeObjectURL(draft.imagePreview);
    setDraft((p) => ({ ...p, imageFile: null, imagePreview: null, imageUrl: null }));
  };

  const openLink = () => setDraft((p) => ({ ...p, linkOpen: true, linkInput: "", linkError: "" }));

  const useLink = () => {
    const result = resolveTradingViewChart(draft.linkInput);
    if (!result.ok) {
      setDraft((p) => ({ ...p, linkError: result.error }));
      return;
    }
    if (draft.imagePreview) URL.revokeObjectURL(draft.imagePreview);
    setDraft((p) => ({
      ...p, imageFile: null, imagePreview: null, imageUrl: result.url,
      linkOpen: false, linkInput: "", linkError: "",
    }));
  };

  const discard = () => {
    if (draft.imagePreview) URL.revokeObjectURL(draft.imagePreview);
    setDraft(null);
  };

  const commit = async () => {
    if (!draft.body.trim() && !draft.imageFile && !draft.imageUrl) { say("Write something or attach a chart first."); return; }
    setSaving(true);
    try {
      await onSave({
        entry_date: draft.entry_date,
        emotions: draft.emotions,
        body: draft.body,
        trade_id: draft.trade_id || null,
        ...(draft.imageUrl ? { image_path: draft.imageUrl } : {}),
      }, draft.imageFile);
      if (draft.imagePreview) URL.revokeObjectURL(draft.imagePreview);
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
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <label className="f"><span>Date</span>
              <input className="in" type="date" value={draft.entry_date}
                     onChange={(e) => setDraft((p) => ({ ...p, entry_date: e.target.value }))} /></label>
            <label className="f" style={{ flex: 1, minWidth: 200 }}><span>Attach to a trade (optional)</span>
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

          {(draft.imagePreview || draft.imageUrl) && (
            <div style={{ marginTop: 12 }}>
              <img src={draft.imagePreview || draft.imageUrl} alt="Attached chart"
                   style={{ maxWidth: "100%", border: "1px solid var(--rule)", borderRadius: 2 }} />
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

          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={pickFile} />

          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", marginTop: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn ghost" onClick={() => fileRef.current && fileRef.current.click()}>
                <ImageIcon size={13} />{(draft.imagePreview || draft.imageUrl) ? "Replace chart" : "Attach chart"}
              </button>
              <button className="btn ghost" onClick={openLink}>
                <Link2 size={13} />Paste link
              </button>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn ghost" onClick={discard}>Discard</button>
              <button className="btn" disabled={saving} onClick={commit}>
                <Check size={14} />{saving ? "Saving…" : "Save entry"}
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
          return (
            <div key={e.id} className="entry">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--ink2)" }}>{e.entry_date}</div>
                  {t && (
                    <div style={{ fontSize: 11, color: "var(--brass)", marginTop: 3 }}>
                      on {t.symbol} · {isFinite(t.r) ? rfmt(t.r) : "still open"}
                    </div>
                  )}
                </div>
                <button className="x" onClick={() => onDelete(e)} aria-label="Delete entry">
                  <Trash2 size={13} />
                </button>
              </div>
              {(e.emotions || []).length > 0 && (
                <div className="chips" style={{ marginTop: 9 }}>
                  {e.emotions.map((x) => <span key={x} className="chip">{x}</span>)}
                </div>
              )}
              {e.body && <p className="body">{e.body}</p>}
              {e.image_path && urls[e.id] && <img src={urls[e.id]} alt="Chart from this entry" />}
            </div>
          );
        })
      )}
    </div>
  );
}
