"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/db";
import Journal from "@/components/journal/Journal";

export default function Home() {
  const [session, setSession] = useState(null);
  const [booted, setBooted] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authErr, setAuthErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBooted(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async () => {
    setBusy(true); setAuthErr("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthErr(error.message);
    setBusy(false);
  };

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

  return <Journal />;
}
