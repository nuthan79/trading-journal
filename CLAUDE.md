# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal swing-trading journal for NSE/BSE (India), INR-only. Next.js 16 App
Router + React 19, Supabase (Postgres, Auth via Google OAuth, Storage for chart
images). Everything is measured in **R** (P&L ÷ risk taken on the trade), so a
₹8,000 win on a tight stop and a ₹40,000 win on a wide one are comparable.

## Commands

```bash
npm run dev       # http://localhost:3000
npm run build     # production build — run this before committing any change
npm run symbols   # rebuild public/symbols.json — NSE and BSE both download
                   # automatically. Refuses to write a file >10% smaller than
                   # the existing one; pass --force only if it really shrank.
```

There is no test suite and no lint script configured.

## Architecture

**Storage layer is the seam.** `src/lib/db.js` is the *only* file that talks to
Supabase. It exports same-shaped `list*`/`save*`/`delete*` functions per table
(trades, diary_entries, capital_flows, profiles) using `.select("*")` reads and
pass-through `upsert`/`update` writes — no column allowlists, so the schema
(`supabase/schema.sql`) is the source of truth for what fields exist. UI
components never call Supabase directly.

**Quote source is also a single seam.** `src/lib/quotes.js` exports one
function with a fixed shape; `src/app/api/quotes/route.js` proxies it
server-side (the browser can't call Yahoo directly due to CORS). Swapping quote
providers (Yahoo default → a broker API) means editing only `quotes.js`.
Quotes are cached 60s and the app degrades gracefully if the source is down —
open positions just show no mark.

**Symbol autocomplete is static, not live.** `scripts/build-symbols.mjs`
builds `public/symbols.json` once (NSE + BSE, series EQ/BE/BZ) and
`src/components/SymbolSearch.jsx` searches it in-memory client-side — this is
why the 3-character autocomplete is instant. Re-run `npm run symbols`
periodically; nothing in the running app fetches this list dynamically.
One row per *listing*, not per company, so a dual-listed name appears twice
with its own `e`. **That ordering is load-bearing**: `isin.js` takes the first
row per ISIN, so NSE coming first is what decides which exchange ~2,400
dual-listed companies resolve to on import. BSE rows carry `c`, the scrip
code — kept as the canonical BSE id and **never usable as a Yahoo ticker**
(measured: `CODE.BO` returns a different security).

**Three broker file kinds, three jobs, no overlap.** `brokers/index.js`
dispatches on an adapter's `kind`, and `ImportTrades.jsx` branches on it:

| kind | yields | writes trades? |
|---|---|---|
| `taxpnl` (default) | closed trades — real charges | yes |
| `holdings` | open positions — complete, no purchase date | yes |
| `tradebook` | entry dates for positions already held | **no** |

A tradebook deliberately imports nothing: its closed lots would duplicate the
tax P&L's while being worse (no charges, mis-pairs pre-file buys). Anything
re-deriving a preview must test `kindOf(b) !== "taxpnl"` rather than naming
kinds to skip — naming them is what crashed the screen when the third arrived.

**An assumed value must be a flag the calculations consult, not a tint.**
`stop_source` and `entry_date_source` (036) both mean "the importer invented
this". `calc.js`/`positions.js` refuse to count days from an assumed date, and
`analysis.js` excludes assumed stops from R statistics. Correcting the value
anywhere — import preview, `/stops` queue, trade form — must clear the flag,
or the correction never counts. **A missing stop is not zero risk**: Holdings
distinguishes `unknownRisk` from `riskFree`, since treating them alike showed
₹42L of exposure as an all-clear.

**Position derivation pipeline.** The DB schema stores one exit per trade
(`exit_price`/`exit_date`/`quantity` columns — not a tranche list), but
`src/lib/positions.js`'s `derivePosition(t, accountSize)` was written against a
tranched-exits model and expects `t.exits[]`. Every caller (`Journal.jsx`,
`TradeForm.jsx`) wraps trades through a local `withExits(t)` adapter that
synthesizes a single-exit array from the legacy columns before calling
`derivePosition()`, then re-overrides `status` from the DB afterward since
`derivePosition` recomputes (incorrectly, for this schema) status from
`exits`. Any new code that touches trade P&L/R needs to go through this same
adapter pattern, not call `derivePosition` on a raw DB row.

**Charges are computed, not entered — except when they're not.**
`src/lib/charges.js` computes Indian equity transaction charges (STT, exchange
txn charges which differ NSE vs BSE, SEBI fee, stamp duty on buy leg, GST on
brokerage+fees, DP charges on sell leg, brokerage per the user's broker
preset/custom rates in `profiles.charge_config`). A trade's `charges_auto`
boolean (DB default `false`) gates whether `ChargesField.jsx` is allowed to
overwrite `trades.charges` on save — **never flip a trade's charges when
`charges_auto` is false**; that's an explicit user override of the computed
figure and clobbering it silently corrupts their real numbers. One exception,
and only one: a charge of **zero on a trade that was not imported** is treated
as never set rather than as an override, because on a delivery trade you cannot
pay nothing, so nobody decided it. An **imported** zero is left alone — shares
from a demerger carry an apportioned cost and no brokerage, so that zero came
from the broker and is the truth (LTI, NLSL, TRANSINDIA, ALLCARGOTERMINALS all
sit at zero for exactly this reason). A zero typed during the session is also
left alone, via `touched`. `SL_BANDS`-style
statutory rates and broker presets live in `BROKER_PRESETS`/`mergeConfig()`; a
`brokerageCap: Infinity` preset value must be converted to a large finite
sentinel before persisting to `charge_config` (jsonb) since JSON has no
`Infinity` — see `forSave()` in `SettingsSheet.jsx`.

**Edge/breakdown analysis uses adaptive quantile bands.** `src/lib/edge.js`
buckets continuous dimensions (distance from MA, volume, SL%, risk%, RS,
holding period) into adaptive quantile bands rather than fixed thresholds, via
`adaptiveBander()`/`quantileCuts()`; categorical dimensions keep fixed
buckets. `dimensionRows()` returns pre-sorted rows (ascending band order for
continuous, contribution order with NOT_RECORDED last for categorical) —
don't re-sort the result. Slices under `THIN_SLICE` (15 trades) get an
`isThin` flag consumed by the UI to show a low-confidence hint.

**Mistake/outcome tags are split on purpose.** `src/lib/constants.js`'s
`MISTAKES` list contains one neutral/outcome tag ("Setup failed") mixed in
with true execution errors; `isExecutionError()` distinguishes them and
`src/lib/analysis.js`'s `mistakeCost()`/`outcomeTagCounts()` both filter on it
so that "the setup just didn't work" isn't counted as a discipline failure
alongside things like moving a stop.

**Screens are tabs inside one client component.** `Journal.jsx` is the
top-level container (loads trades/diary/profile/capital_flows once, derives
positions, computes `stats()`), rendering `Dashboard` / `Trades` / `Performance`
/ `Diary` / `Review` by tab state — there's no routing per screen. `page.jsx`
gates on Supabase auth session, then on `profile.onboarded_at`: unonboarded
users see `FirstRun.jsx` (collects account size + default risk %) before ever
reaching `Journal`.

**styled-jsx scoping gotcha.** `<style jsx>` (non-global) only applies to
elements rendered by the *same* component function that declares it — not to
a child subcomponent's elements. Components that render styled markup via a
child (e.g. a small `Cell`/`Stat` helper defined in the same file) need
`<style jsx global>` for those selectors, scoped by a unique class prefix.

**Table conventions live in `src/app/tables.css`**, imported once in
`layout.jsx` — sortable-column arrows are a dedicated always-rendered
`<span className="arrow">` (not string-appended to the label) driven by a
`data-sortable` attribute, and `.scroll` needs an explicit `max-height` (not
just `overflow-x/y: auto`) or sticky `<th>` silently stops working, because a
scroll container with unbounded height never actually has anything to scroll
(`clientHeight === scrollHeight`), so the *page* scrolls instead and the
sticky header ends up behind the app's own sticky topbar.

## Conventions

- INR only, everywhere — no currency selection or USD code paths.
- Column/field names are snake_case, matching `supabase/schema.sql` exactly;
  component-local state can use camelCase but payloads sent to `db.js` must
  match schema columns.
- Money formatting goes through `src/lib/format.js` (`inr()`/`rupee()`/`rfmt()`
  add k/L/Cr tiers) rather than ad hoc `toLocaleString()` calls.
- Indian financial year (April–March) is the default periodization; FY helpers
  live in `calc.js` alongside `byPeriod()`/`equityCurve()`/XIRR/CAGR/Monte Carlo.
# Compact instructions
When compacting, always preserve:
- The trade data schema and per-trade fields: stock, entry price, qty, stop loss, risk per trade, base pattern (VCP / cup / flat base / pullback), distance from pivot, breakout volume as % of 30-day avg, Weinstein stage / RS rank
- Stack + scope decisions: Supabase + Vercel; NSE/BSE + INR only (no US market)
- Calculation rules: risk-per-trade value, tranched/partial-exit P&L, XIRR/CAGR, quarterly + yearly performance
- Serialization gotchas: the "no cap" preset must store a large finite sentinel, never Infinity (invalid JSON, nulls on reload)
- Trade-state rules: entries editable while open, read-only once closed
- Any open bug or half-finished feature, plus the decision behind it
Summarize resolved debugging, styling passes, and raw file dumps briefly.