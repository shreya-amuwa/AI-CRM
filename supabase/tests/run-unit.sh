#!/usr/bin/env bash
# Unit tests that need no database: invoice arithmetic, the PDF generator, the invoice delivery steps and the WhatsApp checkbox.
# Usage: npm run test:unit
set -euo pipefail
cd "$(dirname "$0")/../.."
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
status=0
for t in in customer_sheet_sync task_deletion meetings_ceo_approval no_hardcoded_secrets sentry_scrub chat_load chat_live attendance_places careers_time careers_validation accounts_profile api_client_cache realtime_shared health_database password_link_lifetime invoice_calc invoice_pdf invoice_email invoice_delivery journey_service security hr_email_templates performance_narrative telecaller_sheet ba_pdf sales_lead_sheet import_template bolify active_scope head_assignment department_head_add_lead task_tracker shop_text subscription_messages onboarding_status_map panel_url invoice_whatsapp client_network chat_e2ee chat_secure_client subscription_terms sales_dashboard_routing work_reports company_reports top_performers_narrative viewport_fit panel_mail careers_upload recruiter_decision_email hr_designations chat_sound field_visit_tracking auth_email_hook candidate_registration hr_documents_render hr_letters hr_employee_files cloudflare_worker smtp_fallback ses_email email_routing abuse_protection sheet_readers meetings cloudflare_audit lead_upload lead_whatsapp ai_studio web_push notification_delivery notification_sound ai_design_studio pwa_assets chat_push designstudio_roles ai_website_onboarding crocodial crocodial_sync chat_mentions sales_role_dashboards ai_studio_deadline session_persistence client_meetings sample_sheets sales_head_nav meeting_ceo_queue issue_routing shared_support_desk unified_dashboard notice_board notice_queue notification_category notification_open hr_awards crocodial_runtime role_names offer_templates meeting_push_open meeting_oversight task_daily_reports performance_sidebar app_feedback no_native_dialogs global_search; do
  f="supabase/tests/$t.test.ts"
  [ -f "$f" ] || continue
  echo "=== $t"
  # the browser API client reads Vite's import.meta.env (empty in Node)
  extra=(); { [ "$t" = api_client_cache ] || [ "$t" = realtime_shared ] || [ "$t" = chat_live ] || [ "$t" = field_visit_tracking ] || [ "$t" = ai_website_onboarding ] || [ "$t" = session_persistence ] || [ "$t" = sample_sheets ] || [ "$t" = sales_head_nav ] || [ "$t" = client_meetings ] || [ "$t" = task_tracker ] || [ "$t" = notification_open ] || [ "$t" = crocodial_runtime ]; } && extra=(--define:import.meta.env={})
  npx esbuild "$f" --bundle --platform=node --format=esm --packages=external --outfile="$WORK/$t.mjs" --log-level=warning "${extra[@]}"
  # run from the repo root so package imports resolve; the bundle itself lives in a temp directory
  cp "$WORK/$t.mjs" "./.unit_$t.tmp.mjs"
  node "./.unit_$t.tmp.mjs" || status=1
  rm -f "./.unit_$t.tmp.mjs"
done
# Browser tests: the "Same as mobile number" checkbox, and the scrolling of pop-ups / the page lock (need Playwright + Chromium, skipped when they are missing)
for ui in docs_navigation ui_whatsapp ui_scroll ui_head_departments ui_access_control ui_audit_location ui_client_logins ui_client_journey ui_accounts_finance ui_employee_hierarchy ocr_shop_photo ui_mobile_chat ui_hr_designations ui_field_visit ui_task_hierarchy ui_task_management ui_attendance ui_staff_forgot ui_bot_check ui_meetings ui_work_updates ui_lead_upload ui_lead_whatsapp ui_reminders ui_designstudio_roles ui_ai_website_onboarding ui_crocodial ui_crocodial_activity ui_crocodial_team ui_crocodial_refresh ui_meeting_presence ui_chat_extras ui_sales_role_dashboards ui_ai_studio_deadlines ui_session_persistence ui_income ui_client_meetings ui_bugs ui_payouts ui_sample_sheets ui_department_head_dashboard ui_shared_support_desk ui_unified_dashboard ui_notice_board ui_wallet ui_ceo_availability ui_notice_popup ui_unified_existing_departments ui_hr_awards ui_hr_shell ui_team_attendance ui_offer_letters ui_task_reports_performance ui_app_update ui_app_feedback ui_global_search ui_ai_studio_daily_report; do
  [ -f "supabase/tests/$ui.test.mjs" ] || continue
  echo "=== $ui"
  node "supabase/tests/$ui.test.mjs" || status=1
done
exit $status
