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
# Two files, because they restore in this order and the split is what makes
# a partial restore possible:
#
#   schema.sql  tables, policies, functions, triggers
#   data.sql    the rows, as COPY statements (far faster to load than inserts)
#
# No roles file. pg_dump cannot dump cluster roles (that is pg_dumpall, which
# Supabase does not permit), and a fresh project already has the roles a
# restore needs — which is why --no-owner is passed below.
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
DB_URL="$(grep -E '^SUPABASE_DB_URL=' .env.local | head -1 | cut -d= -f2- | tr -d '"'"'"'' | tr -d '\r')"

# Supabase prints the string with the password as a placeholder in square
# brackets. Substituting the password while leaving the brackets is the most
# natural mistake available, and it has been made twice here — once on the
# live project and once on the scratch one. It surfaces as "password
# authentication failed", which sends you looking at the password rather than
# at the two characters around it.
#
# A bracket cannot appear in a Supabase-generated password, so stripping a
# matched pair that wraps the whole field is safe and never eats a real one.
if printf '%s' "$DB_URL" | grep -qE '^postgresql://[^:]+:\[.*\]@'; then
  DB_URL="$(printf '%s' "$DB_URL" | sed -E 's#^(postgresql://[^:]+:)\[(.*)\](@.+)$#\1\2\3#')"
  echo "  (removed the [ ] around the password — that is a placeholder artefact)"
fi

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

# ------------------------------------------------------------- pg_dump
#
# Directly, not through the Supabase CLI. `supabase db dump` runs pg_dump
# inside a container and so requires Docker Desktop — a large install to do a
# job pg_dump already does, and one more moving part between you and your data
# at the moment you most want fewer.
#
# Postgres.app supplies pg_dump AND the psql that verify-restore.sh needs, so
# one download covers taking a backup and proving it restores.
#
# The version check is not ceremony: pg_dump refuses outright to dump a server
# newer than itself, and the pg_dump on PATH here is 9.3, from 2014.
PGDUMP="${PGDUMP:-}"
if [ -z "$PGDUMP" ]; then
  for c in /Applications/Postgres.app/Contents/Versions/latest/bin/pg_dump \
           /opt/homebrew/bin/pg_dump /usr/local/bin/pg_dump; do
    [ -x "$c" ] && PGDUMP="$c" && break
  done
fi
[ -n "$PGDUMP" ] || PGDUMP="$(command -v pg_dump || true)"

if [ -z "$PGDUMP" ]; then
  echo "No pg_dump found. Install Postgres.app from postgresapp.com and re-run."
  exit 1
fi

PV="$("$PGDUMP" --version | grep -oE '[0-9]+' | head -1)"
if [ "$PV" -lt 14 ]; then
  echo "pg_dump $PV is too old for a Supabase database (found: $PGDUMP)."
  echo "Install Postgres.app from postgresapp.com, then re-run."
  echo "It installs alongside what you have and changes nothing else."
  exit 1
fi

# ------------------------------------------------- check we can connect first
#
# Added after three runs that printed "schema…" and then sat there. pg_dump
# says nothing at all when a connection is refused this way — it simply waits,
# so a wrong username or region looks exactly like a slow dump, and the only
# way to find out was to run psql by hand.
#
# psql reports the same failure in under a second, so it is asked first and the
# error is shown as given. The two mistakes it catches are both easy to make
# from a copied example: a username still reading postgres.xxxx, and a pooler
# host in a region the project is not in. Both come back as "tenant/user not
# found", which does not sound like either.
PSQL="${PSQL:-$(dirname "$PGDUMP")/psql}"
if [ -x "$PSQL" ]; then
  if ! ERR="$("$PSQL" "$DB_URL" -Atc 'select 1' 2>&1)"; then
    echo "Cannot connect to the database:"
    echo "  $(printf '%s' "$ERR" | head -1)"
    echo
    echo "Check SUPABASE_DB_URL in .env.local. Copy it from Supabase → Connect →"
    echo "Session pooler and replace only [YOUR-PASSWORD] — hand-editing an"
    echo "example leaves the wrong project ref or the wrong region behind, and"
    echo "both report as 'tenant/user not found'."
    exit 1
  fi
fi

STAMP="$(date +%Y-%m-%d-%H%M)"
OUT="backups/$STAMP"
mkdir -p "$OUT"

echo "Backing up to $OUT  (pg_dump $PV)"

# public holds the journal; auth holds the accounts those rows belong to.
# Without auth, every trade points at a user that does not exist and the
# restore fails on the foreign key — so a public-only dump would look fine
# and be unrestorable, which is the exact failure this whole exercise is
# meant to catch.
SCHEMAS="--schema=public --schema=auth"

# --no-owner and --no-privileges because the roles on a restored project are
# not the roles here, and a dump that insists on them fails on every line.
echo "  schema…"
"$PGDUMP" "$DB_URL" $SCHEMAS --schema-only --no-owner --no-privileges \
  --quote-all-identifiers -f "$OUT/schema.sql"

echo "  data…"
"$PGDUMP" "$DB_URL" $SCHEMAS --data-only --no-owner --no-privileges \
  --quote-all-identifiers -f "$OUT/data.sql"

# A dump that "succeeded" and wrote nothing is the failure this catches. It has
# happened on other projects — credentials that authenticate but reach an empty
# database produce a valid, useless file.
for f in schema data; do
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
