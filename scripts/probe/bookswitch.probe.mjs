import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { regionOf, regionSettings, regionSettingsPatch, hasMtf } from "@/lib/regions";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const layout = () => read("src/app/(app)/layout.jsx");

/**
 * PHASE 5 — the switch appears, and each book stands alone.
 *
 * The failure this is written against is the quiet one: a US position
 * appearing in an Indian total, or an Indian trade saved into a US book. Both
 * would look like ordinary rows and be wrong in the only figure that matters.
 */
test("the screens see one book, sliced from every row", () => {
  const s = layout();
  ok(/const trades = useMemo\(\s*\(\) => allTrades\.filter\(\(t\) => regionOf\(t\) === bookRegion\)/.test(s),
     "trades are the open book's");
  ok(/const flows = useMemo\(\s*\(\) => allFlows\.filter\(\(f\) => regionOf\(f\) === bookRegion\)/.test(s),
     "and so is the capital ledger — a book is funded separately");
  /* Everything downstream reads `trades`, so nothing else needs to know. */
  ok(/trades, diary: demo \? demo\.diary : diary, flows/.test(s),
     "the context hands on the sliced lists, not the raw ones");
});

test("a row with no region stays in the Indian book", () => {
  /* Every one of the 4,231 trades written before migration 052. */
  eq(regionOf({}), "IN");
  eq(regionOf({ region: "" }), "IN");
  const s = layout();
  ok(/bookRegion = SHOW_REGIONS \? currentRegion\(profile\) : DEFAULT_REGION/.test(s));
});

test("a trade is saved into the book it was entered in", () => {
  const s = layout();
  ok(/bookRegion === DEFAULT_REGION \? payload : \{ \.\.\.payload, region: bookRegion \}/.test(s),
     "sent only when it is not India, so a save still works before the migration");
});

test("the account size belongs to the book, not to the user", () => {
  const profile = { account_size: 1200000, default_risk_pct: 0.75,
                    region_settings: { US: { account_size: 25000, default_risk_pct: 1 } } };
  eq(regionSettings(profile, "IN").account_size, 1200000);
  eq(regionSettings(profile, "US").account_size, 25000);
  ok(/regionSettings\(profile, bookRegion\)\.account_size/.test(layout()),
     "and the layout reads it that way");
  /* Saving one must not wipe the other. */
  const patch = regionSettingsPatch(profile, "US", { account_size: 30000 });
  eq(patch.region_settings.US.default_risk_pct, 1, "merged");
  eq(patch.account_size, undefined, "and India's columns are untouched");
});

test("switching books is remembered on the profile, not in the browser", () => {
  const s = layout();
  ok(/const switchRegion = async \(id\)/.test(s));
  ok(/dbSaveProfile\(\{ region: next \}\)/.test(s), "so it follows you to another device");
  ok(/setProfile\(\(p\) => \(\{ \.\.\.\(p \|\| \{\}\), region: next \}\)\)/.test(s),
     "set locally first, or the old book sits there for a beat");
});

test("the sample book is Indian, and is not dealt into a US one", () => {
  ok(/const demoOn = !!profile && bookRegion === DEFAULT_REGION &&/.test(layout()),
     "its symbols, prices and charges are all Indian");
});

test("MTF is offered where it exists and absent where it does not", () => {
  eq(hasMtf("IN"), true);
  eq(hasMtf("US"), false);
  const setup = read("src/components/journal/SettingsSheet.jsx");
  ok(/\{hasMtf\(bookRegion\) && \(/.test(setup), "absent, not empty");
});

test("Setup offers the plans that book's brokers actually charge", () => {
  const setup = read("src/components/journal/SettingsSheet.jsx");
  ok(/bookRegion === DEFAULT_REGION \? BROKER_PRESETS : US_BROKER_PRESETS/.test(setup));
  ok(/bookRegion === DEFAULT_REGION\s*\?\s*mergeConfig\(mine\.charge_config\)\s*:\s*mergeUsConfig\(mine\.charge_config\)/.test(setup),
     "two different sets of fields, so they cannot share a default");
});

test("Import says US files are not read yet rather than mangling one", () => {
  const page = read("src/app/(app)/import/page.jsx");
  ok(/if \(bookRegion === "US"\)/.test(page));
  ok(/US broker files are not read yet/.test(page));
  ok(/quietly get the rest wrong/.test(page),
     "the reason is the one the broker adapters have always followed");
});

test("the switch names the currency, and says books are separate", () => {
  const rs = read("src/components/journal/RegionSwitch.jsx");
  ok(/\{current\.sign\}/.test(rs), "₹ or $ — the question somebody actually has");
  ok(/its own capital, positions and\s+totals/.test(rs));
  ok(!/🇮🇳|🇺🇸/.test(rs), "no flags: decoration here, and occasionally a statement");
});

test("a new trade opens on the book's own exchange", () => {
  const form = read("src/components/journal/TradeForm.jsx");
  ok(/exchange: defaultExchange\(\)/.test(form));
  ok(/regionInfo\(activeRegion\(\)\)\.defaultExchange/.test(form), "NSE in India, NASDAQ in a US book");
});

/* FOUND IN USE: the sample offer appeared in a US book, and clicking it did
   nothing — `demoOn` refuses to deal Indian stocks into a US journal, so the
   button was answered by silence. A dead control reads as a broken app. */
test("the sample is offered only where it can actually be shown", () => {
  const s = layout();
  ok(/\{!demo && trades\.length === 0 && bookRegion === DEFAULT_REGION && \(/.test(s),
     "the offer and the sample agree about which books they belong to");
  const offerAt = s.indexOf("<SampleOffer");
  const demoAt = s.indexOf("const demoOn = !!profile && bookRegion === DEFAULT_REGION");
  ok(offerAt > 0 && demoAt > 0, "both conditions exist");
});

test("the first-week card offers Import only where a file can be read", () => {
  const fw = read("src/components/journal/FirstWeek.jsx");
  ok(/activeRegion\(\) === DEFAULT_REGION && \(\s*<Link href="\/import"/.test(fw),
     "a US book is not sent to a page that tells it no");
  ok(/US broker files are not read yet/.test(fw), "and step one says what to do instead");
});
