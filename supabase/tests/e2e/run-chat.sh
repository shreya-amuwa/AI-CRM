#!/usr/bin/env bash
# Browser test of the chat (client chat, review, internal chat) against a throw-away local stack:
# Postgres database + PostgREST + the local gateway (auth, storage and a Realtime stand-in) + the web app.
# No Docker, no Supabase project, no production data. Passwords are made up on every run.
#
# Requires: superuser access via PGHOST/PGPORT/PGUSER, POSTGREST_BIN (a PostgREST v12 binary), npm install done, and a
# Chromium that Playwright can drive (set E2E_CHROMIUM to its path if Playwright has not downloaded one).
# Usage: PGHOST=... PGPORT=... PGUSER=postgres POSTGREST_BIN=... supabase/tests/e2e/run-chat.sh [screenshot-dir]
set -euo pipefail
cd "$(dirname "$0")/../../.."
OUT="${1:-$(mktemp -d)}"; mkdir -p "$OUT"
export PGDATABASE="${TEST_DB:-crm_e2e}"
export JWT_SECRET="local-test-secret-that-is-at-least-32-chars"
WORK="$(mktemp -d)"
trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$WORK"' EXIT

PSQL="psql -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists $PGDATABASE" -c "create database $PGDATABASE"
$PSQL -f supabase/tests/supabase_shim.sql 2>/dev/null
for f in supabase/migrations/*.sql; do $PSQL -f "$f" >/dev/null; done
$PSQL -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then
  create role authenticator login noinherit password 'authenticator'; end if; end \$\$;
  grant anon, authenticated, service_role to authenticator;"

jwt() { node -e "const c=require('node:crypto');const e=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const h=e({alg:'HS256',typ:'JWT'}),b=e({iat:1700000000,exp:2000000000,role:process.argv[1]});console.log(h+'.'+b+'.'+c.createHmac('sha256',process.env.JWT_SECRET).update(h+'.'+b).digest('base64url'))" "$1"; }
ANON="$(jwt anon)"; SERVICE="$(jwt service_role)"

cat > "$WORK/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:authenticator@/${PGDATABASE}?host=${PGHOST}&port=${PGPORT}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "${JWT_SECRET}"
server-port = 54401
CONF
"$POSTGREST_BIN" "$WORK/postgrest.conf" > "$WORK/postgrest.log" 2>&1 &
GATEWAY_PORT=54400 POSTGREST_URL=http://127.0.0.1:54401 node supabase/tests/local-gateway.mjs > "$WORK/gateway.log" 2>&1 &
# the limits are per IP and every browser here shares one: raise them for the test only
export RATE_LIMIT_IP_PER_MIN=5000 RATE_LIMIT_USER_PER_MIN=2000
SUPABASE_URL=http://localhost:54400 SUPABASE_ANON_KEY="$ANON" SUPABASE_SERVICE_ROLE_KEY="$SERVICE" \
  VITE_SUPABASE_URL=http://localhost:54400 VITE_SUPABASE_ANON_KEY="$ANON" npx vite --port 3000 > "$WORK/web.log" 2>&1 &
ready=0
for i in $(seq 1 120); do
  if curl -sf http://localhost:3000/ >/dev/null 2>&1 && curl -sf http://127.0.0.1:54401/ >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.5
done
[ "$ready" = 1 ] || { echo "the local stack did not start" >&2; tail -20 "$WORK"/*.log >&2; exit 1; }

# chat.e2e.mjs is the end-to-end encrypted mode (kept behind the Super Admin switch); chat-readable.e2e.mjs the default company-readable mode
SCRIPT="${CHAT_E2E:-chat.e2e.mjs}"
if [ "$SCRIPT" = "chat.e2e.mjs" ]; then $PSQL -c "update public.chat_settings set internal_mode = 'E2EE'"; fi
E2E_PASSWORDS="$(node supabase/tests/e2e/seed.mjs | tail -1)" SUPABASE_ANON_KEY="$ANON" \
  node "supabase/tests/e2e/$SCRIPT" "$OUT"
echo "screenshots: $OUT"
