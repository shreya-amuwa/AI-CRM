#!/usr/bin/env bash
# Times the API's hot customer queries under row security for several test users (run scripts/perf/seed-customers.sql first).
# usage: scripts/perf/bench-customers.sh <scratch db>   (PGHOST / PGPORT / PGUSER as for psql)
DB=${1:-perf}
run() { # persona, label, sql
  psql -d $DB -At <<SQL 2>&1 | grep -E "Execution Time|Seq Scan|ERROR" | tr '\n' ' ' | sed "s/^/$(printf '%-9s %-34s' "$1" "$2") /"
select set_config('request.jwt.claims', json_build_object('sub', test.id('$1'), 'role','authenticated')::text, false);
set role authenticated;
explain (analyze, timing off) $3;
SQL
  echo
}
for p in sa dh_wab tm_a tc_dash; do
  run $p "leads count (exact)"      "select count(*) from public.customers where lifecycle_stage='LEAD'"
  run $p "leads page 1 of 25"       "select id,name,email,lifecycle_stage,updated_at from public.customers where lifecycle_stage='LEAD' order by updated_at desc nulls last, id limit 25"
  run $p "search ilike"             "select id,name from public.customers where search_text ilike '%load customer 77%' order by updated_at desc, id limit 25"
  run $p "customer_pipeline_counts" "select public.customer_pipeline_counts()"
  run $p "customer_summary"         "select public.customer_summary()"
done
