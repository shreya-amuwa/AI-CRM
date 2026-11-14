\set ON_ERROR_STOP 1
-- Customers row security: the set-based rules (migration 20270102000100_customers_rls_set_based.sql) show EXACTLY the customers the old per-row
-- rules showed, to every test user, and customer_pipeline_counts() equals the old per-customer count. Run after rls_test.sql (it uses its users).
--
-- The "old" side is rebuilt here from the original rules: the rewritten arms use the original per-row functions (sales_scope_team, lead_sees,
-- delivery_recipient, handover_recipient, can_access_customer), which are still in the database; the three arms that were not rewritten
-- (review, dh_handover, support) are read from the live policies, so a future change to those is followed, not frozen.
create or replace function pg_temp.old_visible(p_unchanged text) returns uuid[] language plpgsql security definer as $$
declare ids uuid[];
begin
  execute format($q$
    select coalesce(array_agg(c.id order by c.id), '{}') from public.customers c where
         ((private.my_role() = 'SUPER_ADMIN'::app_role)
          or (private.my_role() = 'DEPARTMENT_HEAD'::app_role and c.department_id = private.my_department_id() and private.sales_scope_team(c.team_id))
          or (private.my_role() = 'TEAM_HEAD'::app_role and private.lead_sees(c.team_id, c.owner_id))
          or (private.my_role() = 'TEAM_MEMBER'::app_role and c.owner_id = private.my_id()))
      or private.delivery_recipient(c.id)
      or (c.lifecycle_stage = any (array['ONBOARDING', 'CUSTOMER']) and private.handover_recipient(c.id))
      or %s $q$, p_unchanged) into ids;
  return ids;
end $$;

do $$
declare
  p text; unchanged text; v_new uuid[]; v_old uuid[]; n int := 0; with_rows int := 0;
  c_new jsonb; o_leads bigint; o_potential bigint; o_onboarding bigint;
begin
  -- the arms that were not rewritten, exactly as they are in the database now
  select string_agg('(' || pg_get_expr(pol.polqual, pol.polrelid) || ')', ' or ') into unchanged
    from pg_policy pol
   where pol.polrelid = 'public.customers'::regclass and pol.polcmd in ('r', '*')
     and pol.polname in ('customers_select_review', 'customers_select_dh_handover', 'customers_select_support');
  if unchanged is null then raise exception 'TEST FAILED: the unchanged customer policies were not found'; end if;

  for p in select name from test.users order by name loop
    perform set_config('request.jwt.claims', json_build_object('sub', test.id(p), 'role', 'authenticated')::text, false);
    execute 'set role authenticated';
    select coalesce(array_agg(id order by id), '{}') into v_new from public.customers;
    c_new := public.customer_pipeline_counts();
    execute 'reset role';
    v_old := pg_temp.old_visible(unchanged);
    if v_new is distinct from v_old then
      raise exception 'TEST FAILED: % sees % customers with the new rules but % with the old ones (missing: %, extra: %)', p, cardinality(v_new), cardinality(v_old),
        (select count(*) from unnest(v_old) x where x <> all (v_new)), (select count(*) from unnest(v_new) x where x <> all (v_old));
    end if;
    -- pipeline counts: the old function counted customers for which can_access_customer(id) was true
    select count(*) filter (where c.lifecycle_stage = 'LEAD' and c.payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION'),
           count(*) filter (where c.lifecycle_stage = 'POTENTIAL'),
           count(*) filter (where c.lifecycle_stage = 'ONBOARDING')
      into o_leads, o_potential, o_onboarding
      from public.customers c where c.lifecycle_stage in ('LEAD', 'POTENTIAL', 'ONBOARDING', 'CUSTOMER') and private.can_access_customer(c.id);
    if (c_new #>> '{leads,all}')::bigint <> o_leads or (c_new #>> '{potential,all}')::bigint <> o_potential or (c_new #>> '{onboarding,all}')::bigint <> o_onboarding then
      raise exception 'TEST FAILED: % pipeline counts differ (new % / % / %, old % / % / %)', p, c_new #>> '{leads,all}', c_new #>> '{potential,all}', c_new #>> '{onboarding,all}', o_leads, o_potential, o_onboarding;
    end if;
    n := n + 1;
    if cardinality(v_new) > 0 then with_rows := with_rows + 1; end if;
  end loop;
  if with_rows < 5 then raise exception 'TEST FAILED: only % test users can see any customer, the check would prove too little', with_rows; end if;
  raise notice 'ok - the set-based customer rules show exactly the same customers as the old per-row rules to all % test users (% of them see customers)', n, with_rows;
  raise notice 'ok - customer_pipeline_counts() equals the old per-customer count for all % test users', n;
end $$;
