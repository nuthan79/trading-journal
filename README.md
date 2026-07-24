# Trading Journal — NSE + BSE

A personal swing trading journal. Postgres for storage, symbol autocomplete
across the full NSE and BSE equity universe, and delayed quotes to mark open
positions.

Everything is measured in **R** — profit and loss divided by the risk you took
on that trade. It is the unit that makes a ₹8,000 win on a tight stop and a
₹40,000 win on a wide one comparable.

---

## Setup — about 30 minutes, all free tier

### 1. Supabase (database + login + chart storage)

1. Create a project at [supabase.com](https://supabase.com). Pick the region
   closest to you — Mumbai or Singapore.
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
   This creates the tables, row-level security, the chart bucket, and a trigger
   that gives every new user a settings row.
3. **Authentication → Providers → Google** → enable it. Supabase shows you the
   callback URL to paste into your Google Cloud OAuth client.
4. **Project Settings → API** → copy the Project URL and the `anon` public key.

### 2. Local

```bash
npm install
cp .env.local.example .env.local     # paste your two Supabase values in
```

### 3. Build the symbol list

```bash
npm run symbols
```

NSE downloads automatically. BSE sits behind a form, so grab it once from
[bseindia.com/corporates/List_Scrips.html](https://www.bseindia.com/corporates/List_Scrips.html)
(Segment: Equity, Status: Active), drop the CSV into a `data/` folder in the
project root, and re-run. The script picks up any CSV it finds there.

This writes `public/symbols.json`, which the browser loads once and searches in
memory — that's why the autocomplete responds instantly on the third character
instead of waiting on a network round trip. Re-run it every month or two as
listings change.

```bash
npm run dev      # http://localhost:3000
```

### 4. Deploy

Push to GitHub, import the repo at [vercel.com](https://vercel.com), and add the
same three environment variables in the Vercel project settings. Every push to
`main` deploys automatically. Add your Vercel URL to Supabase under
**Authentication → URL Configuration → Redirect URLs**.

---

## Where prices come from

`src/lib/quotes.js` is the only file that knows. It exports one function with a
fixed shape, so changing sources means editing that file and nothing else.

**Yahoo (default).** No key, no signup, covers both exchanges via the `.NS` and
`.BO` suffixes. Yahoo shut down its official API in 2017 and never brought it
back, so this uses the undocumented endpoint its own site calls. It works, a lot
of projects rely on it, and it can rate-limit or change shape without warning.
Prices are delayed, not live.

**Your broker.** The reliable path. Angel One SmartAPI, Upstox, Fyers, Dhan and
Shoonya all document free API tiers; Zerodha's Kite Connect splits free order
placement from paid market data. Implement `fromBroker()` and set
`QUOTE_SOURCE=broker`.

Quotes are cached for 60 seconds and the journal degrades gracefully — if the
quote source is down, open positions simply show no mark and everything else
keeps working.

**Google Finance is not an option.** It has had no public API since 2012. The
only sanctioned access is the `GOOGLEFINANCE()` formula inside Google Sheets.

---

## What lives where

```
supabase/schema.sql          tables, RLS, storage bucket, triggers
scripts/build-symbols.mjs    builds public/symbols.json from NSE + BSE
src/lib/calc.js              R-multiples, expectancy, XIRR, CAGR, Monte Carlo
src/lib/quotes.js            quote sources — swap brokers here
src/lib/db.js                every read and write to Postgres
src/app/api/quotes/route.js  server-side proxy (the browser can't call Yahoo)
src/components/SymbolSearch  the 3-character autocomplete
```

## Porting the prototype UI

The dashboard, trade sheet, performance sheet and diary come across from the
artifact largely unchanged. The prototype already isolated storage behind
`sGet` / `sSet` / `sDel`; replace those calls with the functions in
`src/lib/db.js` and the components work as they are. Two changes to make while
porting:

- field names go from camelCase to the snake_case column names in the schema
- the currency helper drops USD — everything is INR now

## Returns on capital

`capital_flows` is what makes XIRR possible. Log every deposit and withdrawal
with its date. Without it you only have CAGR, which silently overstates your
return whenever you add money mid-year.

`calc.js` exports `xirr`, `cagr`, `impliedAnnual` and `monteCarlo`. Report the
realised XIRR next to the modelled distribution — one tells you what happened,
the other tells you what the system is capable of and how deep the bad tail
goes.
