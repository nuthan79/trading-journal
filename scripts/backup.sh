#!/usr/bin/env bash
#
# A backup of the whole database, taken from this machine.
#
# WHY THIS EXISTS WHEN SUPABASE HAS BACKUPS. On the free tier it does not —
# scheduled backups and point-in-time recovery are paid features. And even on
# a paid plan, a backup that lives only inside the account it is protecting is
# not much of a backup: it does not survive the project being deleted, the
# card expiring, or the account being locked. This one lands on your disk.
#
# It is also the only kind that can be RESTORED AND CHECKED, which is the
# whole of non-negotiable #6. "Supabase has backups" is a belief. A dump you
# have loaded into an empty project and counted rows in is a fact.
#
# Three files, because they restore in this order and the split is what makes
# a partial restore possible:
#
#   roles.sql   cluster roles — rarely changes, needed first
#   schema.sql  tables, policies, functions, triggers
#   data.sql    the rows, as COPY statements (far faster to load than inserts)
#
# The connection string is read from .env.local and never printed. It contains
# the database password, so it must not reach a terminal that gets screenshotted
# — which has already happened once on this project, with a Resend key.
#
#   Supabase → Project Settings → Database → Connection string → URI
#   Add to .env.local as:  SUPABASE_DB_URL=postgresql://...
#
# Usage:  bash scripts/backup.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then
  echo "No .env.local here. Run this from the project."; exit 1
fi

# Read the one variable without sourcing the file — .env.local holds other
# things, and sourcing it would put all of them into this shell.
DB_URL="$(grep -E '^SUPABASE_DB_URL=' .env.local | head -1 | cut -d= -f2- | tr -d '"'"'"'')"

if [ -z "${DB_URL:-}" ]; then
  cat <<'MSG'
SUPABASE_DB_URL is not in .env.local.

  Supabase → Project Settings → Database → Connection string → URI
  Copy it, replace [YOUR-PASSWORD] with the database password, and add:

    SUPABASE_DB_URL=postgresql://postgres.xxxx:PASSWORD@aws-0-region.pooler.supabase.com:5432/postgres

.env.local is gitignored, so it will not be committed.
MSG
  exit 1
fi

STAMP="$(date +%Y-%m-%d-%H%M)"
OUT="backups/$STAMP"
mkdir -p "$OUT"

echo "Backing up to $OUT"

# --yes so a fresh machine does not stop on the install prompt. Pinned to a
# major version: a CLI that silently moves on could change the dump format
# between the backup you take and the one you try to restore.
SB="npx --yes supabase@2 db dump --db-url $DB_URL"

echo "  roles…";  $SB --role-only            -f "$OUT/roles.sql"
echo "  schema…"; $SB                        -f "$OUT/schema.sql"
echo "  data…";   $SB --data-only --use-copy -f "$OUT/data.sql"

# A dump that "succeeded" and wrote nothing is the failure this catches. It has
# happened on other projects — credentials that authenticate but reach an empty
# database produce a valid, useless file.
for f in roles schema data; do
  bytes=$(wc -c < "$OUT/$f.sql" | tr -d ' ')
  if [ "$bytes" -lt 100 ]; then
    echo "  !! $f.sql is only ${bytes} bytes — that is not a real dump."; exit 1
  fi
done

# Row counts, read out of the dump rather than out of the database.
#
# Deliberately not via psql: the one on this machine is 9.3 and cannot talk to
# a modern server. More usefully, counting the dump counts THE THING THAT WILL
# BE RESTORED. A count taken from the live database could agree with reality
# and still say nothing about whether the file on disk is complete — which is
# the only question a backup has to answer.
#
# pg_dump writes each table as COPY … FROM stdin; then rows, then a lone \.
count_rows() {
  awk '
    /^COPY /      { t=$2; n=0; inside=1; next }
    inside && /^\\\.$/ { print n "\t" t; inside=0; next }
    inside        { n++ }
  ' "$1" | sort -k2
}

count_rows "$OUT/data.sql" > "$OUT/counts.txt"

echo
echo "Done:"
ls -lh "$OUT" | awk 'NR>1 {printf "  %-12s %s\n", $9, $5}'
echo
echo "Rows captured:"
awk '{printf "  %-28s %s\n", $2, $1}' "$OUT/counts.txt"
echo
echo "Keep at least one copy off this machine — a backup on the same disk as"
echo "nothing else is a backup against exactly one kind of accident."
echo
echo "To prove it restores:  bash scripts/verify-restore.sh $OUT"
