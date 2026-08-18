# If personal data is exposed

The Privacy Policy promises that a breach will be reported to you and to the
Data Protection Board of India. This is how that promise gets kept, written
down now rather than improvised at the time, because the point of a runbook is
that it is read by somebody who is rattled.

**Under the DPDP Act every personal data breach is notifiable.** There is no
severity threshold to argue about and no "it was only a few records" exemption.
The Board is told, and so is every affected person. Deciding an incident was
too small to report is the one judgement call not available.

A breach is any unauthorised processing, accidental disclosure, acquisition,
sharing, use, alteration, destruction or loss of access. That includes losing
data as well as leaking it — a restore that silently drops rows is a breach.

---

## 1. Stop it getting worse (first hour)

Do the containing thing first even if it degrades the service. An app that is
briefly down is a smaller problem than one still leaking.

- **Revoke sessions** if tokens or credentials may be out:
  `delete from auth.sessions where created_at >= '<when it started>';`
  This cascades to refresh tokens, which is the credential that does not
  expire on its own.
- **Rotate whatever leaked.** `SUPABASE_SERVICE_ROLE_KEY` and the Resend key
  are in Vercel's environment; the anon key is public by design and is not a
  secret. Rotating the service role key requires redeploying.
- **Turn the leaking thing off** — a route, a share link, an integration —
  rather than patching it live.
- **Do not delete evidence.** Logs, the offending rows and the deploy that
  caused it are what the report is built from. Take a backup before fixing:
  `bash scripts/backup.sh`.

## 2. Work out the blast radius (same day)

Write these down as you find them; they are the report.

- What categories of data — trades, email addresses, chart images, tokens?
- **Which users, by id.** Not "some users". The list goes in the notification.
- When it started and when it stopped.
- Whether anyone outside actually accessed it, or only could have.
- How it happened, in one sentence you would be willing to publish.

Useful starting points: Supabase logs, Vercel function logs, and
`public.client_errors`. If page analytics recorded URLs, check whether they
captured anything they should not have — that has happened here before, in
August 2026, when access tokens rode into Umami in a URL fragment.

## 3. Tell the Board

Report to the Data Protection Board of India **without delay**, through the
channel current at the time — check the Board's own site rather than trusting
a link written here, because the mechanism is newer than this file.

Include what section 2 gathered: nature, extent, timing, likely consequences,
what has been done, and what affected people are being told.

## 4. Tell the people affected

Every affected user, individually, in plain language. Not a status page, not a
banner — the policy promises they will be told, and a notice they have to go
looking for is not being told.

Say what happened, what data of theirs was involved, what has been done, what
they should do (change a password, sign out everywhere), and how to reach us.
Do not minimise and do not speculate about who was responsible.

Sending goes through Resend, and it is the one email that must not be batched
carelessly — a user seeing someone else's address in a To: field turns one
breach into two.

## 5. Afterwards

- Write down what actually caused it, in the repo, near the code that allowed
  it. The comment beside the fix is what stops the second occurrence.
- Add the check that would have caught it. Prefer one that fails loudly to one
  that requires remembering.
- Note it in the memory index so the next session knows.

---

## What makes this app's exposure smaller than it could be

Worth knowing while assessing, since a calm accurate picture beats a panicked
one:

- **RLS is on and policied** for profiles, trades, diary_entries, capital_flows,
  import_batches, trade_exits and storage.objects. A leaked anon key does not
  read other people's rows.
- **The service role key is server-side only** and never reaches the browser
  bundle.
- **No payment details exist.** Nothing is charged, so there is no card data to
  lose.
- **Sessions live in localStorage, not cookies**, so a CSRF-style attack has
  nothing to ride on — the trade-off being that tokens can travel in URLs,
  which is exactly the failure of August 2026.

## What to look at first, because it has bitten before

- **An RLS-blocked delete returns success with zero rows.** Three separate
  incidents in this project. After any delete that matters, count the rows.
  "No error" is not "it happened."
- **URL fragments carrying tokens**, if anything new starts reading
  `window.location`.
- **A build or restore that silently shrinks data** — `build-symbols.mjs` now
  refuses to write a much smaller file for this reason, and restore is
  idempotent by derived id only.
