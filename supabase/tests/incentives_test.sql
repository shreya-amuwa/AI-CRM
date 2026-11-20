-- =============================================================================
-- Sales incentives (migration 20270119000100): rules, the cascade Operations Head -> Department Head -> Team Lead -> Team Member with
-- each level keeping a share, the telecaller / Business Associate split, the earnings ledger (verified payments, demos, field visits),
-- the 15-day start, and the Income read functions. Uses the Wabastore Sales fixtures (sh_head = the Sales head, th_wab, tm_a, tc_a, ba_a) and the
-- department's Operations Head. Synthetic data only; safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 147. Sales incentives'
reset role;
\i supabase/migrations/20270119000100_sales_incentives.sql
\i supabase/migrations/20270119000100_sales_incentives.sql
grant execute on all functions in schema test to anon, authenticated, service_role;
select operations_head_id as oh from department_operations_owner where department_id = test.dept('wabastore') \gset
insert into test.users (name, id) values ('inc_oh', :'oh') on conflict (name) do update set id = excluded.id;
-- a clean slate for this suite
do $$ begin if to_regclass('public.earnings') is not null then
  delete from public.earnings where rule_id in (select id from public.incentive_rules where name like 'Test %'); end if; end $$;
delete from incentive_allocations where rule_id in (select id from incentive_rules where name like 'Test %');
delete from incentive_rules where name like 'Test %';
select code as svc from crm_services where is_active order by sort_order limit 1 \gset
-- everyone in this suite joined long ago (the 15-day start is tested on its own)
insert into employee_personal_details (profile_id, joining_date)
  select test.id(n), date '2026-01-01' from unnest(array['inc_oh','sh_head','th_wab','tm_a','tc_a','ba_a']) n
  on conflict (profile_id) do update set joining_date = excluded.joining_date;
create temp table inc (k text primary key, v text);
grant all on inc to authenticated;

\echo '   rules and the cascade'
set role authenticated;
select test.login('tm_a');
select test.must_fail(format($$select incentive_rule_create('{"name":"Test x","eventType":"SALE_PAID","serviceCode":"%s","amount":500,"scopeType":"OPERATIONS_HEAD","scopeValue":"%s"}')$$, :'svc', :'oh'),
  'a Team Member cannot create rules', 'FORBIDDEN');
select test.login('sa');
insert into inc select 'rule', incentive_rule_create(jsonb_build_object('name', 'Test 500 per unit', 'eventType', 'SALE_PAID', 'serviceCode', :'svc', 'amount', 500,
  'targetUnits', 1000, 'scopeType', 'OPERATIONS_HEAD', 'scopeValue', :'oh'))::text;
select test.check((select count(*) = 1 from inc where k = 'rule'), 'super admin creates a SALE_PAID rule of 500 for the OH');
select test.must_fail($$select incentive_rule_create('{"name":"Test bad","eventType":"SALE_PAID","amount":500,"scopeType":"OPERATIONS_HEAD"}')$$,
  'a sales rule needs a product and an Operations Head', 'VALIDATION_ERROR');
select test.login('inc_oh');
select test.check((select (d ->> 'ok')::boolean from (select incentive_allocation_set((select v from inc where k = 'rule')::uuid, test.id('sh_head'), 300) d) x), 'OH gives the DH 300');
select test.login('sh_head');
select incentive_allocation_set((select v from inc where k = 'rule')::uuid, test.id('th_wab'), 150);
select test.check(true, 'DH gives the TL 150');
select test.login('th_wab');
select test.must_fail(format($$select incentive_allocation_set(%L, test.id('tm_a'), 200)$$, (select v from inc where k = 'rule')),
  'TL giving the TM 200 (more than the TL holds) is refused', 'VALIDATION_ERROR');
select incentive_allocation_set((select v from inc where k = 'rule')::uuid, test.id('tm_a'), 100);
select test.check((select (r ->> 'myAmount')::numeric = 150 and (r ->> 'kept')::numeric = 50
                     and exists (select 1 from jsonb_array_elements(r -> 'given') g where g ->> 'recipientId' = test.id('tm_a')::text and (g ->> 'amount')::numeric = 100)
                     from jsonb_array_elements(incentive_setup() -> 'rules') r where r ->> 'id' = (select v from inc where k = 'rule')),
  'incentive_setup shows the TL holds 150, gave 100, keeps 50');
select test.login('dh_wbx');
select test.must_fail(format($$select incentive_allocation_set(%L, test.id('th_wab'), 100)$$, (select v from inc where k = 'rule')),
  'a DH of another department cannot set this TL', 'FORBIDDEN');
select test.login('tm_a');
select test.must_fail(format($$select incentive_allocation_set(%L, test.id('tc_a'), 10)$$, (select v from inc where k = 'rule')),
  'a Team Member cannot give anyone an amount', 'FORBIDDEN');
select test.login('sh_head');
select test.check((select (incentive_split_set(test.dept('wabastore'), 60) ->> 'telecallerPct')::int = 60), 'DH sets the telecaller split to 60');
select test.must_fail($$select incentive_split_set(test.dept('wabastore'), 120)$$, 'a split over 100% is refused', 'VALIDATION_ERROR');
select test.login('dh_wbx');
select test.must_fail($$select incentive_split_set(test.dept('wabastore'), 10)$$, 'another department''s head cannot set the split', 'FORBIDDEN');
select test.login('sa');
select test.check((select (incentive_settings_set(20) ->> 'startAfterDays')::int = 20), 'the Super Admin changes the start to 20 days');
select incentive_settings_set(15);
insert into inc select 'ended', incentive_rule_create(jsonb_build_object('name', 'Test ended', 'eventType', 'SALE_PAID', 'serviceCode', :'svc', 'amount', 100,
  'scopeType', 'OPERATIONS_HEAD', 'scopeValue', :'oh'))::text;
select incentive_rule_end((select v from inc where k = 'ended')::uuid);
select test.login('inc_oh');
select test.must_fail(format($$select incentive_allocation_set(%L, test.id('sh_head'), 50)$$, (select v from inc where k = 'ended')),
  'ending a rule keeps it but it no longer accepts allocations', 'CONFLICT');
reset role;
select test.check((select count(*) >= 1 from audit_logs where action = 'INCENTIVE_RULE_CREATED') and (select count(*) >= 3 from audit_logs where action = 'INCENTIVE_ALLOCATION_SET')
                  and (select count(*) >= 1 from audit_logs where action = 'INCENTIVE_SPLIT_SET'), 'every setup change is on the audit trail');
