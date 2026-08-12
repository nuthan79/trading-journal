"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Crown } from "lucide-react";
import SettingsNav, { SECTIONS } from "@/components/journal/SettingsNav";
import ImportTrades from "@/components/ImportTrades";
import ContactForm from "@/components/ContactForm";
import AvatarChoice from "@/components/journal/AvatarChoice";
import { listImportTargets, importTrades } from "@/lib/db";
import { BRAND } from "@/lib/brand";
import { useJournal } from "../JournalContext";

/**
 * Settings, as a place rather than three.
 *
 * The account sheet, the setup sheet and the import route each held part of
 * this and none of them knew about the others. A modal is also the wrong shape
 * for importing a file: it is a job with a preview, a decision and a commit,
 * and it should not be something you can lose by clicking beside it.
 *
 * THE SECTION IS IN THE URL, so a link can point at one — "Settings →
 * Integration" in a support reply is only useful if it can be a link.
 */

function Panel({ title, sub, children }) {
  return (
    <section className="st-panel">
      <header className="st-head">
        <h1 className="disp st-title">{title}</h1>
        <p className="st-sub">{sub}</p>
      </header>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function IntegrationPanel() {
  const router = useRouter();
  const { reloadTrades, say } = useJournal();
  const [targets, setTargets] = useState(null);
  const [err, setErr] = useState("");

  // Loaded before the picker is usable. Without the positions already here, an
  // overlapping file can't tell a trade it has never seen from one that has
  // simply been scaled out further since the last import.
  useEffect(() => {
    listImportTargets()
      .then(setTargets)
      .catch((e) => setErr(e.message || "Could not read existing trades."));
  }, []);

  if (err) {
    return <div className="warn">{err} — this usually means migration 006 hasn&apos;t been run yet.</div>;
  }
  if (!targets) return <div className="eyebrow">Checking what&rsquo;s already here</div>;

  return (
    <ImportTrades
      targets={targets}
      onImport={async (payload) => {
        const res = await importTrades(payload);
        await reloadTrades();
        return res;
      }}
      onDone={(choice) => {
        say(choice === "fill-stops" ? "" : "Imported trades are in your trade sheet.");
        router.push(choice === "fill-stops" ? "/stops" : "/trades");
      }}
    />
  );
}

/* ------------------------------------------------------------------ */

/**
 * What the plan is, said honestly.
 *
 * Deliberately not the three-card pricing table of the reference. There is no
 * price, no trial and no renewal date, because nothing is charged — printing a
 * "$25/mo" card that cannot be bought would be the one screen in this app that
 * lies. When billing is real this becomes a real chooser.
 */
function BillingPanel() {
  return (
    <>
      <div className="st-card">
        <div className="st-row"><span>Plan</span><b className="mono">Free</b></div>
        <div className="st-row"><span>Status</span><b className="mono st-ok">Active</b></div>
        <div className="st-row"><span>Renews</span><b className="mono">—</b></div>
        <div className="st-row"><span>Payment method</span><b className="mono">None held</b></div>
      </div>

      <div className="st-plan">
        <Crown size={15} />
        <div style={{ minWidth: 0 }}>
          <b>Free while this is being built</b>
          <p>
            There is nothing to pay and no card on file. If {BRAND.name} ever does
            charge, two things stay true: you will be told before it happens, and
            nothing you have logged gets locked behind it — an expired plan still
            reads, and still exports everything.
          </p>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

const FAQ = [
  {
    q: "Why is a trade missing from my statistics?",
    a: "Almost always a missing stop. Without one there is no 1R, and anything measured " +
       "in R has nothing to divide by — so the trade sits in the sheet but not in " +
       "expectancy, the R distribution or the drawdown. The Stops page lists every one " +
       "still waiting.",
  },
  {
    q: "Can I import from a broker other than Zerodha?",
    a: "Not yet. Each broker's tax report has its own columns and sections, and an " +
       "adapter written from a guess produces numbers that look right and are not. " +
       "Send the file through Support and it can be added properly.",
  },
  {
    q: "Why don't my charges match my contract note exactly?",
    a: "They are computed from the statutory rates and your broker settings under " +
       "Setup, so a different brokerage plan will differ. Any trade's figure can be " +
       "overridden by typing it, and an overridden figure is never recalculated.",
  },
  {
    q: "Is my data used for anything else?",
    a: "No. It is not sold, not shared, and not used to train anything. You can take " +
       "the whole lot as one file from Profile, or delete the account outright.",
  },
];

function SupportPanel() {
  const [open, setOpen] = useState(null);
  return (
    <>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Ask a question</div>
      <ContactForm />

      <div className="eyebrow" style={{ margin: "30px 0 10px" }}>Common questions</div>
      <div className="st-faq">
        {FAQ.map((f, i) => (
          <div key={f.q} className="st-q">
            <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
              <span>{f.q}</span><i>{open === i ? "−" : "+"}</i>
            </button>
            {open === i && <p>{f.a}</p>}
          </div>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function SettingsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { profile, avatar, setProfile } = useJournal();

  const wanted = params.get("s");
  const active = SECTIONS.some((s) => s.id === wanted) ? wanted : "profile";

  const pick = (id) => router.replace(`/settings?s=${id}`, { scroll: false });
  const meta = SECTIONS.find((s) => s.id === active);

  return (
    <div className="sec st-wrap">
      <aside className="st-side"><SettingsNav active={active} onPick={pick} /></aside>

      <div className="st-main">
        {active === "profile" && (
          <Panel title="Profile" sub="Your picture and the account behind it">
            <AvatarChoice profile={profile} avatar={avatar} onChanged={setProfile} />
            <p className="st-note">
              Your email, password, export and account deletion are in the account menu
              at the top right — they need the session rather than the journal, and are
              deliberately not somewhere you can wander into.
            </p>
          </Panel>
        )}

        {active === "setup" && (
          <Panel title="Setup" sub="What every figure is measured against">
            <p className="st-note">
              Account size, default risk and your broker&rsquo;s charges live in the Setup
              sheet — open it from the account menu. Moving it here is the next step;
              it autosaves as you type and that needs care to relocate.
            </p>
          </Panel>
        )}

        {active === "integration" && (
          <Panel title="Integration" sub="Bring in what you have already traded">
            <IntegrationPanel />
          </Panel>
        )}

        {active === "billing" && (
          <Panel title="Billing" sub="Plan and renewal"><BillingPanel /></Panel>
        )}

        {active === "support" && (
          <Panel title="Support" sub="Ask for help, or tell us what is wrong">
            <SupportPanel />
          </Panel>
        )}
      </div>

      <style jsx global>{`
        .st-wrap { display: grid; grid-template-columns: 230px 1fr; gap: 30px; align-items: start; }
        .st-side { position: sticky; top: 96px; }
        .st-main { min-width: 0; }
        .st-head { border-bottom: 1px solid var(--rule); padding-bottom: 14px; margin-bottom: 22px; }
        .st-title { font-size: 24px; margin: 0; }
        .st-sub { font-size: 13px; color: var(--ink2); margin: 5px 0 0; }
        .st-note {
          font-size: 12.5px; line-height: 1.7; color: var(--ink3);
          margin: 18px 0 0; max-width: 62ch;
        }
        .st-card {
          border: 1px solid var(--rule); background: var(--card);
          border-radius: 3px; overflow: hidden;
        }
        .st-row {
          display: flex; justify-content: space-between; gap: 16px;
          padding: 12px 15px; border-bottom: 1px solid var(--rule); font-size: 13px;
        }
        .st-row:last-child { border-bottom: 0; }
        .st-row span { color: var(--ink2); }
        .st-ok { color: var(--long); }
        .st-plan {
          display: flex; gap: 11px; margin-top: 14px; padding: 14px 15px;
          border: 1px solid var(--brass); background: #FBF6EA; border-radius: 3px;
          color: #6A4E12;
        }
        .st-plan b { font-size: 13.5px; }
        .st-plan p { font-size: 12.5px; line-height: 1.65; margin: 5px 0 0; }

        .st-faq { border-top: 1px solid var(--rule); }
        .st-q { border-bottom: 1px solid var(--rule); }
        .st-q button {
          display: flex; justify-content: space-between; align-items: center; gap: 14px;
          width: 100%; background: none; border: 0; padding: 14px 2px;
          font: inherit; font-size: 13.5px; color: var(--ink); text-align: left; cursor: pointer;
        }
        .st-q button i { font-style: normal; font-size: 17px; color: var(--ink3); }
        .st-q p {
          font-size: 13px; line-height: 1.7; color: var(--ink2);
          margin: 0 0 15px; max-width: 68ch;
        }

        @media (max-width: 860px) {
          .st-wrap { grid-template-columns: 1fr; gap: 10px; }
          .st-side { position: static; }
        }
      `}</style>
    </div>
  );
}

/** useSearchParams needs a Suspense boundary or the build refuses to
 *  prerender the route. */
export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="sec"><div className="eyebrow">Settings</div></div>}>
      <SettingsInner />
    </Suspense>
  );
}
