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
