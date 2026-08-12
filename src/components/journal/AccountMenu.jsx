"use client";

import { useEffect, useRef, useState } from "react";
import { User, KeyRound, Settings2, LifeBuoy, LogOut, Crown } from "lucide-react";

/**
 * The avatar in the corner, and what's behind it.
 *
 * Everything to do with the account rather than the trading: who you are, the
 * password, the setup, the way out. They were three buttons competing with
 * "New trade" for the same strip of space; only one of them is something you
 * press often.
 */

const initials = (name, email) => {
  const src = (name || email || "").trim();
  if (!src) return "?";
  const words = src.split(/[\s@._-]+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : src.slice(0, 2)).toUpperCase();
};

export default function AccountMenu({ profile, email, avatar, onProfile, onPassword, onSetup, onSupport, onSignOut }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    const key = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const pick = (fn) => () => { setOpen(false); fn?.(); };

  return (
    <div className="am" ref={boxRef}>
      <button className="am-avatar" onClick={() => setOpen((o) => !o)}
              aria-haspopup="menu" aria-expanded={open} aria-label="Account">
        {/* Initials until there's a picture, rather than a grey silhouette —
            they identify the account, which is the job here. */}
        {avatar
          ? <img src={avatar} alt="" />
          : initials(profile?.journal_name, email)}
      </button>

      {open && (
        <div className="am-pop" role="menu">
          <div className="am-who">
            {avatar && <img className="am-face" src={avatar} alt="" />}
            <div style={{ minWidth: 0 }}>
              <div className="disp">{profile?.journal_name || "Breakout Ledger"}</div>
              <div className="am-email mono">{email || "—"}</div>
            </div>
          </div>

          <button className="am-item" role="menuitem" onClick={pick(onProfile)}>
            <User size={14} />My profile
          </button>
          <button className="am-item" role="menuitem" onClick={pick(onPassword)}>
            <KeyRound size={14} />Change password
          </button>
          <button className="am-item" role="menuitem" onClick={pick(onSetup)}>
            <Settings2 size={14} />Setup
          </button>
          {/* The one thing that had no home. A settings page briefly sat here
              gathering profile, setup, importing and billing into panels that
              pointed at screens which already existed — scaffolding rather
              than a feature, so it went and this took its place. */}
          <button className="am-item" role="menuitem" onClick={pick(onSupport)}>
            <LifeBuoy size={14} />Support
          </button>
          <button className="am-item" role="menuitem" onClick={pick(onSignOut)}>
            <LogOut size={14} />Sign out
          </button>

          {/* Deliberately not a link yet. There is no plan to show and nothing
              to buy, and a button that does nothing is worse than none. It sits
              here as the place subscription will live. */}
          <div className="am-plan">
            <Crown size={13} />
            <span>Free while this is being built</span>
          </div>
        </div>
      )}

      <style jsx>{`
        .am { position: relative; }
        .am-avatar {
          width: 32px; height: 32px; border-radius: 50%;
          border: 1px solid var(--rule); background: var(--card);
          color: var(--ink2); cursor: pointer;
          font-family: 'Archivo', sans-serif; font-size: 11px; font-weight: 700;
          letter-spacing: 0.04em; display: flex; align-items: center;
          justify-content: center; padding: 0;
        }
        .am-avatar:hover { border-color: var(--brass); color: var(--ink); }
        .am-avatar :global(img) {
          width: 100%; height: 100%; border-radius: 50%;
          object-fit: cover; display: block;
        }
        .am-pop {
          position: absolute; top: calc(100% + 8px); right: 0; z-index: 50;
          min-width: 232px; background: #fff;
          border: 1px solid var(--rule); border-radius: 3px;
          box-shadow: 0 12px 30px rgba(19, 28, 26, 0.16);
          overflow: hidden; padding: 4px 0;
        }
        .am-who {
          display: flex; align-items: center; gap: 10px;
          padding: 11px 14px 10px; border-bottom: 1px solid var(--rule);
        }
        .am-face {
          width: 34px; height: 34px; border-radius: 50%;
          object-fit: cover; flex: none; border: 1px solid var(--rule);
        }
        .am-who .disp { font-size: 13.5px; }
        .am-email {
          font-size: 11px; color: var(--ink3); margin-top: 2px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .am-item {
          display: flex; align-items: center; gap: 10px; width: 100%;
          padding: 9px 14px; background: none; border: 0; cursor: pointer;
          font: inherit; font-size: 13px; color: var(--ink2); text-align: left;
        }
        .am-item:hover { background: #F3F6F4; color: var(--ink); }
        .am-item :global(svg) { color: var(--ink3); flex: none; }
        .am-item:hover :global(svg) { color: var(--brass); }
        .am-plan {
          display: flex; align-items: center; gap: 8px;
          margin: 4px 6px 2px; padding: 9px 10px; border-radius: 2px;
          background: #F7F4EC; color: #6B4E13; font-size: 11.5px;
        }
        .am-plan :global(svg) { color: var(--brass); flex: none; }
      `}</style>
    </div>
  );
}
