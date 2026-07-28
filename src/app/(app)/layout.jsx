"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, Settings2, LayoutGrid, Table2, LineChart, BookOpen, ClipboardList, LogOut } from "lucide-react";
import {
  supabase, getProfile, saveProfile as dbSaveProfile,
  listTrades, saveTrade as dbSaveTrade, deleteTrade as dbDeleteTrade,
  listDiary, saveDiary as dbSaveDiary, deleteDiary as dbDeleteDiary,
  listFlows, markOpenPositions, sendMagicLink, signInWithPassword, signOut,
} from "@/lib/db";
import { stats } from "@/lib/calc";
import { derivePosition } from "@/lib/positions";
import FirstRun from "@/components/journal/FirstRun";
import TradeForm from "@/components/journal/TradeForm";
import SettingsSheet from "@/components/journal/SettingsSheet";
import { loadDraft, DRAFT_KEYS } from "@/lib/useAutosave";
import { JournalContext } from "./JournalContext";

/**
 * Our schema stores one exit per trade (exit_price/exit_date/quantity), not
 * a tranche list. derivePosition() reads a t.exits array, so this builds the
 * single-exit equivalent for a closed trade. Charges live on t.charges alone
 * here (not per-exit), so the synthesized exit omits charges — derivePosition
 * would otherwise add it a second time via its own entry-side charges field.
 */
function withExits(t) {
  if (t.status === "closed" && t.exit_date) {
    return { ...t, exits: [{ exit_date: t.exit_date, quantity: t.quantity, price: t.exit_price }] };
  }
  return { ...t, exits: [] };
}

const TABS = [
  { id: "dash", href: "/", label: "Dashboard", icon: LayoutGrid },
  { id: "trades", href: "/trades", label: "Trades", icon: Table2 },
  { id: "perf", href: "/performance", label: "Performance", icon: LineChart },
  { id: "diary", href: "/diary", label: "Diary", icon: BookOpen },
  { id: "review", href: "/review", label: "Review", icon: ClipboardList },
];

export default function AppLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  // No fallback to "dash": /import and /stops match no tab, and defaulting
  // would light up Dashboard while you're plainly somewhere else.
  const activeTab = TABS.find((t) => t.href === pathname)?.id ?? null;

  // ---- auth + onboarding gate (moved from the old root page.jsx) --------
  const [session, setSession] = useState(null);
  const [booted, setBooted] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState("password");
  const [authErr, setAuthErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

  // Implicit flow reports a bad or expired link in the URL fragment
  // (#error=...&error_description=...), not a query string — supabase-js
  // strips the fragment once it has consumed a *successful* one, so
  // anything left here is a failure worth showing.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const description = hash.get("error_description");
    if (hash.get("error")) {
      setAuthErr(description || "That link didn't work — request a new one.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBooted(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    setProfileLoading(true);
    getProfile()
      .then(setProfile)
      .finally(() => setProfileLoading(false));
  }, [session]);

  const signInPassword = async () => {
    setBusy(true); setAuthErr("");
    const { error } = await signInWithPassword(email, password);
    if (error) setAuthErr(error.message);
    setBusy(false);
  };

  const sendLink = async () => {
    setBusy(true); setAuthErr("");
    // Straight back to the app root: implicit flow hands the session over in
    // the URL fragment, which never reaches the server, so there's nothing
    // for a callback route to do.
    const { error } = await sendMagicLink(email, window.location.origin);
    if (error) setAuthErr(error.message);
    else setLinkSent(true);
    setBusy(false);
  };

  const resetToEmailForm = () => {
    setLinkSent(false); setAuthErr("");
  };

  const switchAuthMode = (mode) => {
    setAuthMode(mode); setAuthErr(""); setLinkSent(false);
  };

  // ---- journal data + handlers (moved from the old Journal.jsx) ---------
  const [loading, setLoading] = useState(true);
  const [trades, setTrades] = useState([]);
  const [diary, setDiary] = useState([]);
  const [flows, setFlows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [flash, setFlash] = useState("");

  const say = useCallback((m) => { setFlash(m); setTimeout(() => setFlash(""), 2600); }, []);

  const mergeMarks = useCallback((rows) => {
    if (!rows?.length) return;
    setTrades((prev) => prev.map((t) => {
      const hit = rows.find((r) => r.id === t.id);
      return hit ? { ...t, last_price: hit.last_price, last_price_at: hit.last_price_at } : t;
    }));
  }, []);

  /**
   * Re-read the trades. An import writes hundreds of rows straight to the
   * database rather than through saveTrade(), and filling stops updates rows
   * in place, so neither shows up in the in-memory list without this.
   */
  const reloadTrades = useCallback(async () => {
    const t = await listTrades();
    setTrades(t);
    return t;
  }, []);

  useEffect(() => {
    if (!profile?.onboarded_at) return;
    (async () => {
      try {
        const [t, d, fl] = await Promise.all([listTrades(), listDiary(), listFlows()]);
        setTrades(t);
        setDiary(d);
        setFlows(fl);

        const openNow = t.filter((x) => x.status === "open");
        if (openNow.length) {
          markOpenPositions(openNow).then(({ marked }) => {
            if (marked.length) mergeMarks(marked);
          });
        }
      } catch (e) {
        setFlash(e.message || "Could not load the journal.");
      } finally {
        setLoading(false);
      }
    })();
  }, [profile?.onboarded_at, mergeMarks]);

  const accountSize = profile?.account_size ?? 1000000;

  const all = useMemo(
    () => trades.map((t) => ({
      ...t,
      ...derivePosition(withExits(t), accountSize),
      status: t.status, // authoritative from the DB; derivePosition recomputes it from exits
    })),
    [trades, accountSize]
  );
  const closed = useMemo(
    () => all.filter((t) => t.status === "closed" && isFinite(t.r))
             .sort((a, b) => new Date(a.exit_date || a.entry_date) - new Date(b.exit_date || b.entry_date)),
    [all]
  );
  const open = useMemo(() => all.filter((t) => t.status === "open"), [all]);
  // Counted off the raw rows: a derived trade has stop_loss folded into NaN
  // risk figures, so null is only distinguishable before derivation.
  const needStopsCount = useMemo(
    () => trades.filter((t) => t.stop_loss == null).length,
    [trades]
  );
  const S = useMemo(() => stats(closed), [closed]);

  const saveTrade = async (payload) => {
    try {
      const saved = await dbSaveTrade(payload);
      setTrades((prev) => {
        const exists = prev.some((x) => x.id === saved.id);
        return exists ? prev.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...prev];
      });
      setShowForm(false); setEditing(null);
      say(payload.id ? "Trade updated." : "Trade logged.");
    } catch (e) {
      say(e.message || "Could not save the trade.");
      throw e;
    }
  };

  const removeTrade = async (id) => {
    if (!window.confirm("Delete this trade? This can't be undone.")) return;
    try {
      await dbDeleteTrade(id);
      setTrades((prev) => prev.filter((x) => x.id !== id));
      say("Trade removed.");
    } catch (e) {
      say(e.message || "Could not delete the trade.");
    }
  };

  const saveDiaryEntry = async (entry, imageFile) => {
    try {
      const saved = await dbSaveDiary(entry, imageFile);
      setDiary((prev) => {
        const exists = prev.some((x) => x.id === saved.id);
        const next = exists ? prev.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...prev];
        return [...next].sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
      });
      say("Entry saved.");
    } catch (e) {
      say(e.message || "Could not save the entry.");
      throw e;
    }
  };

  const removeDiaryEntry = async (entry) => {
    if (!window.confirm("Delete this entry? This can't be undone.")) return;
    try {
      await dbDeleteDiary(entry);
      setDiary((prev) => prev.filter((x) => x.id !== entry.id));
      say("Entry removed.");
    } catch (e) {
      say(e.message || "Could not delete the entry.");
    }
  };

  const saveSettings = async (patch) => {
    try {
      const saved = await dbSaveProfile(patch);
      setProfile(saved);
      say("Setup saved.");
    } catch (e) {
      say(e.message || "Could not save setup.");
      throw e;
    }
  };

  const openNewTrade = useCallback(() => { setEditing(null); setShowForm(true); }, []);
  const openEditTrade = useCallback((t) => { setEditing(t); setShowForm(true); }, []);

  // These modals are local state, not routes — a cold-reload loses the fact
  // that one was open at all, not just the fields inside it. Reopen the
  // modal itself if TradeForm/SettingsSheet left an autosaved draft behind;
  // each component restores its own field values from the same key once it
  // mounts. `initial` only needs to carry an id here (see formIdOf in
  // TradeForm) — the actual field values come from the persisted draft.
  const restoredTradeRef = useRef(false);
  useEffect(() => {
    if (loading || restoredTradeRef.current) return;
    restoredTradeRef.current = true;
    const persisted = loadDraft(DRAFT_KEYS.trade);
    if (persisted?.t) {
      setEditing(persisted.formId && persisted.formId !== "new" ? { id: persisted.formId } : null);
      setShowForm(true);
      say("Restored an unsaved trade.");
    }
  }, [loading, say]);

  const restoredSettingsRef = useRef(false);
  useEffect(() => {
    if (loading || restoredSettingsRef.current) return;
    restoredSettingsRef.current = true;
    if (loadDraft(DRAFT_KEYS.settings)) {
      setShowSettings(true);
      say("Restored unsaved setup changes.");
    }
  }, [loading, say]);

  // ---- gate states (no topbar/tabs — user isn't in the app yet) ---------
  if (!booted) {
    return <div className="wrap"><div className="eyebrow">Starting up</div></div>;
  }

  if (!session) {
    return (
      <div className="wrap" style={{ maxWidth: 380 }}>
        <div className="eyebrow">Trading Journal</div>
        <h1 className="disp" style={{ fontSize: 22, margin: "6px 0 24px" }}>Sign in</h1>

        {linkSent ? (
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div className="disp" style={{ fontSize: 15 }}>Check your email</div>
              <p style={{ fontSize: 13, color: "var(--ink2)", lineHeight: 1.6, margin: "6px 0 0" }}>
                We sent a sign-in link to <b>{email}</b>. Open it from any browser or mail
                app — it signs you in wherever you click it. The link expires shortly, so
                request a new one if it's been a while.
              </p>
            </div>

            {authErr && <div className="warn">{authErr}</div>}

            <button className="btn ghost" onClick={resetToEmailForm}>
              Use a different email
            </button>
          </div>
        ) : (
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="seg">
              <button type="button" data-on={authMode === "password" ? 1 : 0}
                      onClick={() => switchAuthMode("password")}>Password</button>
              <button type="button" data-on={authMode === "link" ? 1 : 0}
                      onClick={() => switchAuthMode("link")}>Email link</button>
            </div>

            <label className="f"><span>Email</span>
              <input className="in" type="email" value={email} autoComplete="username" autoFocus
                     onChange={(e) => setEmail(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" &&
                       (authMode === "password" ? signInPassword() : sendLink())} /></label>

            {authMode === "password" && (
              <label className="f"><span>Password</span>
                <input className="in" type="password" value={password} autoComplete="current-password"
                       onChange={(e) => setPassword(e.target.value)}
                       onKeyDown={(e) => e.key === "Enter" && signInPassword()} /></label>
            )}

            {authErr && <div className="warn">{authErr}</div>}

            {authMode === "password" ? (
              <button className="btn" onClick={signInPassword} disabled={busy || !email || !password}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            ) : (
              <button className="btn" onClick={sendLink} disabled={busy || !email}>
                {busy ? "Sending…" : "Send magic link"}
              </button>
            )}

            <div style={{ fontSize: 11.5, color: "var(--ink3)", lineHeight: 1.6 }}>
              {authMode === "password"
                ? "Your existing password still works. Email link is there for when you'd rather not type it."
                : "We'll email you a link that signs you in — no password, and it works in whichever browser opens it."}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (profileLoading || !profile) {
    return <div className="wrap"><div className="eyebrow">Opening the ledger</div></div>;
  }

  if (!profile.onboarded_at) {
    return (
      <FirstRun
        initialName={profile.journal_name}
        onComplete={async (patch) => {
          const saved = await dbSaveProfile(patch);
          setProfile(saved);
        }}
      />
    );
  }

  if (loading) {
    return (
      <div className="jwrap" style={{ paddingTop: 90 }}>
        <div className="eyebrow">Opening the ledger</div>
      </div>
    );
  }

  return (
    <JournalContext.Provider
      value={{
        trades, diary, flows, profile, accountSize,
        all, closed, open, S,
        say,
        openNewTrade, openEditTrade,
        removeTrade,
        saveDiaryEntry, removeDiaryEntry,
        mergeMarks, reloadTrades,
      }}
    >
      <div>
        <div className="topbar">
          <div className="topin">
            <div style={{ flex: "1 1 240px" }}>
              <div className="brand">
                <h1 className="disp">{profile?.journal_name || "Breakout Ledger"}</h1>
                <span className="eyebrow" style={{ position: "relative", top: -1 }}>
                  {closed.length} closed · {open.length} open
                </span>
              </div>
              <div className="tabs">
                {TABS.map((t) => {
                  const I = t.icon;
                  return (
                    <Link key={t.id} href={t.href} className="tab" data-on={activeTab === t.id ? 1 : 0}>
                      <I size={13} />{t.label}
                    </Link>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", paddingBottom: 12 }}>
              <button className="btn ghost sm" onClick={() => setShowSettings(true)} aria-label="Settings">
                <Settings2 size={13} />Setup
              </button>
              <button className="btn ghost sm" onClick={() => signOut()} aria-label="Sign out">
                <LogOut size={13} />Sign out
              </button>
              <button className="btn" onClick={openNewTrade}>
                <Plus size={14} />New trade
              </button>
            </div>
          </div>
        </div>

        <div className="jwrap">
          {flash && <div className="warn" style={{ marginTop: 14 }}>{flash}</div>}
          {children}
        </div>

        {showForm && (
          <TradeForm initial={editing} accountSize={accountSize} defaultRiskPct={profile?.default_risk_pct}
                     chargeConfig={profile?.charge_config}
                     onSave={saveTrade} onClose={() => { setShowForm(false); setEditing(null); }} />
        )}

        {showSettings && (
          <SettingsSheet
            profile={profile}
            onSave={saveSettings}
            onClose={() => setShowSettings(false)}
            needStopsCount={needStopsCount}
            onNavigate={(href) => { setShowSettings(false); router.push(href); }}
          />
        )}
      </div>
    </JournalContext.Provider>
  );
}
