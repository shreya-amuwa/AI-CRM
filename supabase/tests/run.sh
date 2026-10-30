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

$PSQL -d "$DB" -o /dev/null -f supabase/tests/payment_invoices_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/payment_invoice_billing_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/invoice_whatsapp_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/hr_email_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/security_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/chat_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/dashboards_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/subscription_reminders_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/subscription_messages_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/workflow_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/delete_customer_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/attribution_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/performance_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/recruitment_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/client_notices_hr_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/training_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/payment_gst_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/telecaller_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/business_associate_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/lead_scope_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/sales_only_sections_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/whatsapp_services_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/department_head_division_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/import_brought_by_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/department_scopes_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/wabatalk_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/department_heads_overview_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/access_control_apply_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/operations_head_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/sales_department_head_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/field_visit_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/performance_scope_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/login_location_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/meta_verifier_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/client_provisioning_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/client_progress_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/super_admin_protection_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/member_contact_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/chat_e2ee_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/client_billing_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/sales_meta_handoff_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/panel_details_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/client_credentials_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/handover_service_name_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/invoice_series_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/customer_revenue_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/finance_notifications_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/panel_url_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/department_head_handover_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/client_journey_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/employee_issues_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/subscription_activation_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/accounts_customer_details_test.sql
