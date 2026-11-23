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
$PSQL -d "$DB" -o /dev/null -f supabase/tests/part_payment_invoice_number_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/payment_invoice_billing_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/invoice_whatsapp_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/hr_email_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/hr_documents_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/hr_letter_templates_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/hr_employee_files_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

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
$PSQL -d "$DB" -o /dev/null -f supabase/tests/chat_automatic_keys_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

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

$PSQL -d "$DB" -o /dev/null -f supabase/tests/employee_hierarchy_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/subscriptions_list_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/work_reports_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/work_reports_two_level_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/reports_company_flow_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/employee_welcome_email_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/consultant_meta_workflow_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/top_performers_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/operations_head_creation_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/department_head_leads_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/service_journeys_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/team_lead_ownership_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/client_chat_access_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/meta_verifier_departments_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/employee_offboarding_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/department_function_scopes_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/chat_company_readable_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/task_delegation_detail_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/team_lead_direct_scope_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"

$PSQL -d "$DB" -o /dev/null -f supabase/tests/team_lead_strict_isolation_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/leave_multi_level_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/careers_test.sql
$PSQL -d "$DB" -o /dev/null -f supabase/tests/careers_direct_registration_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/customers_rls_equivalence_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/careers_catalogue_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/career_jobs_single_function_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/recruiter_workflow_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/recruiter_vacancy_management_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/hr_chat_integration_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/hr_designations_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/meta_verifier_routing_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/field_visit_tracking_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/leave_chain_by_requester_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/customer_service_helpers_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/weekly_report_routing_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/task_hierarchy_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/attendance_punch_lunch_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/client_support_groups_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/chat_receipts_light_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/staff_password_reset_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/attendance_places_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/attendance_register_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/attendance_reminders_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/chat_push_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/incentives_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/payouts_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/payouts_razorpay_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/messaging_onboarding_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/paid_leave_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/hr_assistant_recruitment_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/superadmin_overview_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/meetings_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/meetings_organiser_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/meetings_ceo_approval_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/work_update_requests_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/department_head_dashboard_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/task_work_updates_v2_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/lead_upload_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/bolify_recharge_reminders_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/lead_whatsapp_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/ai_studio_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/ai_studio_deadlines_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/ai_design_studio_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/designstudio_roles_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/ai_website_onboarding_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/meeting_presence_employees_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/client_meetings_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/developer_bugs_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/task_skip_level_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/crocodial_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/crocodial_sync_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/crocodial_activity_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/crocodial_team_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/crocodial_sync_now_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/crocodial_count_from_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/crocodial_leads_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/sales_role_dashboards_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/realtime_publication_trim_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/chat_inbox_mentions_reactions_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/meeting_summaries_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/notification_reliability_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
$PSQL -d "$DB" -o /dev/null -f supabase/tests/unified_departments_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
