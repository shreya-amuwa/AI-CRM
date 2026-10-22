#!/usr/bin/env bash
# The security-relevant database suites only (authorization of every role, client isolation, chat isolation, upload
# attestation, catalog invariants, sign-in lock-out). Used by the weekly security workflow; `npm run test:db` runs all.
#   PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run-security.sh
# Requires a superuser on a throw-away PostgreSQL 15+ instance (NOT Supabase).
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${TEST_DB:-crm_security_test}"
PSQL="psql -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d "$DB" -f supabase/tests/supabase_shim.sql 2>/dev/null
for f in supabase/migrations/*.sql; do
  $PSQL -d "$DB" -f "$f"
done
for t in rls_test security_invariants_test client_test tickets_test security_test chat_test; do
  $PSQL -d "$DB" -o /dev/null -f "supabase/tests/$t.sql" 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
done
