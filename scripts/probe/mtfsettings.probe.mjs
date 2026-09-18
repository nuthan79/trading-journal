import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq, near } from "./harness.mjs";
import { derivePosition, realisationEvents } from "@/lib/positions";
import { headline, byPeriod } from "@/lib/calc";
import { mtfPrefs, PLEDGE_FEE, UNPLEDGE_FEE } from "@/lib/mtf";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * THE USER'S MTF SETTINGS: their own pledge and unpledge fees, and whether MTF
 * comes out of P&L and R or is shown as an expense only.
 *
 * The trap in "expense only" is the per-sell split, which derives each sell's
 * charges from whatever lies between gross and realised P&L. Leave MTF out of
 * realised P&L but subtract it there anyway and it is found twice; subtract it
 * nowhere there while it IS in realised P&L and it turns into "charges". Both
 * move the Charges figure, which must be identical in either mode.
 */
const PSD = (1000 * (1 - 1 / 2.35) * 40) / 1e5;
const trade = (prefs) => {
  const t = {
    id: "m", symbol: "M", side: "long", status: "closed", entry_date: "2026-09-01",
    entry_price: 1000, quantity: 235, stop_loss: 980, stop_source: "recorded", charges: 40,
    mtf_leverage: 2.35, mtf_rate: 40, exit_date: "2026-09-11", exit_price: 1078.72,
    exits: [
      { exit_date: "2026-09-05", quantity: 100, price: 1050, charges: 12 },
      { exit_date: "2026-09-11", quantity: 135, price: 1100, charges: 15 },
    ],
    ...prefs,
  };
  return { ...t, ...derivePosition(t, 5e6), status: t.status, exits: t.exits };
};
const GROSS = 100 * 50 + 135 * 100;                     // 18,500
const INTEREST = 100 * PSD * 4 + 135 * PSD * 10;
const CHARGES = 40 + 12 + 15;

test("defaults: ₹18 and ₹18, counted — exactly as before the setting existed", () => {
  const p = mtfPrefs(null);
  eq(p._mtfPledge, PLEDGE_FEE); eq(p._mtfUnpledge, UNPLEDGE_FEE); eq(p._mtfInPnl, true);
  const t = trade(p);
  near(t.pledgeFees, 18 + 18 * 2, 1e-9);
  near(t.realisedPnl, GROSS - CHARGES - INTEREST - 54, 0.001);
});

test("a profile with no MTF columns yet falls back to the defaults", () => {
  /* Before migration 050, the fields are simply absent. */
  const p = mtfPrefs({ id: "x", account_size: 1e6 });
  eq(p._mtfPledge, 18); eq(p._mtfUnpledge, 18); eq(p._mtfInPnl, true);
});

test("the user's own fees are the ones charged", () => {
  const t = trade(mtfPrefs({ mtf_pledge_fee: 20, mtf_unpledge_fee: 15 }));
  near(t.pledgeFees, 20 + 15 * 2, 1e-9);
  near(t.realisedPnl, GROSS - CHARGES - INTEREST - 50, 0.001);
  const evs = realisationEvents(t);
  near(evs.reduce((a, e) => a + e.fees, 0), 50, 1e-9, "the split charges the same fees");
});

test("zero fees are allowed, and a nonsense value falls back", () => {
  eq(mtfPrefs({ mtf_pledge_fee: 0 })._mtfPledge, 0, "a broker with no pledge fee");
  eq(mtfPrefs({ mtf_pledge_fee: -5 })._mtfPledge, 18, "negative is not a fee");
  eq(mtfPrefs({ mtf_pledge_fee: "abc" })._mtfPledge, 18);
});

test("expense only: worked out and reported, taken out of nothing", () => {
  const on = trade(mtfPrefs({ mtf_in_pnl: true }));
  const off = trade(mtfPrefs({ mtf_in_pnl: false }));
  near(off.realisedPnl, GROSS - CHARGES, 0.001, "P&L is before MTF");
  near(off.margin, on.margin, 1e-9, "but MTF is still worked out, the same amount");
  eq(off.marginInPnl, false);
  eq(on.marginInPnl, true);
  near(off.r, off.pnl / (20 * 235), 1e-9, "and R follows the P&L");
});

test("expense only: the Charges figure is identical in both modes", () => {
  for (const counted of [true, false]) {
    const t = trade(mtfPrefs({ mtf_in_pnl: counted }));
    const evs = realisationEvents(t);
    near(evs.reduce((a, e) => a + e.charge, 0), CHARGES, 1e-6,
      `${counted ? "counted" : "expense only"}: charges are charges, nothing more`);
    near(evs.reduce((a, e) => a + e.pnl, 0), t.realisedPnl, 1e-6, "and the sells still sum to the position");
    near(evs.reduce((a, e) => a + e.margin, 0), t.realisedMargin, 1e-6);
  }
});

test("expense only: the totals report MTF and say it was not taken out", () => {
  const t = trade(mtfPrefs({ mtf_in_pnl: false }));
  const h = headline([t], { openingCapital: 5e6, banking: [t] });
  near(h.charges, CHARGES, 1e-6);
  near(h.margin, t.realisedMargin, 1e-6, "still reported");
  eq(h.marginCounted, false);
  const rows = byPeriod([t], "fy", { openingCapital: 5e6, basis: "exit" });
  ok(rows.every((r) => r.marginCounted === false));
  near(rows.reduce((a, r) => a + r.pnl, 0), h.netPnl, 1e-6, "the year still sums to the Dashboard");
});

test("a trade not on margin reads as counted, never as 'MTF not taken out'", () => {
  const t = trade({ ...mtfPrefs({ mtf_in_pnl: false }), mtf_leverage: null, mtf_rate: null });
  eq(t.marginInPnl, true);
  eq(t.margin, 0);
});

/* ---- wiring --------------------------------------------------------- */

test("the layout lays the settings onto every trade before deriving it", () => {
  const s = read("app/(app)/layout.jsx");
  ok(/const t = \{ \.\.\.raw, \.\.\.mtf \};/.test(s));
  ok(/\[demo, trades, exitsByTrade, accountSize, mtf\]/.test(s), "and recomputes when they change");
});

test("the form's figures use the same settings", () => {
  const s = read("components/journal/TradeForm.jsx");
  ok(/\.\.\.t, \.\.\.\(mtfPrefs \|\| \{\}\), charges: split\.tradeCharges/.test(s));
  ok(/pledgeFee: mtfPrefs\?\._mtfPledge, unpledgeFee: mtfPrefs\?\._mtfUnpledge/.test(s));
});

test("the settings fields never reach the database", () => {
  /* They ride on derived rows; every write must build its own field list. */
  const db = read("lib/db.js");
  ok(!/_mtf/.test(db));
  const form = read("components/journal/TradeForm.jsx");
  const payload = form.slice(form.indexOf("function toPayload"), form.indexOf("\n}\n", form.indexOf("function toPayload")));
  ok(!/_mtf|\.\.\.t\b/.test(payload), "the trade payload is explicit");
});

test("Setup sends the MTF settings only when they changed", () => {
  /* Sent every time, a Setup save would fail before migration 050 for a user
     who only changed their account size. */
  const s = read("components/journal/SettingsSheet.jsx");
  ok(/\.\.\.\(pledge !== mtfNow\._mtfPledge \? \{ mtf_pledge_fee: pledge \} : \{\}\)/.test(s));
  ok(/\.\.\.\(unpledge !== mtfNow\._mtfUnpledge \? \{ mtf_unpledge_fee: unpledge \} : \{\}\)/.test(s));
  ok(/\.\.\.\(inPnl !== mtfNow\._mtfInPnl \? \{ mtf_in_pnl: inPnl \} : \{\}\)/.test(s));
});

test("an old Setup draft still opens with the MTF fields filled in", () => {
  const s = read("components/journal/SettingsSheet.jsx");
  ok(/mtf_in_pnl: mtfNow\._mtfInPnl,\s*\.\.\.\(persisted\?\.s \|\| \{\}\),/.test(s),
    "defaults first, the draft laid over them");
});

test("a blank or negative fee in Setup keeps the fee there was", () => {
  const s = read("components/journal/SettingsSheet.jsx");
  ok(/v !== "" && Number\.isFinite\(n\) && n >= 0 && n < 1000 \? n : was/.test(s), "and nothing past ₹999.99");
});

test("migration 050 defaults to exactly what the code falls back to", () => {
  const sql = readFileSync(path.join(SRC, "../supabase/050_mtf_settings.sql"), "utf8");
  ok(/mtf_pledge_fee\s+numeric not null default 18/.test(sql));
  ok(/mtf_unpledge_fee numeric not null default 18/.test(sql));
  ok(/mtf_in_pnl\s+boolean not null default true/.test(sql));
  eq(PLEDGE_FEE, 18); eq(UNPLEDGE_FEE, 18);
});

test("Setup: the choice is a plain question, and one word is used for it everywhere", () => {
  const setup = read("components/journal/SettingsSheet.jsx");
  ok(/Deduct MTF from P&amp;L and R\?/.test(setup));
  ok(/Yes, deduct it/.test(setup) && /No, show it separately/.test(setup));
  /* "taken out", "expense only" — the old words — nowhere a user reads. */
  const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const f of ["components/journal/SettingsSheet.jsx", "components/journal/HeadlineNumbers.jsx",
                   "components/journal/PeriodPerformance.jsx", "components/journal/PositionDetail.jsx",
                   "components/journal/TradeForm.jsx", "lib/columns.js"]) {
    ok(!/taken out|expense only/i.test(strip(read(f))), `${f} still uses the old wording`);
  }
});

test("Setup: the fee boxes are sized for ₹999.99", () => {
  const s = read("components/journal/SettingsSheet.jsx");
  ok(/className="in mono st-fee" inputMode="decimal" maxLength=\{6\}/.test(s));
  ok(/\.st-fee \{ max-width: 110px; \}/.test(s));
});

test("Setup: the Trades section is hidden behind a flag, not deleted", () => {
  const s = read("components/journal/SettingsSheet.jsx");
  ok(/\{SHOW_SETUP_TRADES && \(/.test(s), "still in the code, one flag from coming back");
  ok(/export const SHOW_SETUP_TRADES = false;/.test(read("lib/flags.js")));
});
