#!/usr/bin/env bash
# The Cloudflare Worker end to end, in the real Workers runtime (wrangler dev / workerd), against PostgreSQL + PostgREST:
# static files, the API, the lead webhook, /api/proxy, e-mail through Resend (a local mock), the cron, and the Node.js-dependent
# server code compared byte for byte with Node.js. Same requirements as run-api.sh (PGHOST/PGPORT/PGUSER, POSTGREST_BIN). Usage:
#   PGHOST=... PGPORT=... PGUSER=postgres POSTGREST_BIN=/path/postgrest supabase/tests/run-worker.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGDATABASE="${TEST_DB:-crm_worker_test}"
export JWT_SECRET="local-test-secret-that-is-at-least-32-chars"
WORK="$(mktemp -d)"
trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$WORK" ./.worker_test.tmp.mjs' EXIT

free_port() { node -e "const s=require('net').createServer();s.listen(0,()=>{process.stdout.write(String(s.address().port));s.close()})"; }
GW_PORT=$(free_port)
PGRST_PORT=$(free_port)
while [ "$PGRST_PORT" = "$GW_PORT" ]; do PGRST_PORT=$(free_port); done

# the Worker serves dist/: build it (an old build would test old files). SKIP_BUILD=1 reuses the current dist/.
if [ "${SKIP_BUILD:-}" != 1 ] || [ ! -f dist/index.html ]; then
  npm run build > "$WORK/build.log" 2>&1 || { tail -n 40 "$WORK/build.log" >&2; exit 1; }
fi

export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
PSQL="psql -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists $PGDATABASE" -c "create database $PGDATABASE"
$PSQL -f supabase/tests/supabase_shim.sql 2>/dev/null
for f in supabase/migrations/*.sql; do $PSQL -f "$f" >/dev/null; done
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
GATEWAY_PORT=${GW_PORT} POSTGREST_URL=http://127.0.0.1:${PGRST_PORT} node supabase/tests/local-gateway.mjs > "$WORK/gateway.log" 2>&1 &
ready=0
for i in $(seq 1 900); do
  if curl -sf -m 2 http://127.0.0.1:${PGRST_PORT}/ >/dev/null 2>&1 && curl -s -m 2 -o /dev/null http://127.0.0.1:${GW_PORT}/ 2>/dev/null; then ready=1; break; fi
  sleep 0.2
done
[ "$ready" = 1 ] || { echo "PostgREST / the gateway did not start" >&2; tail -n 20 "$WORK/postgrest.log" "$WORK/gateway.log" >&2; exit 1; }

npx esbuild supabase/tests/worker_e2e.test.ts --bundle --platform=node --format=esm \
  --packages=external --outfile="$WORK/worker_test.mjs" --log-level=warning
cp "$WORK/worker_test.mjs" ./.worker_test.tmp.mjs
GATEWAY_URL=http://127.0.0.1:${GW_PORT} WORK_DIR="$WORK" node ./.worker_test.tmp.mjs
