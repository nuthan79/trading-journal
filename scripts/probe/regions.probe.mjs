import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { REGIONS, DEFAULT_REGION, region, regionOf, currentRegion,
         hasMtf, regionSettings, regionSettingsPatch } from "@/lib/regions";
import { SHOW_REGIONS } from "@/lib/flags";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

/**
 * PHASE 1 OF GOING INTERNATIONAL — the part that must change nothing.
 *
 * Every trade in every live database is an Indian trade. So the whole of this
 * phase is judged on one question: does a journal that has never heard of
 * regions behave identically? These checks answer it, and go on answering it
 * as the later phases land.
 */
test("anything without a region is India — row, profile, null, nonsense", () => {
  eq(regionOf(undefined), "IN");
  eq(regionOf({}), "IN", "a trade written before migration 052");
  eq(regionOf({ region: null }), "IN");
  eq(regionOf({ region: "ZZ" }), "IN", "an unknown region is not a new book");
  eq(regionOf({ region: "us" }), "US", "case is not a different market");
  eq(currentRegion(null), "IN");
  eq(DEFAULT_REGION, "IN");
});

test("the switch is off, so nothing on screen has changed", () => {
  eq(SHOW_REGIONS, false);
  /* And no screen reads regions yet — Phase 1 is data and description only.
     When a component does start reading this, that is Phase 5, and this line
     is the reminder to turn the flag on deliberately. */
  const used = readdirSync(path.join(ROOT, "src/components/journal"))
    .filter((f) => /\.jsx$/.test(f))
    .filter((f) => /from "@\/lib\/regions"/.test(read(`src/components/journal/${f}`)));
  eq(used.join(","), "", "no component imports regions while the flag is off");
});

test("India's settings are read from exactly where they always were", () => {
  /* The whole safety of phase 1: a user with one market must not have their
     account size move house. */
  const profile = { account_size: 1200000, default_risk_pct: 0.75, charge_config: { brokerageModel: "zero" } };
  const s = regionSettings(profile, "IN");
  eq(s.account_size, 1200000);
  eq(s.default_risk_pct, 0.75);
  eq(s.charge_config.brokerageModel, "zero");
  /* And writing them still writes the columns, not a nested object. */
  const patch = regionSettingsPatch(profile, "IN", { account_size: 1300000 });
  eq(patch.account_size, 1300000);
  ok(!("region_settings" in patch), "India does not move into the jsonb");
});

test("another region keeps its own, and cannot overwrite a third", () => {
  const profile = { account_size: 1200000,
                    region_settings: { US: { account_size: 25000 }, XX: { account_size: 7 } } };
  eq(regionSettings(profile, "US").account_size, 25000);
  eq(regionSettings(profile, "IN").account_size, 1200000, "India is untouched by a US setting");

  const patch = regionSettingsPatch(profile, "US", { default_risk_pct: 1 });
  eq(patch.region_settings.US.account_size, 25000, "merged, not replaced");
  eq(patch.region_settings.US.default_risk_pct, 1);
  eq(patch.region_settings.XX.account_size, 7, "and another region survives the write");
});

test("each region describes everything that differs, with nothing missing", () => {
  for (const r of REGIONS) {
    for (const k of ["id", "label", "currency", "sign", "tiers", "locale", "exchanges",
                     "defaultExchange", "tickerSuffix", "fiscalStartMonth", "timeZone"]) {
      ok(r[k] !== undefined && r[k] !== null && r[k] !== "" || k === "fiscalLabel",
         `${r.id} states its ${k}`);
    }
    for (const e of r.exchanges) {
      ok(r.tickerSuffix[e] !== undefined, `${r.id}: ${e} says how its ticker is spelled`);
    }
    ok(r.exchanges.includes(r.defaultExchange));
  }
  /* The two that are true today and are the reason regions exist at all. */
  eq(region("IN").sign, "₹"); eq(region("IN").fiscalStartMonth, 4); eq(hasMtf("IN"), true);
  eq(region("US").sign, "$"); eq(region("US").fiscalStartMonth, 1);
  eq(hasMtf("US"), false, "margin funding with pledge fees is an Indian product");
  eq(region("US").tickerSuffix.NASDAQ, "", "a US ticker is bare — AAPL is AAPL");
});

test("migration 052 defaults every existing row to India, and constrains the rest", () => {
  const sql = read("supabase/052_regions.sql");
  for (const t of ["public.trades", "public.capital_flows", "public.profiles"]) {
    ok(new RegExp(`alter table ${t.replace(".", "\\.")}[\\s\\S]{0,200}region text not null default 'IN'`)
      .test(sql), `${t} gets a region, defaulting to India`);
  }
  ok(/check \(region in \('IN', 'US'\)\)/.test(sql), "and only the regions the app knows");
  ok(/trades_user_region_idx/.test(sql), "with the index every screen will filter on");
  ok(!/update public\.trades set/.test(sql), "no backfill: the default IS the truth");
});

test("no screen totals across two currencies — the rule the whole design rests on", () => {
  /* There is nothing to check in the UI yet, so this checks the rule is
     written down where the next phase will read it. When Phase 2 lands, this
     probe grows teeth: any sum over rows of mixed region is a bug. */
  const src = read("src/lib/regions.js");
  ok(/no screen ever adds a rupee to a dollar/i.test(src));
  ok(/SEPARATE BOOK/.test(src));
});
