#!/usr/bin/env bash
# End-to-end API test against PostgreSQL + PostgREST (no Docker needed).
# Requires: superuser access via PGHOST/PGPORT/PGUSER, and POSTGREST_BIN
# pointing at a PostgREST v12 binary (GW_PORT / PGRST_PORT fix the two local ports; by default two free ones are chosen). Usage:
#   PGHOST=... PGPORT=... PGUSER=postgres POSTGREST_BIN=/path/postgrest supabase/tests/run-api.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGDATABASE="${TEST_DB:-crm_api_test}"
export JWT_SECRET="local-test-secret-that-is-at-least-32-chars"
WORK="$(mktemp -d)"
trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$WORK"' EXIT

# The two local ports. Unless GW_PORT / PGRST_PORT are given, ask the system for two free ones: a fixed port (54400 / 54401) lies in the
# range the system hands out to outgoing connections (32768-60999), and with the database on TCP (CI) one of the many psql / PostgREST
# connections can hold it, so the gateway failed with EADDRINUSE now and then.
free_port() { node -e "const s=require('net').createServer();s.listen(0,()=>{process.stdout.write(String(s.address().port));s.close()})"; }
GW_PORT=${GW_PORT:-$(free_port)}
PGRST_PORT=${PGRST_PORT:-$(free_port)}
while [ "$PGRST_PORT" = "$GW_PORT" ]; do PGRST_PORT=$(free_port); done

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
server-port = ${PGRST_PORT}
CONF
"$POSTGREST_BIN" "$WORK/postgrest.conf" > "$WORK/postgrest.log" 2>&1 &
PGRST_PID=$!
GATEWAY_PORT=${GW_PORT} POSTGREST_URL=http://127.0.0.1:${PGRST_PORT} node supabase/tests/local-gateway.mjs > "$WORK/gateway.log" 2>&1 &
GW_PID=$!
# wait until BOTH PostgREST (schema loaded) and the gateway answer; the first test must not race the startup (up to 180 s: a loaded CI runner can take longer than 60 s to load the schema)
ready=0
for i in $(seq 1 900); do
  if curl -sf -m 2 http://127.0.0.1:${PGRST_PORT}/ >/dev/null 2>&1 && curl -s -m 2 -o /dev/null http://127.0.0.1:${GW_PORT}/ 2>/dev/null; then ready=1; break; fi
  # a server that already stopped (e.g. its port was taken) will not come up: say so now instead of waiting 180 s
  running=" $(jobs -rp | tr '\n' ' ') "
  case "$running" in *" $PGRST_PID "*) ;; *) break ;; esac
  case "$running" in *" $GW_PID "*) ;; *) break ;; esac
  sleep 0.2
done
[ "$ready" = 1 ] || { echo "PostgREST / the gateway did not start" >&2; tail -n 20 "$WORK/postgrest.log" "$WORK/gateway.log" >&2; exit 1; }

npx esbuild supabase/tests/api_integration.test.ts --bundle --platform=node --format=esm \
  --packages=external --outfile="$WORK/api_test.mjs" --log-level=warning
cp "$WORK/api_test.mjs" ./.api_test.tmp.mjs
GATEWAY_URL=http://127.0.0.1:${GW_PORT} node ./.api_test.tmp.mjs || { rm -f ./.api_test.tmp.mjs; cat "$WORK/postgrest.log" | tail -5; exit 1; }
rm -f ./.api_test.tmp.mjs
