#!/usr/bin/env bash
# Unit tests that need no database: invoice arithmetic, the PDF generator, the invoice delivery steps and the WhatsApp checkbox.
# Usage: npm run test:unit
set -euo pipefail
cd "$(dirname "$0")/../.."
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
status=0
for t in invoice_calc invoice_pdf invoice_delivery journey_service security hr_email_templates performance_narrative workflow_layout telecaller_sheet ba_pdf import_template bolify; do
  f="supabase/tests/$t.test.ts"
  [ -f "$f" ] || continue
  echo "=== $t"
  npx esbuild "$f" --bundle --platform=node --format=esm --packages=external --outfile="$WORK/$t.mjs" --log-level=warning
  # run from the repo root so package imports resolve; the bundle itself lives in a temp directory
  cp "$WORK/$t.mjs" "./.unit_$t.tmp.mjs"
  node "./.unit_$t.tmp.mjs" || status=1
  rm -f "./.unit_$t.tmp.mjs"
done
# Browser tests: the "Same as mobile number" checkbox, and the scrolling of pop-ups / the page lock (need Playwright + Chromium, skipped when they are missing)
for ui in ui_whatsapp ui_scroll; do
  [ -f "supabase/tests/$ui.test.mjs" ] || continue
  echo "=== $ui"
  node "supabase/tests/$ui.test.mjs" || status=1
done
exit $status
