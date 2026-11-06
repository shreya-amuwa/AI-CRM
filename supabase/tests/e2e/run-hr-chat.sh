#!/usr/bin/env bash
# Browser test of HR in the company chat: an HR Recruiter and a Team Member signed in at once write to each other live (Realtime stand-in),
# the HR Assistant has Chat too and does not see their conversation; against a throw-away local stack (see run-dashboards.sh).
# Postgres database + PostgREST + the local gateway (auth, storage and a Realtime stand-in) + the web app.
# No Docker, no Supabase project, no production data. Passwords are made up on every run.
#
# Requires: superuser access via PGHOST/PGPORT/PGUSER, POSTGREST_BIN (a PostgREST v12 binary), npm install done, and a
# Chromium that Playwright can drive (set E2E_CHROMIUM to its path if Playwright has not downloaded one).
# Usage: PGHOST=... PGPORT=... PGUSER=postgres POSTGREST_BIN=... supabase/tests/e2e/run-hr-chat.sh [screenshot-dir]
set -euo pipefail
cd "$(dirname "$0")/../../.."
OUT="${1:-$(mktemp -d)}"; mkdir -p "$OUT"
export PGDATABASE="${TEST_DB:-crm_e2e_hr_chat}"
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
SA_PASSWORD="$(node -e "console.log(require('node:crypto').randomBytes(9).toString('base64url')+'-Aa1')")"

cat > "$WORK/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:authenticator@/${PGDATABASE}?host=${PGHOST}&port=${PGPORT}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "${JWT_SECRET}"
server-port = 54481
CONF
"$POSTGREST_BIN" "$WORK/postgrest.conf" > "$WORK/postgrest.log" 2>&1 &
SEED_PASSWORDS="root@amuwa.com=$SA_PASSWORD" GATEWAY_PORT=54480 POSTGREST_URL=http://127.0.0.1:54481 node supabase/tests/local-gateway.mjs > "$WORK/gateway.log" 2>&1 &
# the limits are per IP and every browser here shares one: raise them for the test only
export RATE_LIMIT_IP_PER_MIN=5000 RATE_LIMIT_USER_PER_MIN=2000 RATE_LIMIT_SENSITIVE_PER_MIN=1000
SUPABASE_URL=http://localhost:54480 SUPABASE_ANON_KEY="$ANON" SUPABASE_SERVICE_ROLE_KEY="$SERVICE" \
  VITE_SUPABASE_URL=http://localhost:54480 VITE_SUPABASE_ANON_KEY="$ANON" npx vite --port 3071 > "$WORK/web.log" 2>&1 &
ready=0
for i in $(seq 1 120); do
  if curl -sf http://localhost:3071/ >/dev/null 2>&1 && curl -sf http://127.0.0.1:54481/ >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.5
done
[ "$ready" = 1 ] || { echo "the local stack did not start" >&2; tail -20 "$WORK"/*.log >&2; exit 1; }

SEEDED="$(E2E_BASE=http://localhost:3071 node supabase/tests/e2e/seed.mjs | tail -1)"
E2E_BASE=http://localhost:3071 E2E_GATEWAY=http://localhost:54480 E2E_PASSWORDS="$(node -e "const p=JSON.parse(process.argv[1]);p['root@amuwa.com']=process.argv[2];console.log(JSON.stringify(p))" "$SEEDED" "$SA_PASSWORD")" SUPABASE_ANON_KEY="$ANON" \
  node supabase/tests/e2e/hr-chat.e2e.mjs "$OUT"
echo "screenshots: $OUT"
