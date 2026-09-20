/**
 * Pulse — the admin dashboard, on this machine only.
 *
 * WHY IT IS NOT A PAGE ON ledgerr.app. Showing who your users are means
 * reading `auth.users`, which needs the service role key, which bypasses
 * every row-level policy in the database. On Vercel that key would sit behind
 * one authorisation check on a public URL, and a single mistake in that check
 * exposes every user's email at once. Here there is no URL to get it wrong:
 * the server binds to 127.0.0.1, the key is read from .env.local and never
 * leaves this laptop, and nothing in this directory is imported by the app or
 * deployed with it.
 *
 * READ-ONLY. It issues selects and nothing else. There is no button here that
 * can change a user's data, by design — the day this can write is the day it
 * needs the caution a dashboard should not need.
 *
 *   npm run admin        → http://127.0.0.1:7788
 *   npm run admin -- 8080  to pick another port
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildReport } from "./report.mjs";
import { render } from "./page.mjs";

/* fileURLToPath, never `.pathname`: this project lives in a folder with
   spaces in its name, and a URL spells those %20. The file then never opens,
   every key reads as missing, and the tool reports a setup problem that is
   entirely its own. */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** One variable out of .env.local, without sourcing the file. */
function env(name) {
  try {
    const line = readFileSync(`${ROOT}.env.local`, "utf8")
      .split("\n").find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") : null;
  } catch { return null; }
}

const URL_BASE = env("NEXT_PUBLIC_SUPABASE_URL");
const KEY = env("SUPABASE_SERVICE_ROLE_KEY");

if (!URL_BASE || !KEY) {
  console.error(`
Missing keys in .env.local.

  NEXT_PUBLIC_SUPABASE_URL       (already there if the app runs)
  SUPABASE_SERVICE_ROLE_KEY      Supabase → Project Settings → API →
                                 "service_role", under Project API keys

That key reads every user's data, so it belongs in .env.local and nowhere
else — never in the app, never in a commit. .env.local is gitignored.
`);
  process.exit(1);
}

const head = { apikey: KEY, Authorization: `Bearer ${KEY}` };

/** A table, paged, newest-agnostic — these are small and read whole. */
async function table(name, select = "*") {
  const out = [];
  for (let page = 0; page < 40; page++) {
    const from = page * 1000;
    const res = await fetch(`${URL_BASE}/rest/v1/${name}?select=${select}`, {
      headers: { ...head, Range: `${from}-${from + 999}` },
    });
    if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** auth.users is not a REST table — it has its own admin endpoint. */
async function users() {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${URL_BASE}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: head });
    if (!res.ok) throw new Error(`users: ${res.status} ${await res.text()}`);
    const body = await res.json();
    const rows = body.users || [];
    out.push(...rows);
    if (rows.length < 200) break;
  }
  return out.map((u) => ({
    id: u.id, email: u.email,
    created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
  }));
}

async function collect() {
  const [u, profiles, events, trades, diary] = await Promise.all([
    users(),
    table("profiles", "id,journal_name,onboarded_at,analytics_opt_out,created_at"),
    table("user_events", "user_id,event,created_at"),
    table("trades", "user_id,created_at"),
    table("diary_entries", "user_id,created_at"),
  ]);
  /* Your own logins, out of the figures. Kept in .env.local, not here: the
     repo is public and these are your addresses. */
  const exclude = (env("ADMIN_EXCLUDE") || "").split(",").map((e) => e.trim()).filter(Boolean);
  return buildReport({ users: u, profiles, events, trades, diary }, Date.now(), { exclude });
}

const port = Number(process.argv[2]) || 7788;

createServer(async (req, res) => {
  try {
    const report = await collect();
    if (req.url?.startsWith("/data")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(report, null, 2));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(render(report));
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    /* The message can carry a Supabase error, never the key. */
    res.end(`Could not read: ${String(e.message || e).replace(KEY, "«key»")}`);
  }
/* 127.0.0.1, not 0.0.0.0: not reachable from the network, not from a café
   wifi, not from anything but this machine. */
}).listen(port, "127.0.0.1", () => {
  console.log(`\n  Pulse — http://127.0.0.1:${port}\n  Read-only. Ctrl-C to stop.\n`);
});
