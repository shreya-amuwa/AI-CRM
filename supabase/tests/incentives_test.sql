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
select code as svc2 from crm_services where is_active order by sort_order offset 1 limit 1 \gset
-- everyone in this suite joined long ago (the 15-day start is tested on its own)
insert into employee_personal_details (profile_id, joining_date)
  select test.id(n), date '2026-01-01' from unnest(array['inc_oh','sh_head','th_wab','tm_a','tc_a','ba_a']) n
  on conflict (profile_id) do update set joining_date = excluded.joining_date;
-- fixture states a previous, aborted run may have left changed
update profiles set status = 'ACTIVE' where id in (test.id('th_wab'), test.id('tm_a')) or (team_id = test.team('wabastore', 'Sales') and role = 'TEAM_HEAD' and status = 'SUSPENDED');
update profiles set head_division = 'SALES' where id = test.id('sh_head');
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
insert into inc select 'ended', incentive_rule_create(jsonb_build_object('name', 'Test ended', 'eventType', 'SALE_PAID', 'serviceCode', :'svc2', 'amount', 100,
  'scopeType', 'OPERATIONS_HEAD', 'scopeValue', :'oh'))::text;
select incentive_rule_end((select v from inc where k = 'ended')::uuid);
select test.login('inc_oh');
select test.must_fail(format($$select incentive_allocation_set(%L, test.id('sh_head'), 50)$$, (select v from inc where k = 'ended')),
  'ending a rule keeps it but it no longer accepts allocations', 'CONFLICT');
reset role;
select test.check((select count(*) >= 1 from audit_logs where action = 'INCENTIVE_RULE_CREATED') and (select count(*) >= 3 from audit_logs where action = 'INCENTIVE_ALLOCATION_SET')
                  and (select count(*) >= 1 from audit_logs where action = 'INCENTIVE_SPLIT_SET'), 'every setup change is on the audit trail');

\echo '   earnings from verified payments: proportional, the cascade, the split, reversals, the 15-day start'
reset role;
-- the Business Associate also gets 100 from the Team Lead
set role authenticated;
select test.login('th_wab');
select incentive_allocation_set((select v from inc where k = 'rule')::uuid, test.id('ba_a'), 100);
reset role;
delete from earnings where customer_id in (select id from customers where name like 'Inc Test %');
delete from customer_payments where customer_id in (select id from customers where name like 'Inc Test %');
delete from customers where name like 'Inc Test %';
create or replace function test.inc_customer(p_name text, p_owner text, p_amount numeric, p_service text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.customers (owner_id, name, phone, lifecycle_stage, department_id, team_id, agreed_amount)
  values (test.id(p_owner), p_name, '98' || lpad((floor(random() * 100000000))::text, 8, '0'), 'CUSTOMER', test.dept('wabastore'), test.team('wabastore', 'Sales'), p_amount)
  returning id into v;
  if p_service is not null then insert into public.customer_services (customer_id, service_code) values (v, p_service); end if;
  return v;
end $$;
create or replace function test.inc_pay(p_customer uuid, p_amount numeric) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.customer_payments (customer_id, payment_type, amount, method, reference, status, source)
  values (p_customer, 'PART', p_amount, 'UPI', 'INC-' || gen_random_uuid(), 'PENDING', 'ACCOUNTS') returning id into v;
  update public.customer_payments set status = 'VERIFIED' where id = v;
  return v;
end $$;
create or replace function test.earned(p_who text, p_customer uuid, p_role text default null) returns numeric language sql as $$
  select coalesce(sum(amount), 0) from public.earnings where profile_id = test.id(p_who) and customer_id = p_customer and status = 'EARNED'
     and (p_role is null or role = p_role) $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

select test.inc_customer('Inc Test One', 'tm_a', 2000, :'svc') as c1 \gset
select test.inc_pay(:'c1', 1000) as p1 \gset
select test.check(test.earned('tm_a', :'c1') = 50 and test.earned('th_wab', :'c1') = 25 and test.earned('sh_head', :'c1') = 75 and test.earned('inc_oh', :'c1') = 100,
  'the first 1000 of a 2000 order: TM 50, TL 25, DH 75, OH 100');
select test.inc_pay(:'c1', 1000) as p2 \gset
select test.check(test.earned('tm_a', :'c1') = 100 and test.earned('th_wab', :'c1') = 50 and test.earned('sh_head', :'c1') = 150 and test.earned('inc_oh', :'c1') = 200,
  'a 2000 order paid 1000 then 1000: TM 50+50, TL 25+25, DH 75+75, OH 100+100');
update customer_payments set status = 'PENDING' where id = :'p1';
update customer_payments set status = 'VERIFIED' where id = :'p1';
select test.check(test.earned('tm_a', :'c1') = 100, 'the same payment verified again pays nothing more');
update customer_payments set status = 'REVERSED' where id = :'p1';
select test.check(test.earned('tm_a', :'c1') = 50 and (select count(*) = 4 from earnings where event_ref = 'PAY:' || :'p1' and status = 'REVERSED'),
  'reversing the first payment reverses its rows only');
update customer_payments set status = 'VERIFIED' where id = :'p1';
select test.check(test.earned('tm_a', :'c1') = 100 and (select count(*) = 4 from earnings where event_ref = 'PAY:' || :'p1' and status = 'EARNED'),
  're-verifying after the reversal pays once');

select test.inc_customer('Inc Test Owner', 'tm_a', 2000, :'svc') as c2 \gset
select test.inc_pay(:'c2', 1000);
update customers set owner_id = test.id('ba_a') where id = :'c2';
select test.inc_pay(:'c2', 1000);
select test.check(test.earned('tm_a', :'c2') = 50 and test.earned('ba_a', :'c2') = 50, 'owner changed before the second payment: the new owner is paid for it');

select test.inc_customer('Inc Test Lead', 'th_wab', 2000, :'svc') as c3 \gset
select test.inc_pay(:'c3', 2000);
select test.check(test.earned('th_wab', :'c3') = 150 and test.earned('sh_head', :'c3') = 150 and test.earned('inc_oh', :'c3') = 200 and test.earned('tm_a', :'c3') = 0,
  'a Team Lead who closes a sale gets all they hold (150), DH 150, OH 200; nobody below is invented');

select test.inc_customer('Inc Test Split', 'ba_a', 2000, :'svc') as c4 \gset
insert into ba_contacts (lead_id, department_id, team_id, telecaller_id, assigned_to) values (:'c4', test.dept('wabastore'), test.team('wabastore', 'Sales'), test.id('tc_a'), test.id('ba_a'));
select test.inc_pay(:'c4', 2000);
select test.check(test.earned('tc_a', :'c4', 'TELECALLER') = 60 and test.earned('ba_a', :'c4', 'BUSINESS_ASSOCIATE') = 40 and test.earned('th_wab', :'c4') = 50,
  'telecaller lead closed by the BA with split 60: telecaller 60%, BA 40% of the closer''s part');

update employee_personal_details set joining_date = private.office_today() - 14 where profile_id = test.id('tm_a');
select test.inc_customer('Inc Test New', 'tm_a', 2000, :'svc') as c5 \gset
select test.inc_pay(:'c5', 2000);
select test.check(test.earned('tm_a', :'c5') = 0 and test.earned('th_wab', :'c5') = 50, 'a closer on day 14 gets nothing, their chain is still paid');
update employee_personal_details set joining_date = private.office_today() - 16 where profile_id = test.id('tm_a');
select test.inc_customer('Inc Test New2', 'tm_a', 2000, :'svc') as c6 \gset
select test.inc_pay(:'c6', 2000);
select test.check(test.earned('tm_a', :'c6') = 100, 'on day 16 they are paid');
update employee_personal_details set joining_date = date '2026-01-01' where profile_id = test.id('tm_a');

select test.inc_customer('Inc Test NoAmount', 'tm_a', null, :'svc') as c7 \gset
select test.inc_pay(:'c7', 500);
select test.check((select count(*) = 0 from earnings where customer_id = :'c7'), 'no order amount: nothing');
select test.inc_customer('Inc Test Over', 'tm_a', 2000, :'svc') as c8 \gset
select test.inc_pay(:'c8', 3000);
select test.inc_pay(:'c8', 500);
select test.check(test.earned('tm_a', :'c8') = 100 and test.earned('inc_oh', :'c8') = 200, 'a payment bigger than the order releases at most 100%');
select test.inc_customer('Inc Test Other', 'tm_a', 2000, null) as c9 \gset
select test.inc_pay(:'c9', 2000);
select test.check((select count(*) = 0 from earnings where customer_id = :'c9'), 'a product without a sales incentive earns nothing');
select test.check(not exists (select 1 from audit_logs a join customer_payments p on p.id = a.entity_id join customers c on c.id = p.customer_id
                               where a.action = 'INCENTIVE_ERROR' and c.name like 'Inc Test %'), 'no incentive calculation failed (errors are logged, never hidden)');

\echo '   demos completed with the authorised person, field visits with GPS'
reset role;
delete from earnings where rule_id in (select id from incentive_rules where name like 'Test %' and event_type <> 'SALE_PAID');
set role authenticated;
select test.login('sa');
insert into inc select 'demo', incentive_rule_create(jsonb_build_object('name', 'Test demo 50', 'eventType', 'DEMO_COMPLETED', 'amount', 50,
  'scopeType', 'SUB_ROLE', 'scopeValue', 'TELECALLER', 'monthlyCap', 100))::text;
insert into inc select 'visit', incentive_rule_create(jsonb_build_object('name', 'Test visit 30', 'eventType', 'VISIT_COMPLETED', 'amount', 30,
  'scopeType', 'LEVEL', 'scopeValue', 'TEAM_MEMBER'))::text;
reset role;
create or replace function test.inc_demo(p_status text) returns uuid language sql as $$
  insert into public.ba_demos (contact_id, title, starts_at, ends_at, mode, assigned_to, status)
  values ((select id from public.ba_contacts where lead_id = (select id from public.customers where name = 'Inc Test Split')), 'Inc Test demo',
          now() - interval '2 hours', now() - interval '1 hour', 'ONLINE', test.id('ba_a'), p_status) returning id $$;
create or replace function test.demo_earned() returns numeric language sql as $$
  select coalesce(sum(amount), 0) from public.earnings where profile_id = test.id('tc_a') and event_type = 'DEMO_COMPLETED' and status = 'EARNED' $$;
grant execute on all functions in schema test to anon, authenticated, service_role;
select test.inc_demo('SCHEDULED') as d1 \gset
update ba_demos set status = 'COMPLETED' where id = :'d1';
select test.check(test.demo_earned() = 0, 'a completed demo without the tick pays nothing');
set role authenticated;
select test.login('ba_a');
select ba_demo_set_authorised(:'d1', true);
reset role;
select test.check(test.demo_earned() = 50 and (select role = 'PARTICIPANT' from earnings where event_ref = 'DEMO:' || :'d1'),
  'ticking it pays the telecaller 50 (rule scoped to SUB_ROLE TELECALLER); the BA, not a telecaller, gets nothing');
set role authenticated;
select test.login('ba_a');
select ba_demo_set_authorised(:'d1', false);
reset role;
select test.check(test.demo_earned() = 0, 'unticking reverses');
set role authenticated;
select test.login('ba_a');
select ba_demo_set_authorised(:'d1', true);
select test.login('tm_a');
select test.must_fail(format($$select ba_demo_set_authorised(%L, false)$$, :'d1'), 'someone else''s demo cannot be ticked', 'FORBIDDEN');
reset role;
select test.inc_demo('SCHEDULED') as d2 \gset
update ba_demos set status = 'CANCELLED', authorised_person_attended = true where id = :'d2';
select test.check(test.demo_earned() = 50, 'a cancelled demo pays nothing');
select test.inc_demo('SCHEDULED') as d3 \gset
update ba_demos set authorised_person_attended = true, status = 'COMPLETED' where id = :'d3';
select test.inc_demo('SCHEDULED') as d4 \gset
update ba_demos set authorised_person_attended = true, status = 'COMPLETED' where id = :'d4';
select test.check(test.demo_earned() = 100, 'the monthly cap (100) stops payment once reached');
update ba_demos set status = 'RESCHEDULED' where id = :'d3';
select test.check(test.demo_earned() = 50, 'a demo that is no longer completed is reversed');

insert into lead_visits (lead_id, employee_id, visit_date, purpose, status)
  values ((select id from customers where name = 'Inc Test One'), test.id('tm_a'), private.office_today(), 'Inc Test visit', 'SCHEDULED') returning id as v1 \gset
update lead_visits set status = 'COMPLETED', completed_at = now(), gps_captured = true where id = :'v1';
select test.check((select coalesce(sum(amount), 0) = 30 from earnings where event_ref = 'VISIT:' || :'v1' and profile_id = test.id('tm_a') and status = 'EARNED'),
  'a completed visit with GPS pays the employee');
insert into lead_visits (lead_id, employee_id, visit_date, purpose, status)
  values ((select id from customers where name = 'Inc Test One'), test.id('tm_a'), private.office_today(), 'Inc Test visit', 'SCHEDULED') returning id as v2 \gset
update lead_visits set status = 'COMPLETED', completed_at = now(), gps_captured = false where id = :'v2';
select test.check((select count(*) = 0 from earnings where event_ref = 'VISIT:' || :'v2'), 'without GPS it does not');
delete from lead_visits where purpose = 'Inc Test visit';

\echo '   the Income page'
reset role;
select coalesce(sum(amount), 0) as th_total from earnings where profile_id = test.id('th_wab') and status = 'EARNED' \gset
select coalesce(sum(amount), 0) as tc_total from earnings where profile_id = test.id('tc_a') and status = 'EARNED' \gset
set role authenticated;
select test.login('th_wab');
select test.check((select (d ->> 'eligible')::boolean and (d ->> 'total')::numeric = :'th_total'::numeric
                          and (d ->> 'today')::numeric = (d ->> 'total')::numeric and (d ->> 'balance')::numeric = (d ->> 'total')::numeric
                     from (select income_summary() d) x), 'the Team Lead''s summary: today, total and balance from their own earned rows');
select test.check((select exists (select 1 from jsonb_array_elements(income_summary() -> 'targets') t
                                   where t ->> 'name' = 'Test 500 per unit' and (t ->> 'targetUnits')::int = 1000 and (t ->> 'unitsDone')::numeric > 0)),
  'target progress counts the units paid in this person''s chain');
select test.login('tm_a');
select test.check((select count(*) filter (where e ->> 'status' = 'REVERSED') = 0 and count(*) > 0
                          and bool_and(e ->> 'customerName' like 'Inc Test %' or e ->> 'eventType' <> 'SALE_PAID')
                     from jsonb_array_elements(income_earnings(private.office_today() - 30, private.office_today())) e),
  'the Team Member lists their earnings with the customer and what each was for');
select test.login('tc_a');
select test.check((select bool_and(e ->> 'profileId' is null) and count(*) > 0 from jsonb_array_elements(income_earnings(private.office_today() - 30, private.office_today())) e)
                  and (select (income_summary() ->> 'total')::numeric = :'tc_total'::numeric),
  'a person sees only their own earnings');
reset role;
update employee_personal_details set joining_date = private.office_today() - 3 where profile_id = test.id('ba_a');
set role authenticated;
select test.login('ba_a');
select test.check((select not (d ->> 'eligible')::boolean and (d ->> 'startsOn')::date = private.office_today() + 12 from (select income_summary() d) x),
  'before eligibility startsOn is the start date and eligible is false');
reset role;
update employee_personal_details set joining_date = date '2026-01-01' where profile_id = test.id('ba_a');
select test.must_fail($$select income_summary()$$, 'nobody signed in: refused', 'FORBIDDEN') from (select set_config('request.jwt.claims', '{}', false)) x;

\echo '   review fixes: GST-exclusive orders, an unlabelled head, overlapping rules, people who left, a team without a Team Lead'
reset role;
select test.inc_customer('Inc Test Gst', 'tm_a', 10000, :'svc') as cg \gset
update customers set deal_amount = 11800 where id = :'cg';
select test.inc_pay(:'cg', 10000);
select test.check(test.earned('tm_a', :'cg') = round(100 * 10000 / 11800.0, 2),
  'an order priced before GST (10000 + 18%): paying 10000 releases 10000/11800 of the incentive, not all of it');

update profiles set head_division = null where id = test.id('sh_head');
select test.check(exists (select 1 from private.incentive_chain(test.id('tm_a')) c where c.level = 'DEPARTMENT_HEAD' and c.profile_id = test.id('sh_head')),
  'a Department Head without a Sales / Support label is still in the chain');
set role authenticated;
select test.login('sh_head');
select incentive_allocation_set((select v from inc where k = 'rule')::uuid, test.id('th_wab'), 150);
select test.check(true, 'and can still set their Team Lead''s amount');
reset role;
update profiles set head_division = 'SALES' where id = test.id('sh_head');

set role authenticated;
select test.login('sa');
select test.must_fail(format($$select incentive_rule_create('{"name":"Test overlap","eventType":"SALE_PAID","serviceCode":"%s","amount":600,"scopeType":"OPERATIONS_HEAD","scopeValue":"%s"}')$$, :'svc', :'oh'),
  'a second active sales rule for the same Operations Head and product is refused (it would pay twice)', 'CONFLICT');
insert into inc select 'rule2', incentive_rule_create(jsonb_build_object('name', 'Test 400 replaces', 'eventType', 'SALE_PAID', 'serviceCode', :'svc', 'amount', 400,
  'targetUnits', 1000, 'scopeType', 'OPERATIONS_HEAD', 'scopeValue', :'oh', 'replacesRuleId', (select v from inc where k = 'rule')))::text;
reset role;
select test.check((select ended_at is not null from incentive_rules where id = (select v from inc where k = 'rule')::uuid)
                  and private.incentive_amount((select v from inc where k = 'rule2')::uuid, test.id('sh_head')) = 300
                  and private.incentive_amount((select v from inc where k = 'rule2')::uuid, test.id('tm_a')) = 100,
  'replacing a rule ends the old one and carries the amounts passed down (never above the new amount)');

update profiles set status = 'SUSPENDED' where id = test.id('th_wab');
select test.inc_customer('Inc Test Left', 'tm_a', 2000, :'svc') as cl \gset
select test.inc_pay(:'cl', 2000);
select test.check(test.earned('th_wab', :'cl') = 0 and test.earned('tm_a', :'cl') = 100 and test.earned('sh_head', :'cl') = 200,
  'a Team Lead who is no longer active is not in the chain and earns nothing; their Department Head holds that share');
update profiles set status = 'ACTIVE' where id = test.id('th_wab');
select test.inc_customer('Inc Test Left2', 'tm_a', 2000, :'svc') as cl2 \gset
update profiles set status = 'SUSPENDED' where id = test.id('tm_a');
select test.inc_pay(:'cl2', 2000);
select test.check(test.earned('tm_a', :'cl2') = 0, 'a closer who has left (suspended) earns nothing on their old customer');
update profiles set status = 'ACTIVE' where id = test.id('tm_a');
update profiles set status = 'SUSPENDED' where id = test.id('th_wab');
update profiles set status = 'ACTIVE' where id = test.id('th_wab');
insert into inc select 'tl:' || id, id::text from profiles where team_id = test.team('wabastore', 'Sales') and role = 'TEAM_HEAD' and status = 'ACTIVE';
update profiles set status = 'SUSPENDED' where id in (select v::uuid from inc where k like 'tl:%');
select test.check(exists (select 1 from private.incentive_reports(test.id('sh_head')) r where r.profile_id = test.id('tm_a'))
                  and not exists (select 1 from private.incentive_reports(test.id('sh_head')) r where r.profile_id = test.id('tc_a') and r.level <> 'TEAM_MEMBER'),
  'a team without an active Team Lead: its members are listed to the Department Head, who can set their amount');
set role authenticated;
select test.login('sh_head');
select test.check((incentive_allocation_set((select v from inc where k = 'rule2')::uuid, test.id('tm_a'), 120) ->> 'amount')::numeric = 120,
  'and the Department Head sets that member''s amount directly');
reset role;
update profiles set status = 'ACTIVE' where id in (select v::uuid from inc where k like 'tl:%');
update incentive_allocations set amount = 100 where rule_id = (select v from inc where k = 'rule2')::uuid and recipient_id = test.id('tm_a');

\echo '   the Super Admin edits and deletes rules; the setup screen shows each person below with what they get'
reset role;
\i supabase/migrations/20270121000100_incentive_setup_given.sql
\i supabase/migrations/20270121000100_incentive_setup_given.sql
set role authenticated;
select test.login('sa');
select incentive_rule_update((select v from inc where k = 'rule2')::uuid, '{"name":"Test 400 renamed","targetUnits":2000}');
reset role;
select test.check((select name = 'Test 400 renamed' and target_units = 2000 and ended_at is null from incentive_rules where id = (select v from inc where k = 'rule2')::uuid),
  'editing the name and target changes the rule in place');
set role authenticated;
select test.login('sa');
insert into inc select 'rule3', incentive_rule_update((select v from inc where k = 'rule2')::uuid, '{"amount":450}') ->> 'id';
reset role;
select test.check((select ended_at is not null from incentive_rules where id = (select v from inc where k = 'rule2')::uuid)
                  and (select amount = 450 and name = 'Test 400 renamed' and ended_at is null from incentive_rules where id = (select v from inc where k = 'rule3')::uuid)
                  and private.incentive_amount((select v from inc where k = 'rule3')::uuid, test.id('tm_a')) = 100
                  and (select count(*) > 0 from earnings where rule_id = (select v from inc where k = 'rule2')::uuid and status = 'EARNED'),
  'editing the amount applies from now on: the old version ends (its earnings stay), the new one carries the amounts passed down');
set role authenticated;
select test.login('sa');
insert into inc select 'unused', incentive_rule_create(jsonb_build_object('name', 'Test unused', 'eventType', 'VISIT_COMPLETED', 'amount', 10,
  'scopeType', 'PERSON', 'scopeValue', test.id('tm_a')))::text;
select test.check((incentive_rule_delete((select v from inc where k = 'unused')::uuid) ->> 'deleted')::boolean, 'a rule nobody earned from is deleted');
select test.check((select (d ->> 'deleted')::boolean = false and (d ->> 'ended')::boolean from (select incentive_rule_delete((select v from inc where k = 'demo')::uuid) d) x),
  'a rule with earnings is stopped instead of deleted (earned money is never erased)');
select test.login('sh_head');
select test.must_fail(format($$select incentive_rule_delete(%L)$$, (select v from inc where k = 'rule3')), 'only the Super Admin deletes rules', 'FORBIDDEN');
select test.must_fail(format($$select incentive_rule_update(%L, '{"amount":1}')$$, (select v from inc where k = 'rule3')), 'only the Super Admin edits rules', 'FORBIDDEN');
reset role;
select test.check(not exists (select 1 from incentive_rules where id = (select v from inc where k = 'unused')::uuid)
                  and (select ended_at is not null from incentive_rules where id = (select v from inc where k = 'demo')::uuid)
                  and (select count(*) > 0 from earnings where rule_id = (select v from inc where k = 'demo')::uuid),
  'the deleted rule is gone; the stopped one and its earnings remain');
set role authenticated;
select test.login('sa');
select incentive_allocation_set((select v from inc where k = 'rule3')::uuid, test.id('tm_a'), 80);
select test.login('th_wab');
select test.check((select (g ->> 'amount')::numeric = 80 and (g ->> 'kept')::numeric = 70 and g ->> 'name' is not null
                     from jsonb_array_elements(incentive_setup() -> 'rules') r, jsonb_array_elements(r -> 'given') g
                    where r ->> 'id' = (select v from inc where k = 'rule3') and g ->> 'recipientId' = test.id('tm_a')::text),
  'after a Super Admin override the Team Lead sees what their member now gets (80) and what they keep (70)');
select test.login('sa');
insert into inc select 'rule4', incentive_rule_update((select v from inc where k = 'rule3')::uuid, jsonb_build_object('serviceCode', :'svc2')) ->> 'id';
reset role;
select test.check((select ended_at is not null from incentive_rules where id = (select v from inc where k = 'rule3')::uuid)
                  and (select service_code = :'svc2' and ended_at is null from incentive_rules where id = (select v from inc where k = 'rule4')::uuid)
                  and not exists (select 1 from incentive_allocations where rule_id = (select v from inc where k = 'rule4')::uuid),
  'moving a sales rule to another product ends it and starts a fresh one (amounts are passed down again)');
select test.check((select private.ba_demo_row(d) ? 'authorisedPersonAttended' from ba_demos d limit 1), 'a demo record carries the authorised-person tick');
select test.check((select count(*) >= 4 from audit_logs where action in ('INCENTIVE_RULE_UPDATED', 'INCENTIVE_RULE_DELETED')), 'edits and deletions are on the audit trail');
\echo '   review fixes (setup screens): a new version keeps the 100% and monthly-cap limits; values are checked; future rules can be edited'
reset role;
-- a fully paid order earns nothing more after the rule's amount is edited (the new version shares the order's 100%)
set role authenticated;
select test.login('sa');
select incentive_allocation_set((select v from inc where k = 'rule4')::uuid, test.id('sh_head'), 300);
reset role;
select test.inc_customer('Inc Test Version', 'tm_a', 2000, :'svc2') as cv \gset
select test.inc_pay(:'cv', 2000);
select coalesce(sum(amount), 0) as cv_before from earnings where customer_id = :'cv' and status = 'EARNED' \gset
set role authenticated;
select test.login('sa');
insert into inc select 'rule5', incentive_rule_update((select v from inc where k = 'rule4')::uuid, '{"amount":460}') ->> 'id';
reset role;
select test.inc_pay(:'cv', 500);
select test.check((select coalesce(sum(amount), 0) = :cv_before from earnings where customer_id = :'cv' and status = 'EARNED')
                  and not exists (select 1 from earnings where customer_id = :'cv' and rule_id = (select v from inc where k = 'rule5')::uuid),
  'an order already paid in full earns nothing more after the amount is edited (never more than 100% of the order)');
select test.check(private.incentive_amount((select v from inc where k = 'rule5')::uuid, test.id('sh_head')) = 300
                  and (select replaces_rule_id = (select v from inc where k = 'rule4')::uuid from incentive_rules where id = (select v from inc where k = 'rule5')::uuid),
  'the new version records the one it replaces and keeps the amounts passed down');

-- an event reward's monthly cap is shared by its versions
set role authenticated;
select test.login('sa');
insert into inc select 'capv', incentive_rule_create(jsonb_build_object('name', 'Test cap visit', 'eventType', 'VISIT_COMPLETED', 'amount', 30,
  'scopeType', 'PERSON', 'scopeValue', test.id('tm_a'), 'monthlyCap', 40))::text;
reset role;
update incentive_rules set ended_at = now() where id = (select v from inc where k = 'visit')::uuid;
insert into lead_visits (lead_id, employee_id, visit_date, purpose, status)
  values ((select id from customers where name = 'Inc Test One'), test.id('tm_a'), private.office_today(), 'Inc Test visit', 'SCHEDULED') returning id as cv1 \gset
update lead_visits set status = 'COMPLETED', completed_at = now(), gps_captured = true where id = :'cv1';
set role authenticated;
select test.login('sa');
insert into inc select 'capv2', incentive_rule_update((select v from inc where k = 'capv')::uuid, '{"amount":35}') ->> 'id';
reset role;
insert into lead_visits (lead_id, employee_id, visit_date, purpose, status)
  values ((select id from customers where name = 'Inc Test One'), test.id('tm_a'), private.office_today(), 'Inc Test visit', 'SCHEDULED') returning id as cv2 \gset
update lead_visits set status = 'COMPLETED', completed_at = now(), gps_captured = true where id = :'cv2';
select test.check((select coalesce(sum(amount), 0) = 40 from earnings where profile_id = test.id('tm_a') and status = 'EARNED'
                     and rule_id in ((select v from inc where k = 'capv')::uuid, (select v from inc where k = 'capv2')::uuid)),
  'editing an event reward mid-month does not reset its monthly cap (30 + 10, cap 40)');

-- padded values are the same product: the amounts passed down are kept
set role authenticated;
select test.login('sa');
insert into inc select 'rule6', incentive_rule_update((select v from inc where k = 'rule5')::uuid, jsonb_build_object('serviceCode', ' ' || :'svc2' || ' ', 'amount', 470)) ->> 'id';
reset role;
select test.check(private.incentive_amount((select v from inc where k = 'rule6')::uuid, test.id('sh_head')) = 300,
  'a product code with stray spaces is the same product: the amounts passed down are kept');
set role authenticated;
select test.login('sa');
select test.must_fail(format($$select incentive_rule_update(%L, '{"amount":"abc"}')$$, (select v from inc where k = 'rule6')), 'a bad amount is a validation error', 'VALIDATION_ERROR');
select test.must_fail(format($$select incentive_rule_update(%L, '{"amount":480,"targetUnits":"1.5"}')$$, (select v from inc where k = 'rule6')), 'a bad target is a validation error', 'VALIDATION_ERROR');
select test.must_fail(format($$select incentive_rule_update(%L, '{"amount":50,"monthlyCap":0}')$$, (select v from inc where k = 'capv2')), 'a zero cap is a validation error', 'VALIDATION_ERROR');
select test.must_fail(format($$select incentive_rule_update(%L, '{"name":"x"}')$$, gen_random_uuid()), 'a missing rule is not found', 'NOT_FOUND');
select test.must_fail(format($$select incentive_rule_update(%L, '{"name":"x"}')$$, (select v from inc where k = 'rule5')), 'an ended rule cannot be edited', 'CONFLICT');
select test.check((incentive_rule_update((select v from inc where k = 'capv2')::uuid, '{"amount":36,"eventType":"SALE_PAID","activeFrom":"2030-01-01"}') ->> 'eventType') = 'VISIT_COMPLETED',
  'an edit cannot change what a rule rewards or move its start');
reset role;
insert into inc select 'future', id::text from incentive_rules where event_type = 'VISIT_COMPLETED' and name = 'Test cap visit' and ended_at is null;
update incentive_rules set active_from = private.office_today() + 5 where id = (select v from inc where k = 'future')::uuid;
set role authenticated;
select test.login('sa');
select test.check((incentive_rule_update((select v from inc where k = 'future')::uuid, '{"name":"Test cap visit later"}') ->> 'name') = 'Test cap visit later',
  'a rule that starts later can be edited');
select test.login('th_wab');
select test.check((select incentive_setup() -> 'options' is null or incentive_setup() -> 'options' = 'null'::jsonb), 'a Team Lead gets no option lists');
reset role;
delete from lead_visits where purpose = 'Inc Test visit';
