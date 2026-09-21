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

```bash
npm run admin     # Pulse, the admin dashboard, http://127.0.0.1:7788 — who is
                  # active now, signups,
                  # sign-ins, regulars with ledger name and email. LOCAL ONLY:
                  # plain Node in scripts/admin/, outside the Next app, because
                  # it reads with SUPABASE_SERVICE_ROLE_KEY (bypasses RLS) and
                  # that key must never reach Vercel. Read-only; a probe pins
                  # that nothing in src/ imports it and that it binds to
                  # 127.0.0.1. Figures are IST days, computed in report.mjs so
                  # they can be probed against a fixed book. Your own logins
                  # are left out via ADMIN_EXCLUDE in .env.local — never in the
                  # repo, which is public.
```

```bash
npm run probe          # every check in scripts/probe/*.probe.mjs
npm run probe -- mtf   # only files whose name contains "mtf"
npm run probe:tz       # the same, under TZ=America/New_York
```

**Probes are the test suite.** Plain Node, no framework: `harness.mjs` gives
`test`/`ok`/`eq`/`near`, `register.mjs` resolves `@/` and swaps `src/lib/db.js`
for `scripts/probe/stubs/db.js`. There is no JSX compiler, so components are
checked by reading their source (order, wiring, what is and is not rendered);
logic in `src/lib` is imported and called. Run both commands before committing
— `probe:tz` exists because a date bug that is invisible in IST surfaces west
of Greenwich. **A new probe is not done until it has been seen to fail**:
break the code it guards, watch it go red, restore. Several first drafts here
passed against the very bug they were written for. No lint script.

## Architecture

**Storage layer is the seam.** `src/lib/db.js` is the *only* file that talks to
Supabase. It exports same-shaped `list*`/`save*`/`delete*` functions per table
(trades, diary_entries, capital_flows, profiles) using `.select("*")` reads and
pass-through `upsert`/`update` writes — no column allowlists, so the migrations
(`supabase/NNN_*.sql`) are the source of truth for what fields exist.
`schema.sql` is the original base and is NOT kept in step with them. UI
components never call Supabase directly. Every write builds its own field list
(`toPayload`, `patchFor`); nothing sends a derived row back, which is what makes
it safe to hang derived and underscored fields on trades in memory.

**A new column must not break saves before its migration runs.** Send it only
when the user set it (see the MTF fields in `toPayload` and Setup), and read it
with a fallback. There is then no wrong order to deploy and migrate in.

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
| `journal` | a whole book with its stops — Champions, SwingBot | yes |

The journal kind is the only one that can carry a REAL stop, which is why a
bot's own CSV pair (`swingbot.js`: `trades.csv` closed, `open_positions.csv`
still held) goes through it rather than the lot pipeline. Its closed file has
no stop column and does not need one — R is P&L over risk, so the stop comes
back out of `pnl` and `R`, reproducing the file's own R to two decimals. Only
a format that states pattern, exit reason or a note writes those columns;
`toJournalRows` spreads them in, so no other format starts writing nulls.

A tradebook deliberately imports nothing: its closed lots would duplicate the
tax P&L's while being worse (no charges, mis-pairs pre-file buys). Anything
re-deriving a preview must test `kindOf(b) !== "taxpnl"` rather than naming
kinds to skip — naming them is what crashed the screen when the third arrived.

**Brokers compare by family; a holdings row is a dated snapshot.** `trades.broker`
holds the importing ADAPTER's id (`zerodha`, `zerodha_holdings`,
`zerodha_tradebook`), so "never merge across brokers" goes through
`sameBroker()` in `src/lib/brokerFamily.js`, which compares families —
comparing raw ids once left six sold holdings open beside their closed copies.
The raw `_holdings` id stays on the row because it marks a SNAPSHOT: what was
held on the day it was imported (`snapshotDay`, from `created_at`). Sells dated
on or after that day came out of it; earlier sells of the same purchase add to
its size (`snapshotFit`) — the file-sized rule every other import uses would
resize a current snapshot to the shares sold and drop the ones still held.
`lib/snapshots.js` finds snapshots already sold in a live book; Holdings offers
the fix, never applies it silently. **Trades carry no account**, so two
accounts at one broker are one family: auto-merging only happens with a single
candidate, and the snapshot fix waits for a click.

**An assumed value must be a flag the calculations consult, not a tint.**
`stop_source` and `entry_date_source` (036) both mean "the importer invented
this". `calc.js`/`positions.js` refuse to count days from an assumed date, and
`analysis.js` excludes assumed stops from R statistics. Correcting the value
anywhere — import preview, `/stops` queue, trade form — must clear the flag,
or the correction never counts. **A missing stop is not zero risk**: Holdings
distinguishes `unknownRisk` from `riskFree`, since treating them alike showed
₹42L of exposure as an all-clear.

**Position derivation pipeline.** Sells live in `trade_exits` (migration 007),
one row per tranche; `trades.exit_date`/`exit_price` mirror the LAST tranche
for convenience. `src/app/(app)/layout.jsx` loads both, and its
`withExits(t, exitsByTrade)` attaches the real tranches — or, for a legacy row
with none, synthesizes one from the flat columns — before `derivePosition(t,
accountSize)` in `src/lib/positions.js`. `status` is re-applied from the DB
afterwards, because a trigger keeps it in step with the tranches. New code that
needs P&L or R reads the derived rows from `useJournal()`; it never calls
`derivePosition` on a raw DB row. `TradeForm.jsx` derives its own live copy.

**Money counts every sell; the verdict counts finished positions.** A
part-sold position has banked money but no result yet. So net P&L, the equity
curve, the period table and the Holdings realised figures read `banking` —
every position that has sold something — through `bankedEvents()`/
`realisationEvents()`, which split a position into the sells that produced its
money, each carrying its OWN charge and dated when it happened. Win rate,
expectancy and payoff stay on `closed`. **Never use `t.pnl` for banked money**:
on an open or part-sold position it includes the unrealised mark. The sells of
a position always sum to its `realisedPnl` to the paisa; probes pin it.

**MTF (margin) cost is one model, kept apart from charges.** `src/lib/mtf.js`
`interestModel(t)` is the only place interest and pledge fees are worked out
(interest per sell, calendar days, on the funded part; a pledge fee per buy and
an unpledge fee per sell). `derivePosition` and `realisationEvents` both read
it. "MTF" means interest and fees together, and no screen shows them apart.
It is never folded into `charges`: the per-sell split finds each sell's charge
as what lies between gross and realised P&L, so it subtracts MTF there only
when MTF was subtracted from P&L — get that wrong in either direction and MTF
silently becomes "charges". The user's fees and whether to deduct MTF at all
(migrations 049, 050) reach the calculation as underscored fields laid onto
each trade by `mtfPrefs(profile)` in the layout; `marginInPnl`/
`marginCounted` on the results let every screen word it truthfully.

**Statutory rates are not settings.** STT, the NSE/BSE transaction fees, the
SEBI fee, stamp duty, GST and the depository's ₹18 pledge/unpledge fees are
the same for every trader in India, so nobody may edit them: they live in
`charges.js` (`STATUTORY_KEYS`, put back by `mergeConfig` OVER anything a
profile still carries) and `mtf.js` (`mtfPrefs` ignores the stored fees).
Setup keeps only what genuinely differs — the broker plan, its brokerage, the
DP fee, and whether MTF comes out of P&L. Six editable boxes asked a question
with one right answer, and a mistyped STT understates every charge and every
net P&L with nothing on screen to explain it. Rates are updated here when a
budget moves them; charges already stored on a trade are never recomputed.

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
`MISTAKES` list mixes true execution errors with outcome tags — the ones in
`NEUTRAL_TAGS` ("Setup failed", "False breakout"); `isExecutionError()` distinguishes them and
`src/lib/analysis.js`'s `mistakeCost()`/`outcomeTagCounts()` both filter on it
so that "the setup just didn't work" isn't counted as a discipline failure
alongside things like moving a stop.

**Screens are routes under one client layout.** `src/app/(app)/layout.jsx` is
a client component: it gates on the Supabase session, then on
`profile.onboarded_at` (unonboarded users get `FirstRun.jsx`), loads trades,
exits, diary, flows and profile once, derives `all`/`closed`/`open`/`banking`,
and provides them through `JournalContext` — each `page.jsx` (dashboard,
holdings, trades, import, performance, analysis/*, diary, stops) reads
`useJournal()`. Because the layout renders nothing server-side until the
session resolves, reading `localStorage` in a `useState` initializer is safe
here. Features built but held back sit behind `src/lib/flags.js`; unhide, never
rebuild. An empty journal is filled with sample data (`lib/demo.js`) until the
first real trade — count the user's own rows (`trades`, `ownDiaryCount`), never
`all`, for anything about their progress.

**"Today" is the browser's day, never the UTC one.** Use `today()` from
`format.js`. `new Date().toISOString().slice(0, 10)` names yesterday between
midnight and 05:30 IST; a probe fails on it anywhere except `lib/quotes.js`,
which runs on the server. A stored `YYYY-MM-DD` is parsed by hand, never with
`new Date(str)`, which reads it as UTC midnight.

**Rupee figures and column headers explain themselves.** Render money through
`<Money v={…}>` (compact on screen, every digit in the hover), not bare
`rupee()` — which stays right inside strings. Table headers take their hover
from `COLUMN_HINTS` in `src/lib/columns.js`, one map for Trades and Holdings;
each line was checked against the arithmetic, so change both together. Column
choices persist via `useColumnPrefs`, stored as what is HIDDEN so new columns
appear. When a figure is hidden, its header, every cell and any footer span
must hide with it — the Trades footer spans are computed, not typed.

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

## Going international (in progress)

**A region is a separate book.** `src/lib/regions.js` describes what a market
decides — currency and its abbreviation ladder (₹ k/L/Cr vs $ K/M/B),
exchanges, how a ticker is spelled for Yahoo, the fiscal year start, whether
MTF exists there. Migration 052 puts `region` on trades, capital_flows and
profiles, defaulting to `'IN'` — which is the truth for every row ever
written, so there is no backfill and no ambiguity. `regionOf(row)` answers
`IN` for a missing column, so all of this is inert until Phase 5 flips
`SHOW_REGIONS`.

**Nothing may ever total across two currencies.** Not an equity curve, not a
net P&L, not a tile. Blending needs an FX rate on every figure, and then a
finished Indian trade's P&L moves when the dollar does — which is false. R and
win rate are ratios and are the honest cross-market comparison.

**`money()` follows the book; `rupee()` is always rupees.** `format.js` holds
one active region, set by the app layout from the profile — not threaded
through the 142 call sites, because a missed one prints dollars with a rupee
sign and nothing on screen says so. A region is a separate book, so everything
rendered at one moment shares a currency, which is what makes one module-level
answer right. `money`/`amount`/`exact`/`moneyParts`/`moneyTitle` and `<Money>`
all follow it; `rupee()` stays for India's own subject matter — statutory
rates, broker presets, the ₹18 pledge fee, the learn pages. Ladders live in
`LADDERS`: k/L/Cr/Lakh Cr for India, K/M/B/T for the US.

Phases: 1 data model and regions.js (done) · 2 currency-aware `format.js`
(done; `currency.probe.mjs` pins India's exact strings) · 3 US symbols and
quotes · 4 US charges and calendar-year fiscal · 5 the switch and per-region
filtering · 6 US broker imports, each against a real file.

## Conventions

- INR is the only currency in use today; USD lands with the regions work
  above, through `regions.js` rather than through scattered conditionals.
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