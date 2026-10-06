#!/usr/bin/env bash
# Applies the Supabase shim + every migration to a scratch database and runs
# the authorization test-suite. Usage:
#   PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
# Requires a superuser on a throw-away PostgreSQL 15+ instance (NOT Supabase).
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${TEST_DB:-crm_rls_test}"
PSQL="psql -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d "$DB" -f supabase/tests/supabase_shim.sql 2>/dev/null
for f in supabase/migrations/*.sql; do
  $PSQL -d "$DB" -f "$f"
done

$PSQL -d "$DB" -o /dev/null -f supabase/tests/rls_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
