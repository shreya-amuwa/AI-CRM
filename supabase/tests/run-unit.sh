#!/usr/bin/env bash
# Unit tests that need no database: invoice arithmetic, the PDF generator, the invoice delivery steps and the WhatsApp checkbox.
# Usage: npm run test:unit
set -euo pipefail
cd "$(dirname "$0")/../.."
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
status=0
for t in invoice_calc invoice_pdf invoice_delivery journey_service security hr_email_templates; do
  f="supabase/tests/$t.test.ts"
  [ -f "$f" ] || continue
  echo "=== $t"
  npx esbuild "$f" --bundle --platform=node --format=esm --packages=external --outfile="$WORK/$t.mjs" --log-level=warning
  # run from the repo root so package imports resolve; the bundle itself lives in a temp directory
  cp "$WORK/$t.mjs" "./.unit_$t.tmp.mjs"
  node "./.unit_$t.tmp.mjs" || status=1
  rm -f "./.unit_$t.tmp.mjs"
done
# Browser test of the "Same as mobile number" checkbox (needs Playwright + Chromium, skipped when they are missing)
if [ -f supabase/tests/ui_whatsapp.test.mjs ]; then
  echo "=== ui_whatsapp"
  node supabase/tests/ui_whatsapp.test.mjs || status=1
fi
exit $status
