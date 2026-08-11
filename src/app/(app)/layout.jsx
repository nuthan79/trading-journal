"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, LayoutGrid, Layers, Table2, LineChart, BookOpen, ClipboardList } from "lucide-react";
import {
  supabase, getProfile, saveProfile as dbSaveProfile,
  listTrades, listExitsByTrade, saveExits, saveTrade as dbSaveTrade, deleteTrade as dbDeleteTrade,
  listDiary, saveDiary as dbSaveDiary, deleteDiary as dbDeleteDiary,
  listFlows, markOpenPositions, sendMagicLink, signInWithPassword, signOut,
  signUpWithPassword, signInWithGoogle,
  sendPasswordReset, avatarUrl, trackVisit,
} from "@/lib/db";
import { stats } from "@/lib/calc";
import { derivePosition } from "@/lib/positions";
import FirstRun from "@/components/journal/FirstRun";
import TradeForm from "@/components/journal/TradeForm";
import SettingsSheet from "@/components/journal/SettingsSheet";
import ProfileSheet from "@/components/journal/ProfileSheet";
import AccountMenu from "@/components/journal/AccountMenu";
import { listenForErrors } from "@/lib/errors";
import Landing from "@/components/Landing";
import SignInCard from "@/components/SignInCard";
import { loadDraft, DRAFT_KEYS } from "@/lib/useAutosave";
import { JournalContext } from "./JournalContext";

/**
 * Attach a trade's exit tranches.
 *
 * Real tranches from trade_exits when they're there. The fallback synthesises
 * the single-exit equivalent from the flat columns, which covers the window
 * before migration 007 is applied and any row the backfill hasn't reached.
 * Charges are omitted from a synthesised tranche because the figure still
 * sits on t.charges and derivePosition sums both — putting it in one place
 * only is what keeps the total honest.
 */
function withExits(t, exitsByTrade) {
  const real = exitsByTrade?.[t.id];
  if (real?.length) return { ...t, exits: real };
  if (t.status === "closed" && t.exit_date) {
    return { ...t, exits: [{ exit_date: t.exit_date, quantity: t.quantity, price: t.exit_price }] };
  }
  return { ...t, exits: [] };
}

const TABS = [
  { id: "dash", href: "/", label: "Dashboard", icon: LayoutGrid },
  { id: "holdings", href: "/holdings", label: "Holdings", icon: Layers },
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
  // Signing in versus creating an account. Separate from authMode, which is
  // only about how an existing user proves who they are.
  const [authView, setAuthView] = useState("signin");
  const [authErr, setAuthErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  // "link" is a sign-in link, "reset" is a set-a-new-password link. Both end
  // in the same "check your email" panel, which needs to say which was sent.
  const [sentKind, setSentKind] = useState("link");

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

  // One per browser session, not per page load: this counts visits, and
  // active days are counted off it. Fires only once a session exists, so a
  // signed-out visitor is a matter for the page analytics script instead.
  //
  // Keyed on the user id, not the session object. Supabase hands out a fresh
  // session object every time it refreshes the token — which it does whenever
  // the tab regains focus — so keying on the object counted a new visit every
  // time somebody alt-tabbed back from a spreadsheet.
  const userId = session?.user?.id ?? null;
  useEffect(() => { if (userId) trackVisit(); }, [userId]);

  // The faults React's error boundary never sees: a throw from an event
  // handler, and a promise nobody caught. Mounted once for the whole app.
  useEffect(() => listenForErrors(), []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBooted(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  /**
   * The profile, fetched once per signed-in user.
   *
   * Keyed on the user id for the same reason as above, and this one was worse
   * than a miscount. A token refresh produced a new session object, which
   * re-ran this effect, which flipped a loading flag, which made the render
   * below return "Opening the ledger" — unmounting every page under it and
   * taking its state with it. Switch to a spreadsheet, come back, and the
   * search you had typed on the trades table was gone, along with the sort,
   * the filter and any open position panel.
   *
   * Nothing looked broken. The page simply came back the way it starts.
   */
  useEffect(() => {
    if (!userId) { setProfile(null); return; }
    getProfile().then(setProfile);
  }, [userId]);

  /**
   * A viewing URL for the profile picture.
   *
   * The bucket is private, so what's stored is a path and this signs it. Held
   * here rather than fetched by each component that draws a face: the menu and
   * the profile sheet would otherwise sign the same object twice, and the two
   * would expire at different moments.
   */
  const [avatar, setAvatar] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!profile?.avatar_path) { setAvatar(null); return; }
    avatarUrl(profile.avatar_path).then((u) => { if (alive) setAvatar(u); });
    return () => { alive = false; };
  }, [profile?.avatar_path]);

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
    else { setSentKind("link"); setLinkSent(true); }
    setBusy(false);
  };

  const sendReset = async () => {
    setBusy(true); setAuthErr("");
    const { error } = await sendPasswordReset(email, `${window.location.origin}/reset`);
    // Deliberately the same panel whether or not that address has an account.
    // Telling a stranger "no such user" turns this form into a way to find out
    // who has one.
    if (error) setAuthErr(error.message);
    else { setSentKind("reset"); setLinkSent(true); }
    setBusy(false);
  };

  const resetToEmailForm = () => {
    setLinkSent(false); setAuthErr("");
  };

  /**
   * Create the account.
   *
   * Two outcomes, and which one arrives is a Supabase dashboard setting rather
   * than anything here. With "Confirm email" off a session comes back and
   * onAuthStateChange takes it from here — no success message needed, the app
   * simply appears. With it on there is no session and a confirmation mail has
   * gone instead, which has to be said or the screen just sits there.
   */
  const signUpPassword = async () => {
    setBusy(true); setAuthErr("");
    const { data, error } = await signUpWithPassword(email, password);
    if (error) setAuthErr(error.message);
    else if (!data?.session) { setSentKind("confirm"); setLinkSent(true); }
    setBusy(false);
  };

  // No setBusy(false) on the happy path: the browser is leaving for Google, and
  // re-enabling the button would only invite a second click on the way out.
  const signInGoogle = async () => {
    setBusy(true); setAuthErr("");
    const { error } = await signInWithGoogle(window.location.origin);
    if (error) { setAuthErr(error.message); setBusy(false); }
  };

  const switchAuthMode = (mode) => {
    setAuthMode(mode); setAuthErr(""); setLinkSent(false);
  };

  const switchAuthView = (view) => {
    setAuthView(view); setAuthErr(""); setLinkSent(false); setPassword("");
  };

  // ---- journal data + handlers (moved from the old Journal.jsx) ---------
  const [loading, setLoading] = useState(true);
  const [trades, setTrades] = useState([]);
  const [exitsByTrade, setExitsByTrade] = useState({});
  const [diary, setDiary] = useState([]);
  const [flows, setFlows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  // Opened via Exit rather than Edit: the form starts on a fresh sell row.
  const [selling, setSelling] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // null when closed; "account" or "password" for which part to land on.
  const [showProfile, setShowProfile] = useState(null);
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
    const [t, x] = await Promise.all([listTrades(), listExitsByTrade()]);
    setTrades(t);
    setExitsByTrade(x);
    return t;
  }, []);

  useEffect(() => {
    if (!profile?.onboarded_at) return;
    (async () => {
      try {
        const [t, d, fl, ex] = await Promise.all([
          listTrades(), listDiary(), listFlows(), listExitsByTrade(),
        ]);
        setTrades(t);
        setDiary(d);
        setFlows(fl);
        setExitsByTrade(ex);

        // A partial still has size running, so it wants a mark like any open one.
        const openNow = t.filter((x) => x.status === "open" || x.status === "partial");
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
      ...derivePosition(withExits(t, exitsByTrade), accountSize),
      status: t.status, // authoritative from the DB; a trigger keeps it in step with the tranches
    })),
    [trades, exitsByTrade, accountSize]
  );
  // Every closed trade, whether or not its R is computable. Filtering on
  // isFinite(r) here made a trade with no stop vanish from the money figures
  // too — net P&L, win rate by count, hold time — which are perfectly
  // knowable without one. The R calculations downstream drop non-finite
  // values themselves, so they stay honest either way.
  const closed = useMemo(
    () => all.filter((t) => t.status === "closed")
             .sort((a, b) => new Date(a.exit_date || a.entry_date) - new Date(b.exit_date || b.entry_date)),
    [all]
  );
  // 'partial' counts as open: there is still size on the table, still risk
  // running, and it still wants a mark-to-market.
  const open = useMemo(
    () => all.filter((t) => t.status === "open" || t.status === "partial"),
    [all]
  );
  // Counted off the raw rows: a derived trade has stop_loss folded into NaN
  // risk figures, so null is only distinguishable before derivation.
  const needStopsCount = useMemo(
    () => trades.filter(
      (t) => t.stop_loss == null && t.acquisition !== "bonus"
    ).length,
    [trades]
  );
  const closedCount = useMemo(
    () => trades.filter((t) => t.status === "closed").length,
    [trades]
  );
  const openCount = useMemo(
    () => trades.filter((t) => t.status === "open" || t.status === "partial").length,
    [trades]
  );
  const partialCount = useMemo(
    () => trades.filter((t) => t.status === "partial").length,
    [trades]
  );
  const S = useMemo(() => stats(closed), [closed]);

  const saveTrade = async (payload, exits, chartSrc) => {
    try {
      const saved = await dbSaveTrade(payload);

      // Written after the trade so they have an id to hang off. A single
      // exit is fully described by the flat columns already, so if
      // migration 007 hasn't run we let that case through rather than
      // failing a save the user had no way to see coming — more than one
      // tranche genuinely needs the table, and that does have to be said.
      let savedExits = exits;
      try {
        await saveExits(saved.id, exits || []);
      } catch (e) {
        if ((exits?.length || 0) > 1) throw e;
        savedExits = null;
      }

      /**
       * The entry chart, if one was pasted. Same shape as the exits above and
       * for the same reason — it needs the trade's id, which only exists once
       * the row is written.
       *
       * Its own try/catch on purpose. A chart is the least important thing
       * being saved here, and a diary insert that fails must not turn a
       * successfully logged trade into an error the user reads as "nothing
       * saved". They lose the picture and are told so; they keep the trade.
       */
      let chartSaved = false;
      if (chartSrc) {
        try {
          const entry = await dbSaveDiary({
            trade_id: saved.id,
            entry_date: saved.entry_date,
            image_path: chartSrc,
            emotions: [],
            body: "",
          });
          setDiary((prev) => [entry, ...prev]
            .sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1)));
          chartSaved = true;
        } catch (e) {
          say("Trade saved, but the chart could not be attached.");
        }
      }

      const [t, ex] = await Promise.all([listTrades(), listExitsByTrade()]);
      setTrades(t);
      setExitsByTrade(ex);

      setShowForm(false); setEditing(null);
      if (chartSrc && !chartSaved) return;   // the message above already said it
      say(
        savedExits?.length > 1
          ? `Trade saved with ${savedExits.length} sells.`
          : chartSaved ? "Trade logged, with the chart."
          : payload.id ? "Trade updated." : "Trade logged."
      );
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

  /**
   * Take the chart off a diary entry, or take the entry if that is all it was.
   *
   * Reported as charts being attached to the wrong trade and then living there
   * forever. The care needed is that an entry may carry a note and the
   * emotions tagged with it as well as the image — deleting the row would take
   * the writing too, and a mis-pasted link is not a reason to lose what
   * somebody thought at the time.
   */
  const removeChartFromEntry = async (entry) => {
    const hasWords = !!(entry.body?.trim() || entry.emotions?.length);
    const ask = hasWords
      ? "Remove the chart from this diary entry? The note stays."
      : "Remove this chart? The entry holds nothing else, so it goes too.";
    if (!window.confirm(ask)) return;

    try {
      if (hasWords) {
        const saved = await dbSaveDiary({ ...entry, image_path: null });
        setDiary((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
        say("Chart removed — the note is still there.");
      } else {
        await dbDeleteDiary(entry);
        setDiary((prev) => prev.filter((x) => x.id !== entry.id));
        say("Chart removed.");
      }
    } catch (e) {
      say(e.message || "Could not remove the chart.");
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

  const openNewTrade = useCallback(() => {
    setEditing(null); setSelling(false); setShowForm(true);
  }, []);
  const openEditTrade = useCallback((t) => {
    setEditing(t); setSelling(false); setShowForm(true);
  }, []);
  // Same form, opened on the sell rather than the setup. "Exit" is the word
  // that's in mind when a position is being closed, and hunting for it under
  // Edit is a step nobody asked for.
  const openExitTrade = useCallback((t) => {
    setEditing(t); setSelling(true); setShowForm(true);
  }, []);

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

  // Signed out is the marketing page now, with the same form inside it. It
  // renders on every route rather than only "/", which is the existing
  // behaviour — the gate has always been here — and means a shared deep link
  // lands somewhere that explains itself instead of on a bare password box.
  if (!session) {
    return (
      <Landing
        signIn={
          <SignInCard
            view={authView} switchAuthView={switchAuthView}
            linkSent={linkSent} sentKind={sentKind}
            email={email} setEmail={setEmail}
            password={password} setPassword={setPassword}
            authMode={authMode} switchAuthMode={switchAuthMode}
            authErr={authErr} busy={busy}
            signInPassword={signInPassword} signUpPassword={signUpPassword}
            signInGoogle={signInGoogle} sendLink={sendLink}
            sendReset={sendReset} resetToEmailForm={resetToEmailForm}
          />
        }
        view={authView}
      />
    );
  }

  // Only while there is nothing to show. A refetch that happens once a profile
  // is already in hand must not blank the screen, because blanking the screen
  // here means unmounting whatever page the user was working in.
  if (!profile) {
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
        openNewTrade, openEditTrade, openExitTrade,
        removeTrade,
        saveDiaryEntry, removeDiaryEntry, removeChartFromEntry,
        mergeMarks, reloadTrades,
      }}
    >
      <div>
        <div className="topbar">
          <div className="topin">
            <div style={{ flex: "1 1 240px" }}>
              <div className="brand">
                <h1 className="disp">{profile?.journal_name || "Breakout Ledger"}</h1>
                {/* Counted off the raw rows, not `closed` — that list filters on
                    isFinite(r), so a trade with no stop yet belongs to neither
                    side and a freshly imported journal read "1 closed · 0 open"
                    with 27 trades sitting in the sheet. Keeping them out of the
                    statistics is right; hiding them from a plain count is not. */}
                <span className="eyebrow" style={{ position: "relative", top: -1 }}>
                  {closedCount} closed · {openCount} open
                  {partialCount > 0 && ` (${partialCount} part-sold)`}
                  {needStopsCount > 0 && (
                    <>
                      {" · "}
                      <Link href="/stops" className="brand-todo">
                        {needStopsCount} need a stop
                      </Link>
                    </>
                  )}
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
            <div style={{ display: "flex", gap: 10, alignItems: "center", paddingBottom: 12 }}>
              <button className="btn" onClick={openNewTrade}>
                <Plus size={14} />New trade
              </button>
              <AccountMenu
                profile={profile}
                email={session?.user?.email}
                avatar={avatar}
                onProfile={() => setShowProfile("account")}
                onPassword={() => setShowProfile("password")}
                onSetup={() => setShowSettings(true)}
                onSignOut={() => signOut()}
              />
            </div>
          </div>
        </div>

        <div className="jwrap">
          {flash && <div className="warn" style={{ marginTop: 14 }}>{flash}</div>}
          {children}
        </div>

        {showForm && (
          <TradeForm initial={editing} accountSize={accountSize} defaultRiskPct={profile?.default_risk_pct}
                     chargeConfig={profile?.charge_config} startSelling={selling}
                     onSave={saveTrade}
                     onClose={() => { setShowForm(false); setEditing(null); setSelling(false); }} />
        )}

        {showProfile && (
          <ProfileSheet
            profile={profile}
            avatar={avatar}
            counts={{ total: trades.length }}
            onlyPassword={showProfile === "password"}
            onProfileChange={setProfile}
            onClose={() => setShowProfile(null)}
          />
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
