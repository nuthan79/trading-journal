#!/usr/bin/env bash
#
# Prove a backup restores. This is the whole of non-negotiable #6.
#
# "Supabase has backups" is a belief. A dump you have loaded into an empty
# project and counted rows in is a fact, and the gap between those two is
# where every backup horror story lives: the file that was truncated, the dump
# that authenticated against the wrong database, the restore that needed a role
# nobody had written down.
#
# WHY psql AND NOT THE SUPABASE CLI. The CLI can dump but has no command to run
# arbitrary SQL against a remote database — `db push` applies migrations and
# needs a project structure, which a restore is not. So loading a dump needs
# psql, and it must be a modern one: the psql on this machine is 9.3, from 2014,
# and cannot talk to the Postgres Supabase runs. Install Postgres.app
# (postgresapp.com), which needs no Homebrew and no Docker, then either add its
# bin directory to PATH or pass PSQL=/path/to/psql.
#
# THIS MUST NOT TOUCH THE REAL PROJECT. It restores into a scratch Supabase
# project made for the purpose and deleted afterwards. Restoring a schema over
# a live database is how a bad afternoon becomes a bad quarter, so there is a
# guard below that refuses the connection string this repo is configured with.
#
#   1. supabase.com → New project (free tier is fine) → wait for it to be ready
#   2. Settings → Database → Connection string → URI
#   3. bash scripts/verify-restore.sh backups/2026-08-13-1900 "postgresql://…"
#   4. Delete the scratch project
set -euo pipefail

cd "$(dirname "$0")/.."

DIR="${1:-}"
TARGET="${2:-}"

if [ -z "$DIR" ] || [ -z "$TARGET" ]; then
  cat <<'MSG'
Usage: bash scripts/verify-restore.sh <backup-dir> <scratch-db-url>

  <backup-dir>       e.g. backups/2026-08-13-1900
  <scratch-db-url>   URI of a THROWAWAY Supabase project

Never pass your production connection string — this writes a schema.
MSG
  exit 1
fi

[ -f "$DIR/schema.sql" ] || { echo "Missing $DIR/schema.sql"; exit 1; }
[ -f "$DIR/data.sql"   ] || { echo "Missing $DIR/data.sql";   exit 1; }
[ -f "$DIR/counts.txt" ] || { echo "Missing $DIR/counts.txt — retake the backup."; exit 1; }

# ---------------------------------------------------------------- psql
# Looked for in the likely places rather than trusting PATH, because the one
# on PATH here is the 9.3 that cannot do the job.
PSQL="${PSQL:-}"
if [ -z "$PSQL" ]; then
  for c in /Applications/Postgres.app/Contents/Versions/latest/bin/psql \
           /opt/homebrew/bin/psql /usr/local/bin/psql; do
    [ -x "$c" ] && PSQL="$c" && break
  done
fi
[ -n "$PSQL" ] || PSQL="$(command -v psql || true)"

if [ -z "$PSQL" ]; then
  echo "No psql found. Install Postgres.app from postgresapp.com, then re-run."
  exit 1
fi

PV="$("$PSQL" --version | grep -oE '[0-9]+' | head -1)"
if [ "$PV" -lt 14 ]; then
  echo "psql $PV is too old to load a Supabase dump (found: $PSQL)."
  echo "Install Postgres.app from postgresapp.com, or pass PSQL=/path/to/psql."
  exit 1
fi
echo "Using psql $PV"

# ------------------------------------------------------- production guard
LIVE_REF="$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' .env.local 2>/dev/null \
            | sed -E 's#.*//([a-z0-9]+)\..*#\1#' || true)"
if [ -n "${LIVE_REF:-}" ] && printf '%s' "$TARGET" | grep -q "$LIVE_REF"; then
  echo "REFUSING: that points at your live project ($LIVE_REF)."
  echo "Make a scratch project and pass its URI instead."
  exit 1
fi

# ------------------------------------------------------------- restore
# ON_ERROR_STOP is off deliberately. A Supabase dump replays statements for
# roles and extensions that a fresh project already has, and those errors are
# expected and harmless. What matters is not whether every statement succeeded
# but whether the rows arrived — which the counts below answer directly, and
# far more honestly than an exit code would.
echo "Restoring schema…"
"$PSQL" "$TARGET" -q -f "$DIR/schema.sql" 2>"$DIR/.schema.log" || true
echo "Restoring data…"
"$PSQL" "$TARGET" -q -f "$DIR/data.sql"   2>"$DIR/.data.log"   || true

# ---------------------------------------------------------- verification
echo "Re-dumping what actually landed…"
TMP="$(mktemp -d)"
npx --yes supabase@2 db dump --db-url "$TARGET" --data-only --use-copy -f "$TMP/data.sql"

awk '
  /^COPY /           { t=$2; n=0; inside=1; next }
  inside && /^\\\.$/ { print n "\t" t; inside=0; next }
  inside             { n++ }
' "$TMP/data.sql" | sort -k2 > "$TMP/counts.txt"

echo
printf "  %-28s %8s %10s\n" "table" "backup" "restored"
FAIL=0
while IFS=$'\t' read -r want table; do
  got="$(awk -v t="$table" '$2==t {print $1}' "$TMP/counts.txt")"
  got="${got:-0}"
  mark="ok"
  if [ "$want" != "$got" ]; then mark="MISMATCH"; FAIL=1; fi
  printf "  %-28s %8s %10s   %s\n" "$table" "$want" "$got" "$mark"
done < "$DIR/counts.txt"

rm -rf "$TMP"
echo
if [ "$FAIL" = 0 ]; then
  echo "VERIFIED — every table came back with the same number of rows."
  echo "Non-negotiable #6 is satisfied for this backup. Delete the scratch project."
else
  echo "NOT VERIFIED — the counts disagree. Do not rely on this backup."
  echo "Statement errors, if you want them: $DIR/.schema.log and $DIR/.data.log"
  exit 1
fi
