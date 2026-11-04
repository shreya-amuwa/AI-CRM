#!/usr/bin/env bash
# Browser test of the company-readable internal chat (migration 20261224000200): two browsers that never had a key chat at once.
# Same local stack as run-chat.sh. Usage: PGHOST=... PGPORT=... PGUSER=postgres POSTGREST_BIN=... supabase/tests/e2e/run-chat-readable.sh [screenshot-dir]
set -euo pipefail
cd "$(dirname "$0")/../../.."
CHAT_E2E=chat-readable.e2e.mjs exec supabase/tests/e2e/run-chat.sh "$@"
