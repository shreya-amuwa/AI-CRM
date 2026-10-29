#!/usr/bin/env bash
# Unit tests that need no database: invoice arithmetic, the PDF generator, the invoice delivery steps and the WhatsApp checkbox.
# Usage: npm run test:unit
set -euo pipefail
cd "$(dirname "$0")/../.."
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
status=0
for t in api_client_cache realtime_shared invoice_calc invoice_pdf invoice_delivery journey_service security hr_email_templates performance_narrative telecaller_sheet ba_pdf sales_lead_sheet import_template bolify active_scope head_assignment shop_text subscription_messages onboarding_status_map invoice_whatsapp client_network; do
  f="supabase/tests/$t.test.ts"
  [ -f "$f" ] || continue
  echo "=== $t"
  # the browser API client reads Vite's import.meta.env (empty in Node)
  extra=(); { [ "$t" = api_client_cache ] || [ "$t" = realtime_shared ]; } && extra=(--define:import.meta.env={})
  npx esbuild "$f" --bundle --platform=node --format=esm --packages=external --outfile="$WORK/$t.mjs" --log-level=warning "${extra[@]}"
  # run from the repo root so package imports resolve; the bundle itself lives in a temp directory
  cp "$WORK/$t.mjs" "./.unit_$t.tmp.mjs"
  node "./.unit_$t.tmp.mjs" || status=1
  rm -f "./.unit_$t.tmp.mjs"
done
# Browser tests: the "Same as mobile number" checkbox, and the scrolling of pop-ups / the page lock (need Playwright + Chromium, skipped when they are missing)
for ui in docs_navigation ui_whatsapp ui_scroll ui_head_departments ui_access_control ui_audit_location ui_client_journey ocr_shop_photo; do
  [ -f "supabase/tests/$ui.test.mjs" ] || continue
  echo "=== $ui"
  node "supabase/tests/$ui.test.mjs" || status=1
done
exit $status
