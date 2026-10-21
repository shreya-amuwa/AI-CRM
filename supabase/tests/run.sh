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

$PSQL -d "$DB" -o /dev/null -f supabase/tests/payments_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/automations_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/client_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/tickets_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/hr_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/invoices_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/journeys_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/import_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/business_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/paid_invoices_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/hr_email_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/security_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/chat_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/dashboards_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/subscription_reminders_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/workflow_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/delete_customer_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
