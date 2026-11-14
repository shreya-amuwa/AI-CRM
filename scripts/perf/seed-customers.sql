-- Load test data for the customer queries: about 100,000 extra customers copied from the test organization (run AFTER supabase/tests/rls_test.sql
-- has created it). For a scratch database only. See docs/PERFORMANCE_AUDIT.md. Usage: psql -d <scratch db> -f scripts/perf/seed-customers.sql
set session_replication_role = replica;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ',' order by ordinal_position) into cols
    from information_schema.columns where table_schema = 'public' and table_name = 'customers' and is_generated = 'NEVER';
  execute format($f$
    insert into public.customers (%1$s)
    select %1$s from jsonb_populate_recordset(null::public.customers, (
      select jsonb_agg(to_jsonb(t) || jsonb_build_object(
        'id', gen_random_uuid(), 'customer_code', 'LD-' || g || '-' || substr(t.id::text, 1, 4), 'email', 'ld' || g || '-' || substr(t.id::text, 1, 4) || '@load.test',
        'name', 'Load Customer ' || g, 'source_lead_id', null, 'source_sheet_id', null,
        'created_at', now() - ((g * 7) %% 700 || ' days')::interval, 'updated_at', now() - ((g * 3) %% 400 || ' days')::interval))
      from (select * from public.customers where customer_code not like 'LD-%%') t, generate_series(1, 4600) g))
  $f$, cols);
end $$;
analyze public.customers;
