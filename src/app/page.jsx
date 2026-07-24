"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/db";
import SymbolSearch from "@/components/SymbolSearch";

/**
 * Setup check.
 *
 * This page exists to prove the plumbing works before the full journal UI
 * lands: can you sign in, does Postgres answer, did the symbol list build,
 * and is a quote coming back. Once the dashboard is ported this becomes the
 * journal itself.
 */

function Check({ state, title, detail }) {
  return (
    <div className="check">
      <div className="dot" data-s={state} />
      <div>
        <b>{title}</b>
        <span>{detail}</span>
      </div>
    </div>
  );
}

export default function Home() {
  const [session, setSession] = useState(null);
  const [booted, setBooted] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authErr, setAuthErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [db, setDb] = useState({ s: "wait", d: "Checking…" });
  const [syms, setSyms] = useState({ s: "wait", d: "Checking…" });
  const [quote, setQuote] = useState({ s: "wait", d: "Checking…" });
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBooted(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const runChecks = useCallback(async () => {
    // Database
    try {
      const { count, error } = await supabase
        .from("trades").select("*", { count: "exact", head: true });
      if (error) throw error;
      setDb({ s: "ok", d: `Connected. ${count ?? 0} trades stored.` });
    } catch (e) {
      setDb({ s: "fail", d: `${e.message}. Did schema.sql run without errors?` });
    }

    // Symbol list
    try {
      const r = await fetch("/symbols.json");
      if (!r.ok) throw new Error("symbols.json not found");
      const list = await r.json();
      const nse = list.filter((x) => x.e === "NSE").length;
      const bse = list.filter((x) => x.e === "BSE").length;
      setSyms({
        s: list.length ? "ok" : "fail",
        d: `${list.length} symbols — NSE ${nse}, BSE ${bse}.`,
      });
    } catch {
      setSyms({ s: "fail", d: "Not built yet. Run: npm run symbols" });
    }

    // Quotes
    try {
      const r = await fetch("/api/quotes?s=RELIANCE:NSE");
      const j = await r.json();
      const q = j.quotes?.[0];
      if (q?.price) setQuote({ s: "ok", d: `RELIANCE last traded at ₹${q.price}.` });
      else setQuote({ s: "fail", d: j.error || "No price returned. Source may be rate-limiting." });
    } catch (e) {
      setQuote({ s: "fail", d: e.message });
    }
  }, []);

  useEffect(() => { if (session) runChecks(); }, [session, runChecks]);

  const signIn = async () => {
    setBusy(true); setAuthErr("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthErr(error.message);
    setBusy(false);
  };

  if (!booted) {
    return <div className="wrap"><div className="eyebrow">Starting up</div></div>;
  }

  /* ----------------------------- signed out ---------------------------- */
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

  /* ----------------------------- signed in ----------------------------- */
  const allGood = [db, syms, quote].every((x) => x.s === "ok");

  return (
    <div className="wrap">
      <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "baseline", marginBottom: 26, gap: 12 }}>
        <div>
          <div className="eyebrow">Trading Journal</div>
          <h1 className="disp" style={{ fontSize: 22, margin: "6px 0 0" }}>Setup check</h1>
        </div>
        <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <Check state="ok" title="Signed in" detail={session.user.email} />
        <Check state={db.s} title="Database" detail={db.d} />
        <Check state={syms.s} title="Symbol list" detail={syms.d} />
        <Check state={quote.s} title="Quote source" detail={quote.d} />
      </div>

      {allGood && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            Try the autocomplete — type three letters
          </div>
          <SymbolSearch onPick={setPicked} />
          {picked && (
            <div className="mono" style={{ marginTop: 14, fontSize: 13, color: "var(--ink2)" }}>
              {picked.symbol} · {picked.exchange}
              <div style={{ fontFamily: "Archivo, sans-serif", fontSize: 12, marginTop: 3 }}>
                {picked.company}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: 12.5, color: "var(--ink3)", lineHeight: 1.7 }}>
        {allGood
          ? "Everything is wired up. The dashboard, trade sheet, performance sheet and diary come next — they port across from the prototype."
          : "Fix anything showing red above, then refresh this page."}
      </div>
    </div>
  );
}
