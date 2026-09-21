import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { canWrite, accessState, accessFor } from "@/lib/entitlements";
import { REGIONS } from "@/lib/regions";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const sql = () => read("supabase/053_region_access.sql");

/**
 * WHO MAY WRITE IN WHICH MARKET.
 *
 * The first test is the one that matters: the lock is in the database, not in
 * this code. Everything in entitlements.js exists so the app does not offer a
 * Save that the policy would refuse — a user who bypasses it gets an error
 * rather than a lie, which is the right way round.
 */
test("the lock lives where a user cannot reach it", () => {
  const s = sql();
  /* The profile row is writable by its owner — own_profile is `for all` —
     so an entitlement kept there is one anybody can grant themselves. */
  ok(/create table if not exists public\.region_access/.test(s));
  ok(/for select using \(auth\.uid\(\) = user_id\)/.test(s), "read your own");
  ok(!/for (insert|update|delete)/.test(s), "and no write policy at all, for anyone");
  ok(/Deliberately no insert\/update\/delete policy/.test(s), "said out loud, so it is not 'missing'");
});

test("the trades policy is RESTRICTIVE, or it would grant rather than limit", () => {
  const s = sql();
  ok(/create policy trades_region_entitled on public\.trades\s*\n\s*as restrictive for all/.test(s),
     "permissive policies are OR-ed — a second one would have opened everything up");
  ok(/using \(true\)\s*\n\s*with check \(public\.has_region\(auth\.uid\(\), region\)\)/.test(s),
     "reads untouched; writes checked");
  ok(/create policy flows_region_entitled on public\.capital_flows/.test(s),
     "the capital ledger too, before anything writes it");
});

test("India is free, in the function and in the app", () => {
  const s = sql();
  ok(/select r = 'IN'/.test(s), "no row needed, so nothing changes for existing users");
  eq(canWrite([], "IN"), true);
  eq(canWrite(null, "IN"), true, "no access rows at all is the normal state");
  eq(accessState([], "IN").state, "open");
});

test("a granted market is open until it runs out", () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();
  eq(canWrite([{ region: "US", expires_at: future }], "US"), true);
  eq(canWrite([{ region: "US", expires_at: past }], "US"), false);
  /* No expiry is a lifetime grant — the admin's own accounts. */
  eq(canWrite([{ region: "US", expires_at: null }], "US"), true);
  eq(canWrite([], "US"), false, "never granted");
});

test("the three states are told apart, because they deserve different sentences", () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  eq(accessState([], "US").state, "locked");
  eq(accessState([{ region: "US", expires_at: past }], "US").state, "expired");
  eq(accessState([{ region: "US", expires_at: null }], "US").state, "open");
  /* A renewal is an easier conversation than a first sale, so the expiry
     travels with the state. */
  eq(accessState([{ region: "US", expires_at: past }], "US").until, past);
});

test("a locked market is shown with a lock, not hidden", () => {
  const rs = read("src/components/journal/RegionSwitch.jsx");
  ok(/A MARKET YOU CANNOT WRITE IN IS STILL SHOWN/.test(rs));
  ok(/r\.state === "locked"/.test(rs) && /read-only/.test(rs));
  ok(/r\.state === "expired"/.test(rs) && /ended/.test(rs));
  const marked = accessFor([], REGIONS);
  eq(marked.find((m) => m.id === "IN").state, "open");
  eq(marked.find((m) => m.id === "US").state, "locked");
});

test("the app refuses the write itself, with the reason", () => {
  const layout = read("src/app/(app)/layout.jsx");
  ok(/if \(!canWriteHere\) \{/.test(layout), "New trade does not open onto a dead end");
  ok(/Your access to this market ended/.test(layout), "expired says renew");
  ok(/not open on your account yet/.test(layout), "locked says ask");
  ok(/is read-only on your account/.test(layout), "and the book says so above every screen");
});

test("reads are kept — a lapsed book is still readable", () => {
  const layout = read("src/app/(app)/layout.jsx");
  /* The filter is on the region, never on entitlement: their trades are their
     trades. Only writing stops. */
  ok(/allTrades\.filter\(\(t\) => regionOf\(t\) === bookRegion\)/.test(layout));
  ok(!/canWriteHere.*allTrades\.filter/s.test(layout), "access never filters the book away");
  ok(/stays open to read and closed to new trades/.test(layout));
});

test("Pulse shows who holds access and whose has ended", () => {
  const rep = read("scripts/admin/report.mjs");
  ok(/markets: access\.filter/.test(rep) && /lapsed: access\.filter/.test(rep));
  ok(/paid: list\.filter\(\(p\) => p\.markets\.length\)/.test(rep));
  const page = read("scripts/admin/page.mjs");
  ok(/<th>Paid access<\/th>/.test(page));
  ok(/India is free and never appears here/.test(page));
});

test("the migration carries its own grant and rollback lines", () => {
  const s = sql();
  ok(/insert into public\.region_access \(user_id, region, expires_at, note\)/.test(s),
     "granting is one statement the admin can copy");
  ok(/drop policy if exists trades_region_entitled on public\.trades;/.test(s),
     "and there is a way back if a policy ever blocks something it should not");
});

/**
 * FOUND IN USE: opening a market you had never bought gave an empty journal
 * under two red warnings. Every screen said a version of "there is nothing
 * here", and the impression was of an app that had broken rather than of
 * something worth having.
 */
test("a locked, empty book is an offer — not an empty journal", () => {
  const layout = read("src/app/(app)/layout.jsx");
  ok(/const showOffer = SHOW_REGIONS && !canWriteHere && emptyHere;/.test(layout));
  ok(/showOffer\s*\n?\s*\? <RegionOffer/.test(layout), "the offer replaces the screens");
  const offer = read("src/components/journal/RegionOffer.jsx");
  ok(/is not on your account yet/.test(offer) && /Ask for access/.test(offer),
     "it says what the market is and how to get it");
});

test("but a lapsed book with trades in it still opens", () => {
  const layout = read("src/app/(app)/layout.jsx");
  ok(/!canWriteHere && !emptyHere && \(/.test(layout),
     "reads are kept where there is something to read — the whole point of the rule");
  const offer = read("src/components/journal/RegionOffer.jsx");
  ok(/Renew it and it opens\s*\n?\s*exactly as it was/.test(offer),
     "and an expired one with nothing in it says renewal restores it");
});

test("a book you cannot write in is not asked to be funded", () => {
  const layout = read("src/app/(app)/layout.jsx");
  ok(/\{unfunded && canWriteHere && \(/.test(layout),
     "configuring something you have no way to use is noise");
});

test("every market still appears in the switch", () => {
  /* A market nobody can see is a market nobody asks for — the reason the
     lock is shown rather than the row hidden. */
  const rs = read("src/components/journal/RegionSwitch.jsx");
  ok(/A MARKET YOU CANNOT WRITE IN IS STILL SHOWN/.test(rs));
  ok(!/state === "locked"[^}]*return null/.test(rs), "never filtered out of the list");
});
