"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, LayoutGrid, Layers, Table2, LineChart, BookOpen, ClipboardList, Target, Brain, Upload } from "lucide-react";
import {
  supabase, getProfile, saveProfile as dbSaveProfile,
  listTrades, listExitsByTrade, saveExits, saveTrade as dbSaveTrade, deleteTrade as dbDeleteTrade,
  listDiary, saveDiary as dbSaveDiary, deleteDiary as dbDeleteDiary,
  listFlows, listFilters, saveFilter, deleteFilter,
  markOpenPositions, signInWithPassword, signOut,
  signUpWithPassword, signInWithGoogle,
  sendPasswordReset, avatarUrl, trackVisit, setAnalyticsFlag, setDemoPinned,
  listRegionAccess, fxRate as dbFxRate } from "@/lib/db";
import { stats } from "@/lib/calc";
import { setActiveRegion, money, setDisplayCurrency } from "@/lib/format";
import { setStorageUser, sweepLegacy } from "@/lib/browserStore";
import { currentRegion, regionOf, regionSettings, region as regionInfo,
         REGIONS, DEFAULT_REGION } from "@/lib/regions";
import { SHOW_REGIONS } from "@/lib/flags";
import { canWrite, accessState, accessFor } from "@/lib/entitlements";
import { derivePosition, isOpen, isPartial } from "@/lib/positions";
import { mtfPrefs } from "@/lib/mtf";
import FirstRun from "@/components/journal/FirstRun";
import TradeForm from "@/components/journal/TradeForm";
import SettingsSheet from "@/components/journal/SettingsSheet";
import ProfileSheet from "@/components/journal/ProfileSheet";
import AccountMenu from "@/components/journal/AccountMenu";
import { listenForErrors } from "@/lib/errors";
import { pageEvent } from "@/lib/pageEvents";
import { isPreset, presetIndex, presetDataUri } from "@/lib/avatars";
import { buildDemo } from "@/lib/demo";
import DemoBanner from "@/components/journal/DemoBanner";
import RegionSwitch from "@/components/journal/RegionSwitch";
import CurrencyView from "@/components/journal/CurrencyView";
import RegionOffer from "@/components/journal/RegionOffer";
import SampleOffer from "@/components/journal/SampleOffer";
import Landing from "@/components/Landing";
import Wordmark from "@/components/Wordmark";
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

/**
 * Six tabs.
 *
 * Performance stays at the top level because it is consulted like a statement
 * — which setups paid, month by month — and that is a different act from the
 * three screens under Analysis, which all take that record and argue something
 * about it. Edge, Mindset and Review used to be three separate tabs saying
 * three versions of "here is what your history means", which is what made the
 * nav read as a list rather than a structure.
 */
const TABS = [
  { id: "dash", href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { id: "holdings", href: "/holdings", label: "Holdings", icon: Layers },
  { id: "trades", href: "/trades", label: "Trades", icon: Table2 },
  /*
    Import used to be reachable only from a button inside the settings sheet,
    which made the fastest way to a journal worth opening — a year of broker
    history in one file — a feature new users could not discover. Beside
    Trades because that is where its output lands.
  */
  { id: "import", href: "/import", label: "Import", icon: Upload },
  { id: "perf", href: "/performance", label: "Performance", icon: LineChart },
  /*
    Points at the first sub-page, not at /analysis.

    A bare /analysis with a server-side redirect() to it was the tidier idea
    and does not work here: this layout is a client component that renders a
    sign-in card instead of `children` until a session resolves, so the
    redirect never runs and the tab landed on an empty frame. `match` is what
    the active-state test uses instead, so the tab still lights up on all three
    sub-pages. A config redirect covers anyone arriving at /analysis from a
    bookmark.
  */
  { id: "analysis", href: "/analysis/edge", match: "/analysis",
    label: "Analysis", icon: Target },
  { id: "diary", href: "/diary", label: "Diary", icon: BookOpen },
];

export default function AppLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  /*
    Exact match, then prefix.

    No fallback to "dash": /stops matches no tab, and defaulting
    would light up Dashboard while you're plainly somewhere else.

    The prefix pass exists for Analysis, whose real pages are one level down
    at /analysis/performance and friends — on exact match alone the top tab
    would go dark the moment you actually used it. Guarded with a trailing
    slash so a future /analysis-something cannot light up Analysis by
    accident.
  */
  const activeTab =
    TABS.find((t) => t.href === pathname)?.id ??
    TABS.find((t) => pathname?.startsWith(`${t.match ?? t.href}/`))?.id ??
    null;

  // ---- auth + onboarding gate (moved from the old root page.jsx) --------
  const [session, setSession] = useState(null);
  const [booted, setBooted] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Signing in versus creating an account.
  const [authView, setAuthView] = useState("signin");
  const [authErr, setAuthErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  // "confirm" is a new account awaiting its confirmation link, "reset" is a
  // set-a-new-password link. Both end in the same "check your email" panel,
  // which needs to say which was sent.
  const [sentKind, setSentKind] = useState("confirm");

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

  /**
   * WHOSE BROWSER STORAGE THIS IS, told once, during render.
   *
   * Set here and not in an effect, because the screens below read storage in
   * their own initializers: an effect runs after they have already read, so
   * the first render of a second account would still see the first account's
   * columns. Same placement and same reasoning as setActiveRegion below.
   */
  setStorageUser(userId);

  /* The keys written before any of this was scoped, cleared once — including
     whatever draft is sitting in a shared browser right now. See
     browserStore.js for why it is an explicit list. */
  useEffect(() => { sweepLegacy(); }, []);

  // The faults React's error boundary never sees: a throw from an event
  // handler, and a promise nobody caught. Mounted once for the whole app.
  useEffect(() => listenForErrors(), []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBooted(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      // SIGNED_IN only. INITIAL_SESSION fires for a session restored from
      // storage on every page load, and TOKEN_REFRESHED whenever the token
      // rolls over — counting either would report a handful of regulars as
      // hundreds of sign-ins and make the funnel look far better than it is.
      if (e === "SIGNED_IN") pageEvent("signed_in");
      setSession(s);
    });
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
    getProfile().then((p) => {
      setProfile(p);
      // So track() knows the answer before the first event rather than paying
      // for its own lookup — and so a change made in My profile takes effect
      // immediately rather than at the next sign-in.
      setAnalyticsFlag(p?.analytics_opt_out);
    });
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
    // A preset is drawn from its index, so it resolves here rather than making
    // every component that shows a face know the difference.
    if (isPreset(profile.avatar_path)) {
      setAvatar(presetDataUri(presetIndex(profile.avatar_path)));
      return;
    }
    avatarUrl(profile.avatar_path).then((u) => { if (alive) setAvatar(u); });
    return () => { alive = false; };
  }, [profile?.avatar_path]);

  const signInPassword = async () => {
    setBusy(true); setAuthErr("");
    const { error } = await signInWithPassword(email, password);
    if (error) setAuthErr(error.message);
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
    // Fired before leaving, not after coming back — the drop-off worth
    // measuring happens at Google's own screen, where nothing of ours runs.
    // The difference between this count and the signed_in that follows IS the
    // number of people who got as far as the consent screen and refused.
    pageEvent("google_clicked");
    /**
     * Back to /dashboard, not to the origin.
     *
     * The origin was right when `/` was the app. It is now a static marketing
     * page, so Google returned people to an advertisement for the product they
     * had just signed into — signed in, and looking at a Sign in link. Which
     * is precisely what gets reported as "login is broken".
     */
    const { error } = await signInWithGoogle(`${window.location.origin}/dashboard`);
    if (error) { setAuthErr(error.message); setBusy(false); }
  };

  const switchAuthView = (view) => {
    // The top of the funnel that the database cannot see: somebody who opened
    // the form and then didn't finish leaves no trace anywhere else.
    if (view === "signup") pageEvent("signup_form_opened");
    setAuthView(view); setAuthErr(""); setLinkSent(false); setPassword("");
  };

  // ---- journal data + handlers (moved from the old Journal.jsx) ---------
  const [loading, setLoading] = useState(true);
  const [allTrades, setAllTrades] = useState([]);
  const [exitsByTrade, setExitsByTrade] = useState({});
  const [allDiary, setAllDiary] = useState([]);
  const [allFlows, setAllFlows] = useState([]);
  /* Which markets this user may write in. Empty is the normal answer: India
     is free and needs no row. The real lock is the policy in migration 053 —
     this only keeps the app from offering a Save the database would refuse. */
  const [access, setAccess] = useState([]);
  const [allFilters, setAllFilters] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  // Opened via Exit rather than Edit: the form starts on a fresh sell row.
  const [selling, setSelling] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // null when closed; "account" or "password" for which part to land on.
  const [showProfile, setShowProfile] = useState(null);
  const [flash, setFlash] = useState("");

  const say = useCallback((m) => { setFlash(m); setTimeout(() => setFlash(""), 2600); }, []);

  /**
   * THE OPEN BOOK, and the rows that belong to it.
   *
   * A region is a separate book: India and the US each have their own account
   * size, capital ledger, positions and totals, and nothing on screen ever
   * sums across two currencies. Every row is fetched once — there are not
   * enough of them to be worth two round trips — and the book is the slice of
   * them that belongs to the region being read. Everything downstream takes
   * `trades` and `flows` and cannot tell the difference.
   *
   * `regionOf` answers IN for a row with no region, which is every row written
   * before migration 052, so an Indian journal sees exactly what it always
   * saw whether or not the switch is on.
   */
  const bookRegion = SHOW_REGIONS ? currentRegion(profile) : DEFAULT_REGION;
  const trades = useMemo(
    () => allTrades.filter((t) => regionOf(t) === bookRegion), [allTrades, bookRegion]);
  const flows = useMemo(
    () => allFlows.filter((f) => regionOf(f) === bookRegion), [allFlows, bookRegion]);
  /* The diary belongs to a book as well — an entry is about a trade, and a
     trade is in one market. Shared, it ticked "write one diary entry" in a
     brand new US book on the strength of work done in the Indian one. */
  const diary = useMemo(
    () => allDiary.filter((d) => regionOf(d) === bookRegion), [allDiary, bookRegion]);
  /* And the saved views: one built on Indian trades can only ever match
     nothing in a US book, and a menu of them is the columns leak again. */
  const filters = useMemo(
    () => allFilters.filter((f) => regionOf(f) === bookRegion), [allFilters, bookRegion]);

  /**
   * WHICH BOOK IS BEING READ, told to the formatters once.
   *
   * Every money figure asks `lib/format.js` how to write itself, and it
   * answers in the active book's currency — see the note there for why that is
   * one setting rather than an argument in 142 places. Set during render,
   * before anything below it formats a figure, and `currentRegion` answers IN
   * for a profile that has never heard of regions, which is every profile
   * today.
   */
  setActiveRegion(bookRegion);

  const mergeMarks = useCallback((rows) => {
    if (!rows?.length) return;
    setAllTrades((prev) => prev.map((t) => {
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
    setAllTrades(t);
    setExitsByTrade(x);
    return t;
  }, []);

  /**
   * Saved views, written through and re-read from the row the server returns.
   *
   * The list is replaced by name as well as by id, because saving over an
   * existing name REPLACES that view (043's unique index) — matching on id
   * alone would leave the old row in the menu beside the new one until a
   * reload, showing two entries the database says are one.
   */
  const saveView = useCallback(async (f) => {
    /* Into the book it was built in. Sent only when it is not the default, so
       a save still works before migration 057 — and two books may hold a view
       of the same name, which is what that migration widened the index for. */
    const row = await saveFilter(
      bookRegion === DEFAULT_REGION ? f : { ...f, region: bookRegion });
    setAllFilters((xs) => {
      const rest = xs.filter((x) => x.id !== row.id
        && !(regionOf(x) === regionOf(row)
             && x.name.trim().toLowerCase() === row.name.trim().toLowerCase()));
      return [...rest, row].sort((a, b) =>
        (a.position - b.position) || a.created_at.localeCompare(b.created_at));
    });
    say("View saved.");
    return row;
  }, [say, bookRegion]);

  const removeView = useCallback(async (id) => {
    await deleteFilter(id);
    setAllFilters((xs) => xs.filter((x) => x.id !== id));
    say("View deleted.");
  }, [say]);

  useEffect(() => {
    if (!profile?.onboarded_at) return;
    (async () => {
      try {
        const [t, d, fl, ex, sv, ac] = await Promise.all([
          listTrades(), listDiary(), listFlows(), listExitsByTrade(),
          /* A journal that predates migration 043 has no saved_filters table
             and would fail the whole load on one missing feature. Views are a
             convenience over trades; they are not worth taking the book down
             for, so this one degrades to an empty menu on its own. */
          listFilters().catch(() => []),
          /* Degrades to "India only", which is the free tier, on any database
             where migration 053 has not run. */
          listRegionAccess(),
        ]);
        setAllTrades(t);
        setAllDiary(d);
        setAllFlows(fl);
        setExitsByTrade(ex);
        setAllFilters(sv);
        setAccess(ac);

        /* A partial still has size running, so it wants a mark like any open
           one — but only in the book being read. Marking every market's
           positions asks the quote source for prices nothing on screen will
           show, on every load, out of a rate limit shared with Refresh. */
        const here = currentRegion(profile);
        const openNow = t.filter((x) => isOpen(x) && regionOf(x) === here);
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
  }, [profile?.onboarded_at, profile?.region, mergeMarks]);



  /**
   * READING A BOOK IN THE OTHER CURRENCY. Dollars are what a US book made and
   * stay the default; an Indian trader can read the same figures in rupees at
   * today's rate. Per browser, not per profile — it is how you like to read,
   * not a fact about the account. Set during render, like the region, so the
   * first figure drawn already knows.
   */
  const [showAs, setShowAs] = useState(null);
  const [fx, setFx] = useState(null);
  const homeCurrency = regionInfo(DEFAULT_REGION).currency;
  const bookCurrency = regionInfo(bookRegion).currency;
  const inHome = showAs === homeCurrency && bookCurrency !== homeCurrency && fx?.rate > 0;
  setDisplayCurrency(inHome ? { currency: homeCurrency, rate: fx.rate } : null);

  /* Open, expired, or never granted — the three states worth telling apart. */
  const book = accessState(access, bookRegion);
  const canWriteHere = canWrite(access, bookRegion);
  /**
   * A LOCKED BOOK WITH NOTHING IN IT IS AN OFFER, NOT A JOURNAL.
   *
   * Entering one showed an empty page under two red warnings, which reads as
   * a broken app rather than something to buy. Somebody whose access LAPSED
   * is a different case — they have trades in there worth reading, and that
   * is what "writes blocked, reads kept" was written for.
   */
  const emptyHere = trades.length === 0;
  const showOffer = SHOW_REGIONS && !canWriteHere && emptyHere;

  /* Each book is funded separately — see regionSettings. India keeps the
     columns it always had, so nothing about an Indian journal moves. */
  /**
   * What this book is funded with.
   *
   * The fallback exists so nothing divides by zero, and it is an INDIAN
   * default — ₹10,00,000. In a second book that has never been funded it
   * quietly became "$1,000,000", which turned a real ₹200 risk into 0.02% of
   * an account that does not exist. So the figure is still used, and the book
   * says out loud that it is a placeholder until somebody sets one.
   */
  const bookFunds = regionSettings(profile, bookRegion).account_size;
  const accountSize = bookFunds || 1000000;
  const unfunded = SHOW_REGIONS && bookRegion !== DEFAULT_REGION && !(bookFunds > 0);

  /**
   * Switching books.
   *
   * Written to the profile rather than the browser, so the market you were
   * last reading follows you to another device — the same reasoning as the
   * sample-book flag. Set locally first: the screens re-derive from it, and
   * waiting for a round trip would leave the old book on screen for a beat.
   */
  const switchRegion = async (id) => {
    const next = regionOf({ region: id });
    if (next === bookRegion) return;
    setProfile((p) => ({ ...(p || {}), region: next }));
    try {
      setProfile(await dbSaveProfile({ region: next }));
    } catch (e) {
      say(e.message || "Could not remember that market.");
    }
  };

  /**
   * The sample book, or nothing.
   *
   * Shown only to an account that has never dismissed it AND has no trades of
   * its own — so it survives however many visits it takes to get comfortable,
   * and disappears the moment there is something real to look at instead. See
   * the note in lib/demo.js for why it is never written to the database.
   */
  /**
   * ...or because they asked for it back.
   *
   * Pinning overrides both tests. Somebody who logged one trade to see what
   * would happen, and now cannot work out what the Performance page is for,
   * should not have to delete real data to get the sample back — which was the
   * only remedy before 039, and is exactly the wrong way round.
   *
   * While pinned, their own trades are hidden from the VIEW and nowhere else;
   * see `shown` below, which simply picks one list or the other. The banner
   * says so, because a screen that swaps forty invented trades in for your
   * three real ones without a word is indistinguishable from having lost them.
   */
  const demoPinned = !!profile?.demo_pinned_at;
  /* The sample book is Indian — its symbols, its prices, its charges. Dealing
     it into a US journal would explain the app with stocks that do not trade
     there, so it is offered in India only until there is a US one. */
  const demoOn = !!profile && bookRegion === DEFAULT_REGION &&
    (demoPinned || (!profile.demo_dismissed_at && trades.length === 0));
  const demo = useMemo(
    () => (demoOn
      ? buildDemo({
          userId: profile?.id || userId || "demo",
          accountSize,
          riskPct: profile?.default_risk_pct ?? 0.75,
        })
      : null),
    [demoOn, profile?.id, userId, accountSize, profile?.default_risk_pct]
  );

  /**
   * The first real trade ends it, permanently.
   *
   * An effect rather than something bolted onto saveTrade, because a trade can
   * arrive from an import too, and a rule enforced in two places is a rule
   * enforced in one of them eventually. Writing the flag — rather than relying
   * on `trades.length` staying above zero — means deleting everything later
   * does not resurrect a sample book months in, which would be alarming.
   */
  const demoClosed = useRef(false);
  useEffect(() => {
    if (!profile || profile.demo_dismissed_at || trades.length === 0) return;
    /**
     * Unless it was asked for back, which is the whole point of pinning.
     *
     * Without this the effect fires the instant it sees a trade — which is
     * always, for the person who pinned it — and switches the sample straight
     * off again. The button would appear to do nothing.
     */
    if (profile.demo_pinned_at) return;
    // Once per session. Before 028 has been run the column does not exist and
    // the write fails every time — harmlessly, but there is no reason to ask
    // the database the same question on every mount to get the same no.
    if (demoClosed.current) return;
    demoClosed.current = true;
    dbSaveProfile({ demo_dismissed_at: new Date().toISOString() })
      .then(setProfile)
      .catch(() => { /* the sample is already hidden by the length check */ });
  }, [profile?.id, profile?.demo_dismissed_at, trades.length]);

  /* The user's MTF settings — fees and whether MTF counts in P&L — laid onto
     each trade before it is derived, because the calculation only ever sees a
     trade. Defaults when the profile has none, so nothing changes until the
     user changes it, and nothing breaks before migration 050. */


  useEffect(() => {
    try { setShowAs(localStorage.getItem("ledgerr:show-as") || null); } catch { /* private mode */ }
  }, []);
  const chooseCurrency = (c) => {
    setShowAs(c);
    /* Deliberately NOT scoped to the account, unlike the columns and the
       drafts: fxview.probe.mjs records the decision — reading a US book in
       rupees is how you are looking at the screen, not a fact about whose
       journal it is. */
    try { localStorage.setItem("ledgerr:show-as", c); } catch { /* nothing to lose */ }
  };
  /* Fetched once per book, and not at all for an Indian one — there is
     nothing to convert. A failure costs the conversion and nothing else. */
  useEffect(() => {
    if (bookCurrency === homeCurrency) { setFx(null); return; }
    /* The route wants a signed-in caller and the token comes from the session
       in localStorage, restored a beat after the first render — so without
       this the first attempts 401 and the toggle arrives disabled, then
       silently fixes itself. */
    if (!userId) return;
    let live = true;
    dbFxRate(`${bookCurrency}${homeCurrency}`)
      .then((d) => { if (live && d?.rate > 0) setFx(d); })
      .catch(() => { /* the dollars are the real figures; they are still there */ });
    return () => { live = false; };
  }, [bookCurrency, homeCurrency, userId]);

  const mtf = useMemo(() => mtfPrefs(profile),
    [profile?.mtf_pledge_fee, profile?.mtf_unpledge_fee, profile?.mtf_in_pnl]);

  const all = useMemo(
    () => (demo ? demo.trades : trades).map((raw) => {
      const t = { ...raw, ...mtf };
      return {
        ...t,
        ...derivePosition(withExits(t, exitsByTrade), accountSize),
        status: t.status, // authoritative from the DB; a trigger keeps it in step with the tranches
      };
    }),
    [demo, trades, exitsByTrade, accountSize, mtf]
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
  /**
   * Every position that has banked something — finished or still running.
   *
   * The money population. `closed` answers what kind of trader this is and a
   * part-sold position has no verdict yet; this answers how much arrived, and
   * that does not wait for the rest of the position to be sold.
   *
   * Derived here rather than in each screen so the Dashboard, the period
   * table and the Holdings strip cannot end up counting different books —
   * three screens disagreeing about one number is the thing this journal is
   * least allowed to do.
   */
  const banking = useMemo(
    () => all.filter((t) => t.status === "closed" || Number(t.qtyExited) > 0),
    [all]
  );
  // 'partial' counts as open: there is still size on the table, still risk
  // running, and it still wants a mark-to-market.
  const open = useMemo(
    () => all.filter(isOpen),
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
  /**
   * Stops the importer invented, which the topbar used to never mention.
   *
   * The count above is "no stop at all", and that was the whole nudge — so the
   * moment an import assumed one, the prompt vanished and the /stops page went
   * on listing every one of them. Twenty-four trades to review, and nothing
   * anywhere above said so.
   *
   * Offering the assumption on holdings made it total rather than partial:
   * every imported trade now has a stop, so the old counter is permanently
   * zero and stops were never mentioned again.
   *
   * Counted apart from the missing ones because they are different jobs. No
   * stop means no R at all; an assumed one produces an R from a percentage
   * nobody chose for that trade, which reads like a measurement and is not.
   */
  const assumedStopsCount = useMemo(
    () => trades.filter(
      (t) => t.stop_loss != null && t.stop_source === "assumed" &&
             t.acquisition !== "bonus"
    ).length,
    [trades]
  );
  /**
   * Purchase dates the importer invented and nobody has confirmed.
   *
   * Its own count rather than folded into the one above, because they are
   * different absences with different consequences: no stop means no R at all,
   * an invented date means the holding period, XIRR and every period breakdown
   * quietly skip that trade. Somebody who has filled all their stops should not
   * see the nudge disappear while ten dates are still guesses.
   */
  const needDatesCount = useMemo(
    () => trades.filter((t) => t.entry_date_source === "assumed").length,
    [trades]
  );
  /**
   * What the topbar counts.
   *
   * The same rows every screen below is reading, which these three were not:
   * they counted the real table while the dashboard behind them described the
   * sample, so a new account read "0 closed · 0 open" above a summary of forty
   * trades. needStopsCount deliberately stays on the real table — it drives a
   * chore on the Stops page, and there is no chore to do on invented rows.
   */
  const shown = demo ? demo.trades : trades;
  const closedCount = useMemo(
    () => shown.filter((t) => t.status === "closed").length,
    [shown]
  );
  const openCount = useMemo(
    () => shown.filter(isOpen).length,
    [shown]
  );
  const partialCount = useMemo(
    () => shown.filter(isPartial).length,
    [shown]
  );
  const S = useMemo(() => stats(closed), [closed]);

  const saveTrade = async (payload, exits, chartSrc) => {
    try {
      /* The book it was entered in. Sent only when it is not the default, so
         a save still works against a database where migration 052 has not
         run — and an Indian trade lands as IN either way. */
      const saved = await dbSaveTrade(
        bookRegion === DEFAULT_REGION ? payload : { ...payload, region: bookRegion });

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
          setAllDiary((prev) => [entry, ...prev]
            .sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1)));
          chartSaved = true;
        } catch (e) {
          say("Trade saved, but the chart could not be attached.");
        }
      }

      /*
       * The MTF rate becomes this user's default for the next margin trade.
       * It is what their broker charges, which changes rarely and is the same
       * on every trade, so retyping it each time is pure friction — and it
       * lives on the profile, not in the browser, so it follows them to
       * another machine. Only written when it actually changed.
       *
       * Its own try/catch, like the chart above: the trade is saved, and a
       * default that failed to update must not read as a failed save.
       */
      if (payload.mtf_rate != null && Number(payload.mtf_rate) !== Number(profile?.mtf_rate)) {
        try { setProfile(await dbSaveProfile({ mtf_rate: payload.mtf_rate })); } catch {}
      }

      const [t, ex] = await Promise.all([listTrades(), listExitsByTrade()]);
      setAllTrades(t);
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
    if (String(id).startsWith("demo-")) {
      say("That's sample data — use Clear sample data at the top instead.");
      return;
    }
    if (!window.confirm("Delete this trade? This can't be undone.")) return;
    try {
      await dbDeleteTrade(id);
      setAllTrades((prev) => prev.filter((x) => x.id !== id));
      say("Trade removed.");
    } catch (e) {
      say(e.message || "Could not delete the trade.");
    }
  };

  const saveDiaryEntry = async (entry, imageFile) => {
    try {
      /* Into the book it was written in — sent only when it is not the
         default, so a save still works before migration 055. */
      const saved = await dbSaveDiary(
        bookRegion === DEFAULT_REGION ? entry : { ...entry, region: bookRegion },
        imageFile);
      setAllDiary((prev) => {
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
      setAllDiary((prev) => prev.filter((x) => x.id !== entry.id));
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
        setAllDiary((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
        say("Chart removed — the note is still there.");
      } else {
        await dbDeleteDiary(entry);
        setAllDiary((prev) => prev.filter((x) => x.id !== entry.id));
        say("Chart removed.");
      }
    } catch (e) {
      say(e.message || "Could not remove the chart.");
    }
  };

  /**
   * Put the sample book away.
   *
   * Written to the profile rather than the browser, so dismissing it on a
   * laptop does not bring it back on a phone. Nothing is deleted because
   * nothing was ever stored — the flag is the whole of it, which is also why
   * this needs no confirmation: there is nothing here to lose.
   */
  /**
   * Back to the sample book, from the empty dashboard.
   *
   * The same pin the profile sheet writes. It lived only there, which meant
   * the one person who needs the sample most — an empty journal that has
   * dismissed it, or landed with it already off — had to find a settings
   * sheet to get a full app to look at. Here it is a button on the page they
   * are already looking at.
   */
  const showDemo = async () => {
    try {
      setProfile(await setDemoPinned(true));
    } catch (e) {
      say(e.message || "Could not show the sample.");
    }
  };

  const dismissDemo = async () => {
    try {
      setProfile(await dbSaveProfile({
        demo_dismissed_at: new Date().toISOString(),
        /**
         * Clearing the pin as well, or the button does nothing.
         *
         * Pinning outranks the dismissal — that is what makes it work at all —
         * so writing only the dismissal would leave a sample the user has just
         * asked to be rid of still sitting there, with the button apparently
         * broken. Whichever of the two was set last should win, and this is
         * the one they clicked.
         */
        demo_pinned_at: null,
      }));
    } catch (e) {
      say(e.message?.includes("demo_dismissed_at")
        ? "Run 028_demo_dismissed.sql to keep this dismissed."
        : e.message || "Could not dismiss the sample data.");
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
    /* A book you may read but not add to. The database would refuse the save
       — see migration 053 — so the form is not opened onto a dead end. */
    if (!canWriteHere) {
      say(book.state === "expired"
        ? `Your access to this market ended. The book stays readable; new trades need it renewed.`
        : `This market is not open on your account yet. Ask for access and it unlocks here.`);
      return;
    }
    setEditing(null); setSelling(false); setShowForm(true);
  }, [canWriteHere, book.state, say]);
  /**
   * Refused on a sample trade, and every write path is guarded the same way.
   *
   * Without this, opening one of the generated trades and pressing Save would
   * write a genuine row full of invented numbers — indistinguishable, from
   * then on, from something the user actually did. That is the one way this
   * feature could corrupt a real journal, so the answer is no rather than a
   * filter somewhere downstream.
   */
  const refuseDemo = useCallback((t) => {
    if (!t?.demo) return false;
    say("That's sample data — clear it and log your own trade.");
    return true;
  }, [say]);

  const openEditTrade = useCallback((t) => {
    if (refuseDemo(t)) return;
    setEditing(t); setSelling(false); setShowForm(true);
  }, [refuseDemo]);
  // Same form, opened on the sell rather than the setup. "Exit" is the word
  // that's in mind when a position is being closed, and hunting for it under
  // Edit is a step nobody asked for.
  const openExitTrade = useCallback((t) => {
    if (refuseDemo(t)) return;
    setEditing(t); setSelling(true); setShowForm(true);
  }, [refuseDemo]);

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
            authErr={authErr} busy={busy}
            signInPassword={signInPassword} signUpPassword={signUpPassword}
            signInGoogle={signInGoogle}
            sendReset={sendReset} resetToEmailForm={resetToEmailForm}
          />
        }
        view={authView}
        switchAuthView={switchAuthView}
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
        profile={profile}
        avatar={avatar}
        onProfileChange={setProfile}
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
        trades, diary: demo ? demo.diary : diary, flows, profile, accountSize,
        bookRegion, switchRegion, access, canWriteHere, bookAccess: book,
        /* The user's OWN progress, for the first-week card. `diary` above is
           the sample book's while that is showing, and counting it would tick
           a step the user has not done. */
        ownDiaryCount: diary.length, needStopsCount, assumedStopsCount, userId,
        demoOn, showDemo,
        all, closed, open, banking, S,
        say,
        openNewTrade, openEditTrade, openExitTrade,
        removeTrade,
        saveDiaryEntry, removeDiaryEntry, removeChartFromEntry,
        mergeMarks, reloadTrades,
        filters, saveView, removeView,
      }}
    >
      <div>
        <div className="topbar">
          <div className="topin">
            <div style={{ flex: "1 1 240px" }}>
              <div className="brand">
                {/* The product mark beside the journal's own name. The heading
                    here is the USER's title for their journal, not the brand,
                    so the mark is what says whose software they are in. */}
                <h1 className="disp" style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <Wordmark size={17} showMark className="tb-lock" />
                  <span className="tb-sep" aria-hidden="true" />
                  {profile?.journal_name || "Breakout Ledger"}
                </h1>
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
                  {/* Only when nothing is missing outright — otherwise the two
                      stop counts sit side by side and read as one number split
                      oddly. "Add the missing ones" is the bigger job and
                      subsumes the review, which the Stops page then separates
                      properly. */}
                  {needStopsCount === 0 && assumedStopsCount > 0 && (
                    <>
                      {" · "}
                      <Link href="/stops" className="brand-todo">
                        {assumedStopsCount} stop{assumedStopsCount === 1 ? "" : "s"} to check
                      </Link>
                    </>
                  )}
                  {/* Same queue, said separately. Both are shown when both
                      apply — a holdings import produces exactly that, and
                      collapsing them into one number would hide that the two
                      chores cost different things to leave undone. */}
                  {needDatesCount > 0 && (
                    <>
                      {" · "}
                      <Link href="/stops" className="brand-todo">
                        {needDatesCount} need a date
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
              {/* Before New trade, because it decides which book that trade
                  lands in. */}
              {SHOW_REGIONS && (
                <RegionSwitch value={bookRegion} onChange={switchRegion}
                              markets={accessFor(access, REGIONS)} />
              )}
              {SHOW_REGIONS && (
                <CurrencyView book={bookRegion} value={showAs} rate={fx?.rate}
                              at={fx?.at} onChange={chooseCurrency} />
              )}
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
                onSupport={() => router.push("/support")}
                onSignOut={() => signOut()}
              />
            </div>
          </div>
        </div>

        <div className="jwrap">
          {flash && <div className="warn" style={{ marginTop: 14 }}>{flash}</div>}
          {/* Here rather than on the dashboard, so it is above whichever screen
              somebody is actually reading. */}
          {demo && (
            <div style={{ paddingTop: 16 }}>
              {/* `trades` is the real list, untouched by the sample — so its
                  length is exactly what is being hidden right now. */}
              <DemoBanner onDismiss={dismissDemo}
                          pinned={demoPinned}
                          hiddenCount={trades.length} />
            </div>
          )}
          {/* A market this account may read and not write. Said once, above
              whichever screen is open, rather than discovered at the Save
              button — which is where the database would say it. */}
          {inHome && (
            <div className="hint" style={{ marginTop: 14 }}>
              Shown in rupees at today&apos;s rate, ₹{fx.rate.toFixed(2)} to the dollar —
              what this book is worth to you now, not what each trade made at the time.
              {/* Prices are what the market quotes, and converting them would
                  invent a number nobody ever dealt at. Said here, because a
                  table of rupee totals beside a dollar entry price is the one
                  place this view could be misread. */}
              {" "}Entry, stop and CMP stay in dollars — that is what you paid and what
              the market quotes. R is unaffected either way: it is a ratio.
            </div>
          )}
          {/* Not in a book you cannot write in: it asks you to configure
              something you have no way to use. */}
          {unfunded && canWriteHere && (
            <div className="warn" style={{ marginTop: 16 }}>
              <b>This book has no account size yet.</b>{" "}
              Risk percentages and position sizing are assuming{" "}
              {money(accountSize)} until you set one in{" "}
              <button className="lk" onClick={() => setShowSettings(true)}>Setup</button>.
            </div>
          )}
          {/* Lapsed, with a book behind it: one line, and in they go. */}
          {SHOW_REGIONS && !canWriteHere && !emptyHere && (
            <div className="warn" style={{ marginTop: 16 }}>
              <b>{regionInfo(bookRegion).label} is read-only on your account.</b>{" "}
              {book.state === "expired"
                ? "Your access ended, so this book stays open to read and closed to new trades."
                : "You can look around; logging trades here needs access."}
            </div>
          )}
          {/* The mirror of it: no sample, and nothing of their own either, so
              every screen below is an explanation of its own emptiness. Same
              slot on purpose — whichever tab they are reading is the one that
              has to offer the way out. */}
          {/* India only, like the sample itself. Offered in a US book it was a
              button that did nothing: `demoOn` refuses to deal Indian stocks
              into a US journal, so the click was answered by silence — the
              worst possible answer, because it reads as an app that is
              broken rather than one that is empty. */}
          {!demo && trades.length === 0 && bookRegion === DEFAULT_REGION && (
            <div style={{ paddingTop: 16 }}>
              <SampleOffer onShow={showDemo} />
            </div>
          )}
          {showOffer
            ? <RegionOffer region={bookRegion} state={book.state}
                           onBack={() => switchRegion(DEFAULT_REGION)} />
            : children}
        </div>

        {showForm && (
          <TradeForm initial={editing} accountSize={accountSize} defaultRiskPct={profile?.default_risk_pct}
                     chargeConfig={profile?.charge_config} startSelling={selling}
                     defaultMtfRate={profile?.mtf_rate}
                     mtfPrefs={mtf}
                     profile={profile}
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
            bookRegion={bookRegion}
            onClose={() => setShowProfile(null)}
          />
        )}

        {showSettings && (
          <SettingsSheet
            profile={profile}
            onSave={saveSettings}
            onClose={() => setShowSettings(false)}
            needStopsCount={needStopsCount}
            /* The user's own rows, not the sample's: the count beside a setup
               is what makes "this one is still in use" checkable. */
            trades={trades}
            onProfileChange={setProfile}
            bookRegion={bookRegion}
            rate={fx?.rate || 0}
            onNavigate={(href) => { setShowSettings(false); router.push(href); }}
          />
        )}
      </div>
    </JournalContext.Provider>
  );
}
