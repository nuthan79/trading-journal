/**
 * The page itself — one file, no build step, no framework.
 *
 * It refreshes itself every 60 seconds. Day-to-day is the honest cadence for
 * most of these figures (a signup count at 11am says little), but the top row
 * is live enough to watch during a launch.
 */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const n = (v) => (Number.isFinite(v) ? v.toLocaleString("en-IN") : "—");
const pct = (v) => (Number.isFinite(v) ? `${v.toFixed(0)}%` : "—");

const day = (iso) => {
  if (!iso) return "never";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
};

const ago = (days) => days == null ? "never"
  : days === 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`;

const tile = (label, value, sub = "") =>
  `<div class="tile"><span>${esc(label)}</span><b>${esc(value)}</b><i>${esc(sub)}</i></div>`;

const rows = (list, kind) => list.length ? list.map((p) => `
  <tr>
    <td><b>${esc(p.name)}</b></td>
    <td class="mail"><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></td>
    <td class="num">${n(p.activeDays30)}</td>
    <td class="num">${n(p.trades)}</td>
    <td class="num">${n(p.diary)}</td>
    <td>${esc(day(p.signedUp))}</td>
    <td>${esc(ago(p.daysSinceSeen))}</td>
  </tr>`).join("") : `<tr><td colspan="7" class="none">Nobody yet — ${esc(kind)}</td></tr>`;

const table = (title, note, list, kind) => `
  <section>
    <h2>${esc(title)} <span>${list.length}</span></h2>
    <p>${esc(note)}</p>
    <table>
      <thead><tr>
        <th>Ledger</th><th>Email</th><th class="num">Days active (30d)</th>
        <th class="num">Trades</th><th class="num">Diary</th><th>Signed up</th><th>Last seen</th>
      </tr></thead>
      <tbody>${rows(list, kind)}</tbody>
    </table>
  </section>`;

/**
 * Who is in there now — or as near as the data can honestly say.
 *
 * There is no heartbeat, so this is "did something in the last half hour",
 * and it is labelled as that. A tile claiming live presence it cannot
 * measure would be the one figure here nobody could trust.
 */
const liveTile = (r) => `
  <div class="tile live">
    <span>Active right now</span>
    <b>${n(r.live.length)}</b>
    <i>${r.live.length
      ? esc(r.live.slice(0, 3).map((p) => `${p.name} · ${p.minutesAgo}m`).join(" · "))
        + (r.live.length > 3 ? ` +${r.live.length - 3}` : "")
      : `nothing in the last ${r.liveMinutes} minutes`}</i>
  </div>`;

export function render(r) {
  const t = r.today, y = r.yesterday;
  const bars = r.days.slice().reverse();
  const max = Math.max(1, ...bars.map((d) => d.activeUsers));

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Pulse — LedgeRR</title>
<meta http-equiv="refresh" content="60">
<style>
  :root { --ink:#1A1A1A; --ink2:#4A4A4A; --ink3:#8A8A8A; --rule:#E2E0DB;
          --card:#FFFFFF; --bg:#F4F3F0; --brass:#B8862F; --long:#0F7A63; --short:#A83E27; }
  * { box-sizing: border-box; }
  body { margin:0; padding:28px 32px 60px; background:var(--bg); color:var(--ink);
         font:14px/1.5 ui-sans-serif,-apple-system,"Segoe UI",sans-serif; }
  header { display:flex; align-items:baseline; gap:14px; margin-bottom:22px; }
  h1 { font-size:19px; margin:0; letter-spacing:.02em; }
  header i { font-style:normal; font-size:11.5px; color:var(--ink3); }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
  .tile { background:var(--card); border:1px solid var(--rule); border-radius:3px; padding:12px 14px; }
  .tile span { display:block; font-size:10.5px; letter-spacing:.09em; text-transform:uppercase; color:var(--ink3); }
  .tile b { display:block; font-size:25px; font-weight:500; margin-top:5px; font-variant-numeric:tabular-nums; }
  .tile i { display:block; font-style:normal; font-size:11px; color:var(--ink3); margin-top:3px; }
  .tile.live { border-color:var(--long); }
  .tile.live b { color:var(--long); }
  .mk { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--brass);
        font-weight:600; margin-left:2px; }
  section { margin-top:30px; }
  h2 { font-size:12px; letter-spacing:.09em; text-transform:uppercase; color:var(--ink2);
       margin:0 0 3px; display:flex; align-items:center; gap:8px; }
  h2 span { color:var(--brass); font-size:12px; }
  section p { margin:0 0 10px; font-size:12px; color:var(--ink3); max-width:70ch; }
  table { width:100%; border-collapse:collapse; background:var(--card);
          border:1px solid var(--rule); border-radius:3px; }
  th,td { text-align:left; padding:8px 12px; border-bottom:1px solid var(--rule); font-size:12.5px; }
  th { font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink3); font-weight:600; }
  tr:last-child td { border-bottom:0; }
  .num { text-align:right; font-variant-numeric:tabular-nums; }
  .none { color:var(--ink3); font-style:italic; }
  .mail a { color:var(--brass); text-decoration:none; }
  .mail a:hover { text-decoration:underline; }
  .spark { display:flex; align-items:flex-end; gap:4px; height:58px; background:var(--card);
           border:1px solid var(--rule); border-radius:3px; padding:10px 12px; }
  .spark div { flex:1; background:var(--brass); opacity:.75; border-radius:1px 1px 0 0; min-height:2px; }
  .spark div.today { opacity:1; background:var(--long); }
  .legend { display:flex; justify-content:space-between; font-size:10.5px; color:var(--ink3); margin-top:5px; }
</style></head>
<body>
  <header>
    <h1>Pulse <span class="mk">LedgeRR</span></h1>
    <i>${esc(new Date(r.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))} IST · refreshes every minute · read-only${
      r.excluded ? ` · ${r.excluded} of your own accounts left out` : ""}</i>
  </header>

  <div class="tiles">
    ${liveTile(r)}
    ${tile("Signed in today", n(t.activeUsers), `${n(y.activeUsers)} yesterday`)}
    ${tile("New accounts today", n(t.signups), `${n(r.totals.signups7)} this week`)}
    ${tile("Trades logged today", n(t.trades), `${n(y.trades)} yesterday`)}
    ${tile("Diary entries today", n(t.diary), `${n(y.diary)} yesterday`)}
    ${tile("Imports today", n(t.imports), "files brought in")}
    ${tile("Total accounts", n(r.totals.users), `${n(r.totals.withTrades)} have logged a trade`)}
    ${tile("Active this week", n(r.totals.active7), `${n(r.totals.active30)} in 30 days`)}
    ${tile("Still here after 30d", pct(r.retention.pct), `${n(r.retention.retained)} of ${n(r.retention.cohort)} old enough to count`)}
  </div>

  <section>
    <h2>People signing in, by day</h2>
    <p>Fourteen IST days, oldest on the left. One person counts once a day however many times they open it.</p>
    <div class="spark">
      ${bars.map((d, i) => `<div class="${i === bars.length - 1 ? "today" : ""}" style="height:${(d.activeUsers / max) * 100}%" title="${esc(d.day)}: ${d.activeUsers}"></div>`).join("")}
    </div>
    <div class="legend"><span>${esc(bars[0].day)}</span><span>${esc(bars[bars.length - 1].day)}</span></div>
  </section>

  ${r.live.length ? table("In the journal now",
    `Anyone who logged a trade, wrote an entry or opened the app in the last ${r.liveMinutes} minutes.`,
    r.live, "") : ""}
  ${table("Worth thanking", "Opened the journal on five or more separate days in the last month. These are the people whose habit has actually formed — write to them by name.", r.loyal, "nobody has five active days in the last month yet")}
  ${table("Gone quiet", "Logged trades once and has not been back in a fortnight. A short, specific note here is worth more than any feature.", r.quiet, "nobody has drifted off")}
  ${table("Signed up, never logged a trade", "They made an account and stopped. Whatever happened, it happened before the first trade — the part worth fixing.", r.neverStarted, "everyone who signed up has logged a trade")}
  ${table("Everyone", "Sorted by days active in the last month.", r.people, "no accounts yet")}

  <section>
    <p>Reading only. Nothing on this page can change a user's data. Raw figures: <a href="/data">/data</a>.</p>
  </section>
</body></html>`;
}
