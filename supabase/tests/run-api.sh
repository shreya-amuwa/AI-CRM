#!/usr/bin/env bash
# End-to-end API test against PostgreSQL + PostgREST (no Docker needed).
# Requires: superuser access via PGHOST/PGPORT/PGUSER, and POSTGREST_BIN
# pointing at a PostgREST v12 binary. Usage:
#   PGHOST=... PGPORT=... PGUSER=postgres POSTGREST_BIN=/path/postgrest supabase/tests/run-api.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGDATABASE="${TEST_DB:-crm_api_test}"
export JWT_SECRET="local-test-secret-that-is-at-least-32-chars"
WORK="$(mktemp -d)"
trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$WORK"' EXIT

PSQL="psql -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists $PGDATABASE" -c "create database $PGDATABASE"
$PSQL -f supabase/tests/supabase_shim.sql 2>/dev/null
for f in supabase/migrations/*.sql; do $PSQL -f "$f"; done
$PSQL -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then
  create role authenticator login noinherit password 'authenticator'; end if; end \$\$;
  grant anon, authenticated, service_role to authenticator;"

cat > "$WORK/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:authenticator@/${PGDATABASE}?host=${PGHOST}&port=${PGPORT}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "${JWT_SECRET}"
server-port = 54401
CONF
"$POSTGREST_BIN" "$WORK/postgrest.conf" > "$WORK/postgrest.log" 2>&1 &
GATEWAY_PORT=54400 POSTGREST_URL=http://127.0.0.1:54401 node supabase/tests/local-gateway.mjs > "$WORK/gateway.log" 2>&1 &
for i in $(seq 1 50); do curl -sf http://127.0.0.1:54401/ >/dev/null 2>&1 && break; sleep 0.2; done

npx esbuild supabase/tests/api_integration.test.ts --bundle --platform=node --format=esm \
  --packages=external --outfile="$WORK/api_test.mjs" --log-level=warning
cp "$WORK/api_test.mjs" ./.api_test.tmp.mjs
GATEWAY_URL=http://127.0.0.1:54400 node ./.api_test.tmp.mjs || { rm -f ./.api_test.tmp.mjs; cat "$WORK/postgrest.log" | tail -5; exit 1; }
rm -f ./.api_test.tmp.mjs
