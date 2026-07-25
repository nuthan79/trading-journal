"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Settings2, LayoutGrid, Table2, LineChart, BookOpen, ClipboardList, LogOut } from "lucide-react";
import {
  listTrades, saveTrade as dbSaveTrade, deleteTrade as dbDeleteTrade,
  listDiary, saveDiary as dbSaveDiary, deleteDiary as dbDeleteDiary,
  listFlows, markOpenPositions,
  getProfile, saveProfile as dbSaveProfile, signOut,
} from "@/lib/db";
import { derive, stats } from "@/lib/calc";
import Dashboard from "./Dashboard";
import Trades from "./Trades";
import Performance from "./Performance";
import Diary from "./Diary";
import Review from "./Review";
import TradeForm from "./TradeForm";
import SettingsSheet from "./SettingsSheet";

const TABS = [
  { id: "dash", label: "Dashboard", icon: LayoutGrid },
  { id: "trades", label: "Trades", icon: Table2 },
  { id: "perf", label: "Performance", icon: LineChart },
  { id: "diary", label: "Diary", icon: BookOpen },
  { id: "review", label: "Review", icon: ClipboardList },
];

export default function Journal() {
  const [tab, setTab] = useState("dash");
  const [loading, setLoading] = useState(true);
  const [trades, setTrades] = useState([]);
  const [diary, setDiary] = useState([]);
  const [flows, setFlows] = useState([]);
  const [profile, setProfile] = useState(null);
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
    (async () => {
      try {
        const [t, d, p, fl] = await Promise.all([listTrades(), listDiary(), getProfile(), listFlows()]);
        setTrades(t);
        setDiary(d);
        setProfile(p);
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
  }, [mergeMarks]);

  const accountSize = profile?.account_size ?? 1000000;

  const all = useMemo(
    () => trades.map((t) => ({ ...t, ...derive(t, accountSize) })),
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

  if (loading) {
    return (
      <div className="jwrap" style={{ paddingTop: 90 }}>
        <div className="eyebrow">Opening the ledger</div>
      </div>
    );
  }

  return (
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
                  <button key={t.id} className="tab" data-on={tab === t.id ? 1 : 0} onClick={() => setTab(t.id)}>
                    <I size={13} />{t.label}
                  </button>
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
            <button className="btn" onClick={() => { setEditing(null); setShowForm(true); }}>
              <Plus size={14} />New trade
            </button>
          </div>
        </div>
      </div>

      <div className="jwrap">
        {flash && <div className="warn" style={{ marginTop: 14 }}>{flash}</div>}

        {tab === "dash" && (
          <Dashboard S={S} closed={closed} open={open} accountSize={accountSize} diary={diary}
                     flows={flows} onMarked={mergeMarks} />
        )}
        {tab === "trades" && (
          <Trades all={all} onEdit={(t) => { setEditing(t); setShowForm(true); }} onDelete={removeTrade}
                  onNew={() => { setEditing(null); setShowForm(true); }} />
        )}
        {tab === "perf" && <Performance closed={closed} S={S} accountSize={accountSize} flows={flows} />}
        {tab === "diary" && (
          <Diary diary={diary} trades={all} onSave={saveDiaryEntry} onDelete={removeDiaryEntry} say={say} />
        )}
        {tab === "review" && <Review closed={closed} stats={S} />}
      </div>

      {showForm && (
        <TradeForm initial={editing} accountSize={accountSize} defaultRiskPct={profile?.default_risk_pct}
                   onSave={saveTrade} onClose={() => { setShowForm(false); setEditing(null); }} />
      )}

      {showSettings && (
        <SettingsSheet profile={profile} onSave={saveSettings} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
