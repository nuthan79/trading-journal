"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, Settings2, LayoutGrid, Table2, LineChart, BookOpen, ClipboardList, LogOut } from "lucide-react";
import {
  supabase, getProfile, saveProfile as dbSaveProfile,
  listTrades, saveTrade as dbSaveTrade, deleteTrade as dbDeleteTrade,
  listDiary, saveDiary as dbSaveDiary, deleteDiary as dbDeleteDiary,
  listFlows, markOpenPositions, signOut,
} from "@/lib/db";
import { stats } from "@/lib/calc";
import { derivePosition } from "@/lib/positions";
import FirstRun from "@/components/journal/FirstRun";
import TradeForm from "@/components/journal/TradeForm";
import SettingsSheet from "@/components/journal/SettingsSheet";
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
  const activeTab = TABS.find((t) => t.href === pathname)?.id ?? "dash";

  // ---- auth + onboarding gate (moved from the old root page.jsx) --------
  const [session, setSession] = useState(null);
  const [booted, setBooted] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authErr, setAuthErr] = useState("");
  const [busy, setBusy] = useState(false);

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

  const signIn = async () => {
    setBusy(true); setAuthErr("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthErr(error.message);
    setBusy(false);
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

  // ---- gate states (no topbar/tabs — user isn't in the app yet) ---------
  if (!booted) {
    return <div className="wrap"><div className="eyebrow">Starting up</div></div>;
  }

  if (!session) {
    return (
      <div className="wrap" style={{ maxWidth: 380 }}>
        <div className="eyebrow">Trading Journal</div>
        <h1 className="disp" style={{ fontSize: 22, margin: "6px 0 24px" }}>Sign in</h1>

        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label className="f"><span>Email</span>
            <input className="in" type="email" value={email} autoComplete="username"
                   onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="f"><span>Password</span>
            <input className="in" type="password" value={password} autoComplete="current-password"
                   onChange={(e) => setPassword(e.target.value)}
                   onKeyDown={(e) => e.key === "Enter" && signIn()} /></label>

          {authErr && <div className="warn">{authErr}</div>}

          <button className="btn" onClick={signIn} disabled={busy || !email || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <div style={{ fontSize: 11.5, color: "var(--ink3)", lineHeight: 1.6 }}>
            No account yet? Create one in Supabase under Authentication → Users →
            Add user, and tick Auto Confirm User.
          </div>
        </div>
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
        mergeMarks,
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
          <SettingsSheet profile={profile} onSave={saveSettings} onClose={() => setShowSettings(false)} />
        )}
      </div>
    </JournalContext.Provider>
  );
}
