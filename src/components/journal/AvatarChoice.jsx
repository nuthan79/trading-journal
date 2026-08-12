"use client";

import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { saveAvatarPreset, uploadAvatar, removeAvatar } from "@/lib/db";
import { PRESET_COUNT, presetDataUri, presetPath, isPreset } from "@/lib/avatars";

const MAX_UPLOAD = 8 * 1024 * 1024;

/**
 * Pick a face, or bring your own.
 *
 * ONE COMPONENT FOR BOTH PLACES it is offered — during first run, and later in
 * the profile. They are the same decision made at different times, and two
 * implementations would drift the moment either gained a preset.
 *
 * THE PRESETS COME FIRST and the upload is the smaller control, which is the
 * opposite of how this started. Uploading is a errand — find a photo, wait for
 * it — and putting it first at the moment somebody is trying to get into the
 * app is how everyone ended up with no picture at all.
 */
export default function AvatarChoice({ profile, avatar, onChanged, compact = false }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const current = profile?.avatar_path || null;
  const uploaded = !!current && !isPreset(current);

  const pick = async (i) => {
    if (busy) return;
    setBusy(true); setErr("");
    try { onChanged(await saveAvatarPreset(i)); }
    catch (e) { setErr(e.message || "Could not save that."); }
    setBusy(false);
  };

  const choose = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";                       // so the same file can be picked twice
    if (!file) return;
    if (!/^image\//.test(file.type)) { setErr("That needs to be an image."); return; }
    if (file.size > MAX_UPLOAD) { setErr("That image is over 8 MB — pick a smaller one."); return; }

    setBusy(true); setErr("");
    try { onChanged(await uploadAvatar(file)); }
    catch (e2) {
      setErr(e2.message?.includes("Bucket not found")
        ? "Migration 010 hasn't been run — supabase/010_avatars.sql creates the bucket this needs."
        : e2.message || "Could not save that picture.");
    }
    setBusy(false);
  };

  const clear = async () => {
    setBusy(true); setErr("");
    try { onChanged(await removeAvatar()); }
    catch (e2) { setErr(e2.message || "Could not remove it."); }
    setBusy(false);
  };

  return (
    <div className="av-wrap">
      <div className="av-row">
        {Array.from({ length: PRESET_COUNT }, (_, i) => (
          <button
            key={i} type="button" className="av-dot" disabled={busy}
            data-on={current === presetPath(i) ? 1 : 0}
            onClick={() => pick(i)}
            aria-label={`Avatar ${i + 1}`}
            aria-pressed={current === presetPath(i)}
          >
            <img src={presetDataUri(i)} alt="" />
          </button>
        ))}

        {/* The uploaded picture sits in the same row, selected, so it reads as
            one more option rather than a separate mode. */}
        {uploaded && avatar && (
          <span className="av-dot av-mine" data-on={1} title="Your picture">
            <img src={avatar} alt="Your avatar" />
          </span>
        )}
      </div>

      <div className="av-actions">
        <button type="button" className="btn ghost sm" disabled={busy}
                onClick={() => fileRef.current?.click()}>
          <Upload size={12} />{uploaded ? "Replace photo" : "Upload a photo"}
        </button>
        {current && (
          <button type="button" className="btn ghost sm" onClick={clear} disabled={busy}>
            <X size={12} />No picture
          </button>
        )}
        {!compact && (
          <span className="av-hint">Pick one, or use your own.</span>
        )}
      </div>

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={choose} />
      {err && <div className="warn" style={{ marginTop: 10 }}>{err}</div>}

      <style jsx>{`
        .av-row { display: flex; flex-wrap: wrap; gap: 9px; }
        .av-dot {
          width: 42px; height: 42px; padding: 0; border-radius: 50%;
          border: 1px solid var(--rule); background: none; cursor: pointer;
          overflow: hidden; display: block; line-height: 0;
          transition: box-shadow 0.12s ease, border-color 0.12s ease;
        }
        .av-dot img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .av-dot:hover:not(:disabled) { border-color: var(--ink3); }
        /* A ring rather than a tick. The chosen one has to be obvious at a
           glance across ten near-identical circles, and a mark drawn on top
           would cover the very thing being chosen. */
        .av-dot[data-on="1"] {
          border-color: var(--ink);
          box-shadow: 0 0 0 2px var(--paper), 0 0 0 3.5px var(--ink);
        }
        .av-dot:disabled { cursor: default; opacity: 0.6; }
        .av-mine { cursor: default; }
        .av-actions {
          display: flex; align-items: center; gap: 10px;
          flex-wrap: wrap; margin-top: 14px;
        }
        .av-hint { font-size: 11.5px; color: var(--ink3); }
      `}</style>
    </div>
  );
}
