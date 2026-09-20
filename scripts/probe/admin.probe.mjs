import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq, near } from "./harness.mjs";
import { buildReport, people, istDay, istDayBack, LOYAL_DAYS, QUIET_DAYS }
  from "../admin/report.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

/**
 * THE ADMIN DASHBOARD — local only, read-only, IST days.
 *
 * The figures here are the ones a decision gets made on ("who is loyal",
 * "did anyone come back"), so the arithmetic is pinned against a fixed book
 * and a fixed instant. The last two checks matter most: this reads with a key
 * that bypasses every row-level policy, so it must never become part of the
 * app, and must never listen on anything but this machine.
 */
const NOW = Date.parse("2026-09-20T05:00:00Z");   // 10:30am IST on the 20th
const D = (day, h = 6) => `${day}T${String(h).padStart(2, "0")}:00:00Z`;

const book = () => ({
  users: [
    { id: "a", email: "loyal@x.com", created_at: D("2026-07-01"), last_sign_in_at: D("2026-09-20") },
    { id: "b", email: "quiet@x.com", created_at: D("2026-07-10"), last_sign_in_at: D("2026-08-20") },
    { id: "c", email: "new@x.com", created_at: D("2026-09-20", 3), last_sign_in_at: D("2026-09-20", 3) },
    { id: "d", email: "never@x.com", created_at: D("2026-09-01"), last_sign_in_at: D("2026-09-01") },
  ],
  profiles: [
    { id: "a", journal_name: "Loyal Ledger", onboarded_at: D("2026-07-01") },
    { id: "b", journal_name: "Quiet Ledger", onboarded_at: D("2026-07-10") },
    { id: "c", journal_name: "New Ledger", onboarded_at: null },
    { id: "d", journal_name: "Idle Ledger", onboarded_at: D("2026-09-01") },
  ],
  events: [
    /* Six separate days this month, and twice on one of them — a day is a day. */
    ...["2026-09-20", "2026-09-19", "2026-09-17", "2026-09-14", "2026-09-10", "2026-09-05"]
      .map((d) => ({ user_id: "a", event: "opened", created_at: D(d) })),
    { user_id: "a", event: "opened", created_at: D("2026-09-20", 4) },
    { user_id: "a", event: "imported", created_at: D("2026-09-20") },
    { user_id: "b", event: "opened", created_at: D("2026-08-20") },
    { user_id: "c", event: "opened", created_at: D("2026-09-20", 3) },
    { user_id: "d", event: "opened", created_at: D("2026-09-01") },
  ],
  trades: [
    { user_id: "a", created_at: D("2026-09-20") },
    { user_id: "a", created_at: D("2026-09-20", 4) },
    { user_id: "a", created_at: D("2026-09-19") },
    { user_id: "b", created_at: D("2026-08-20") },
  ],
  diary: [{ user_id: "a", created_at: D("2026-09-20") }],
});

test("a day is an IST day, not a UTC one", () => {
  /* 11pm UTC on the 19th is already the 20th in Delhi. Counting signups by
     the UTC day would report today's first users as yesterday's. */
  eq(istDay("2026-09-19T19:00:00Z"), "2026-09-20");
  eq(istDay("2026-09-19T18:29:00Z"), "2026-09-19");
  eq(istDayBack(NOW, 0), "2026-09-20");
  eq(istDayBack(NOW, 7), "2026-09-13");
});

test("today's board counts people, not page opens", () => {
  const r = buildReport(book(), NOW);
  /* "a" opened twice today and "c" once: two people, not three opens. */
  eq(r.today.activeUsers, 2);
  eq(r.today.signups, 1, "one account made today");
  eq(r.today.trades, 2);
  eq(r.today.diary, 1);
  eq(r.today.imports, 1);
  eq(r.yesterday.trades, 1);
});

test("the people list carries the name and the email, most active first", () => {
  const list = people(book(), NOW);
  eq(list[0].email, "loyal@x.com");
  eq(list[0].name, "Loyal Ledger");
  eq(list[0].activeDays30, 6, "six separate days, not seven opens");
  eq(list[0].trades, 3);
  eq(list[0].daysSinceSeen, 0);
  /* Last seen 20 August 06:00 UTC; now is 20 September 05:00 UTC — thirty
     whole days and twenty-three hours, which is thirty days ago, not 31. */
  eq(list.find((p) => p.email === "quiet@x.com").daysSinceSeen, 30);
});

test("the three lists are the three decisions", () => {
  const r = buildReport(book(), NOW);
  eq(r.loyal.map((p) => p.email).join(), "loyal@x.com", `${LOYAL_DAYS}+ active days in the month`);
  eq(r.quiet.map((p) => p.email).join(), "quiet@x.com", `traded once, nothing for ${QUIET_DAYS} days`);
  /* Signed up and never logged a trade — including the one who signed up an
     hour ago, who is not a failure yet but is the same question. */
  eq(r.neverStarted.map((p) => p.email).sort().join(), "never@x.com,new@x.com");
});

test("retention asks only the cohort old enough to answer", () => {
  const r = buildReport(book(), NOW);
  /* Signed up 30+ days ago: a and b. Back in the last week: a. */
  eq(r.retention.cohort, 2);
  eq(r.retention.retained, 1);
  near(r.retention.pct, 50, 1e-9);
  eq(r.totals.users, 4);
  eq(r.totals.withTrades, 2);
});

test("an empty database is a page, not a crash", () => {
  const r = buildReport({ users: [], profiles: [], events: [], trades: [], diary: [] }, NOW);
  eq(r.totals.users, 0);
  eq(r.today.activeUsers, 0);
  ok(Number.isNaN(r.retention.pct), "no cohort is not 0% — it is no answer yet");
});

test("nothing in the app imports it, and nothing here is deployed", () => {
  const walk = (dir) => readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name))
      : /\.(js|jsx|mjs)$/.test(e.name) ? [path.join(dir, e.name)] : []);
  for (const f of walk("src")) {
    ok(!/scripts\/admin/.test(read(f)), `${f} must not reach into the admin tool`);
  }
});

test("it listens on this machine only, and can only read", () => {
  const src = read("scripts/admin/server.mjs");
  ok(/\.listen\(port, "127\.0\.0\.1"/.test(src), "127.0.0.1 — not 0.0.0.0, not the network");
  /* A write would need one of these. None is here, and that is the point. */
  for (const verb of ["method: \"POST\"", "method: \"PATCH\"", "method: \"DELETE\"", "method: \"PUT\""]) {
    ok(!src.includes(verb), `no ${verb} — the dashboard reads and nothing else`);
  }
  ok(/replace\(KEY, "«key»"\)/.test(src), "an error message can never print the service key");
  ok(!/SUPABASE_SERVICE_ROLE_KEY=/.test(read(".env.example")),
     "the example file names the key, never carries one");
});
