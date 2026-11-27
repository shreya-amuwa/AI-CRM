-- =============================================================================
-- Support incentives (migration 20270224000100): a "Support business" rule pays a Support person for the payments Accounts verifies on the customers they
-- look after - a fixed amount or a percentage, optionally only from a monthly business minimum, within a monthly cap - once per payment, reversed with the
-- payment, credited to their Wallet. Only the Super Admin sets rules; Sales rules are unchanged. Reuses import_test's Support members sup_b (customer
-- 9000000103) and sup_plain (9000000101). Synthetic data only; safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 153. Support incentives'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270224000100_support_incentives.sql
\i supabase/migrations/20270224000100_support_incentives.sql
create temp table si (k text primary key, v text);
grant all on si to authenticated;
insert into si select 'start', start_after_days::text from incentive_settings where id;
update incentive_settings set start_after_days = 0 where id;           -- these members joined today: they earn from today
insert into si select 'cb', id::text from customers where phone = '9000000103';
insert into si select 'cp', id::text from customers where phone = '9000000101';
insert into si select 'team', team_id::text from profiles where id = test.id('sup_b');
select test.check((select count(*) = 3 from si where k in ('cb', 'cp', 'team')), 'fixture: two Support customers and the Support team');
-- earlier runs of this suite: their rules end, their payments are no longer verified (nothing is deleted from the incentive tables)
update incentive_rules set ended_at = now() where name like 'SI %' and ended_at is null;
update customer_payments set status = 'REJECTED' where reference like 'SI-%' and status = 'VERIFIED';
insert into si select 'base_b', private.support_business_month(test.id('sup_b'))::text;
create or replace function test.si_pay(p_customer text, p_amount numeric, p_ref text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.customer_payments (customer_id, payment_type, amount, reference, status) values (p_customer::uuid, 'PART', p_amount, p_ref || '-' || extract(epoch from clock_timestamp())::text, 'PENDING') returning id into v;
  update public.customer_payments set status = 'VERIFIED', verified_at = now() where id = v;
  return v;
end $$;
create or replace function test.si_earned(p_who text, p_rule text) returns numeric language sql as $$
  select coalesce(sum(e.amount), 0) from public.earnings e join public.incentive_rules r on r.id = e.rule_id
   where e.profile_id = test.id(p_who) and r.name = p_rule and e.status = 'EARNED' $$;

\echo '   only the Super Admin sets Support rules, and they are checked'
set role authenticated;
select test.login('sup_b');
select test.must_fail(format($$select incentive_rule_create('{"name":"SI mine","eventType":"SUPPORT_BUSINESS","amount":500,"scopeType":"PERSON","scopeValue":"%s"}')$$, test.id('sup_b')),
  'a Support member cannot give themselves an incentive', 'Only the Super Admin');
select test.login('sa');
select test.must_fail(format($$select incentive_rule_create('{"name":"SI bad","eventType":"SUPPORT_BUSINESS","amount":500,"scopeType":"PERSON","scopeValue":"%s"}')$$, test.id('tm_a')),
  'a Support rule must be for Support people', 'Support');
select test.must_fail(format($$select incentive_rule_create('{"name":"SI pct","eventType":"SUPPORT_BUSINESS","amountType":"PERCENT","amount":150,"scopeType":"PERSON","scopeValue":"%s"}')$$, test.id('sup_b')),
  'a percentage is at most 100', 'at most 100');
select test.must_fail($$select incentive_rule_create('{"name":"SI demo pct","eventType":"DEMO_COMPLETED","amountType":"PERCENT","amount":10,"scopeType":"LEVEL","scopeValue":"TEAM_MEMBER"}')$$,
  'percentages are only for Support business', 'Support business only');
select test.must_fail($$select incentive_rule_create('{"name":"SI demo min","eventType":"DEMO_COMPLETED","amount":10,"minMonthlyBusiness":1000,"scopeType":"LEVEL","scopeValue":"TEAM_MEMBER"}')$$,
  'a monthly business minimum is only for Support business', 'Support business');

\echo '   fixed and percentage'
insert into si select 'fixed', incentive_rule_create(format('{"name":"SI fixed","eventType":"SUPPORT_BUSINESS","amount":500,"scopeType":"PERSON","scopeValue":"%s"}', test.id('sup_b'))::jsonb)::text;
insert into si select 'pct', incentive_rule_create(format('{"name":"SI pct","eventType":"SUPPORT_BUSINESS","amountType":"PERCENT","amount":10,"scopeType":"TEAM","scopeValue":"%s","monthlyCap":2500}', (select v from si where k = 'team'))::jsonb)::text;
select test.check((select r ->> 'amountType' = 'PERCENT' and (r ->> 'monthlyCap')::numeric = 2500 from (select jsonb_array_elements(incentive_setup() -> 'rules') r) x where r ->> 'name' = 'SI pct' and (r ->> 'active')::boolean),
  'the setup screen lists the rule with its amount type');
reset role;
insert into si select 'p1', test.si_pay((select v from si where k = 'cb'), 20000, 'SI-1')::text;
select test.check(test.si_earned('sup_b', 'SI fixed') = 500, 'a verified payment on a customer sup_b looks after: the fixed ₹500');
select test.check(test.si_earned('sup_b', 'SI pct') = 2000, 'and 10% of ₹20,000 for the team rule');
select test.check(test.si_earned('sup_plain', 'SI pct') = 0 and test.si_earned('sup_plain', 'SI fixed') = 0, 'nothing for a Support person who does not look after that customer');
insert into si select 'p2', test.si_pay((select v from si where k = 'cp'), 10000, 'SI-2')::text;
select test.check(test.si_earned('sup_plain', 'SI pct') = 1000 and test.si_earned('sup_plain', 'SI fixed') = 0, 'sup_plain: 10% of their own customer''s payment; the person rule is not theirs');
insert into si select 'p3', test.si_pay((select v from si where k = 'cb'), 20000, 'SI-3')::text;
select test.check(test.si_earned('sup_b', 'SI pct') = 2500, 'the monthly cap stops the percentage at ₹2,500 for the month');
select test.check(test.si_earned('sup_b', 'SI fixed') = 1000, 'the fixed amount is paid per payment');

\echo '   once per payment, reversed with it'
update customer_payments set status = 'VERIFIED', verified_at = now() where id = (select v from si where k = 'p1')::uuid;
select test.check((select count(*) = 1 from earnings where event_ref = 'SUP:' || (select v from si where k = 'p1') and profile_id = test.id('sup_b')
                    and rule_id = (select v from si where k = 'fixed')::uuid), 'verifying again pays nothing twice');
update customer_payments set status = 'REJECTED' where id = (select v from si where k = 'p1')::uuid;
select test.check(test.si_earned('sup_b', 'SI fixed') = 500 and (select count(*) = 2 from earnings where event_ref = 'SUP:' || (select v from si where k = 'p1') and status = 'REVERSED'),
  'a payment that leaves Verified takes its Support incentives back');
select test.check((select count(*) = 0 from earnings where event_ref = 'PAY:' || (select v from si where k = 'p1')), 'no sales incentive came from it (no sales rule for that customer)');

\echo '   a monthly business minimum'
set role authenticated;
select test.login('sa');
insert into si select 'min', incentive_rule_create(format('{"name":"SI min","eventType":"SUPPORT_BUSINESS","amount":300,"minMonthlyBusiness":%s,"scopeType":"PERSON","scopeValue":"%s"}',
  (select v from si where k = 'base_b')::numeric + 20000 + 40000 + 1, test.id('sup_b'))::jsonb)::text;
reset role;
insert into si select 'p4', test.si_pay((select v from si where k = 'cb'), 20000, 'SI-4')::text;
select test.check(test.si_earned('sup_b', 'SI min') = 0, 'below the monthly minimum: nothing');
insert into si select 'p5', test.si_pay((select v from si where k = 'cb'), 30000, 'SI-5')::text;
select test.check(test.si_earned('sup_b', 'SI min') = 300, 'the payment that takes the month over the minimum earns, and every later one');

\echo '   edit, stop, and the wallet'
set role authenticated;
select test.login('sa');
select incentive_rule_update((select v from si where k = 'fixed')::uuid, '{"amountType":"PERCENT","amount":5}'::jsonb);
select incentive_rule_end((select (r ->> 'id')::uuid from jsonb_array_elements(incentive_setup() -> 'rules') r where r ->> 'name' = 'SI pct' and (r ->> 'active')::boolean));
reset role;
select test.check((select count(*) = 1 from incentive_rules where name = 'SI fixed' and ended_at is null and amount_type = 'PERCENT' and amount = 5
                     and replaces_rule_id = (select v from si where k = 'fixed')::uuid), 'changing fixed to a percentage makes a new version from now on');
select test.check((select ended_at is not null from incentive_rules where id = (select v from si where k = 'fixed')::uuid), 'the old version stopped');
insert into si select 'p6', test.si_pay((select v from si where k = 'cb'), 10000, 'SI-6')::text;
select test.check(test.si_earned('sup_b', 'SI fixed') = 1500 + 500, 'the new version: 5% of ₹10,000 (on top of ₹1,500 from the fixed version: 3 payments)');
select test.check((select count(*) = 0 from earnings e join incentive_rules r on r.id = e.rule_id where r.name = 'SI pct' and e.event_ref = 'SUP:' || (select v from si where k = 'p6')),
  'a stopped rule pays nothing more');
select test.check((select count(*) >= 1 from audit_logs where action = 'INCENTIVE_RULE_CREATED' and metadata ->> 'amountType' = 'PERCENT'), 'rules are audited with their amount type');
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', test.id('sup_b'), 'role', 'authenticated', 'session_id', 'si')::text, false);
select test.check((select (wallet_summary() -> 'incentives' ->> 'credited')::numeric >= 500 + 2500 + 300), 'the Support incentives are in sup_b''s Wallet');
reset role;
update incentive_settings set start_after_days = (select v from si where k = 'start')::integer where id;
update incentive_rules set ended_at = now() where name like 'SI %' and ended_at is null;
select set_config('request.jwt.claims', '', false);
\echo '=== ALL SUPPORT INCENTIVE TESTS PASSED ==='
