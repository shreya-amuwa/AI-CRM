-- =============================================================================
-- Incentive payouts (migration 20270123000100): payout details, the available balance, withdrawal requests, the Accounts queue
-- (mark paid, reject, final settlement), clawback, the expense entry. Uses the Wabastore Sales fixtures (tm_a, tc_a), the Accounts
-- member acc_m and the Super Admin sa. Synthetic data only; safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 148. Incentive payouts'
reset role;
\i supabase/migrations/20270123000100_incentive_payouts.sql
\i supabase/migrations/20270123000100_incentive_payouts.sql
-- a clean slate: this suite's earnings, requests, expenses and details
delete from payout_requests where profile_id in (test.id('tm_a'), test.id('tc_a'), test.id('acc_m'));
delete from department_expenses where category = 'Sales Incentive' and description like 'Sales incentive payout - %';
delete from payout_methods where profile_id in (test.id('tm_a'), test.id('tc_a'), test.id('acc_m'));
delete from earnings where event_ref like 'TESTPO:%';
delete from incentive_rules where name = 'Test payout rule';
update profiles set status = 'ACTIVE' where id in (test.id('tm_a'), test.id('tc_a'));
insert into incentive_rules (name, event_type, amount, scope_type, scope_value, active_from, created_by)
  values ('Test payout rule', 'VISIT_COMPLETED', 1, 'PERSON', test.id('tm_a')::text, date '2026-01-01', test.id('sa'));
create or replace function test.po_earn(p_who text, p_ref text, p_amount numeric) returns void language sql as $$
  insert into public.earnings (profile_id, rule_id, event_type, event_ref, role, amount)
  values (test.id(p_who), (select id from public.incentive_rules where name = 'Test payout rule'), 'VISIT_COMPLETED', 'TESTPO:' || p_ref, 'PARTICIPANT', p_amount) $$;
-- the HR joining date (hr_employees, text) and the personal-details one; null clears it
create or replace function test.po_join(p_who text, p_date date) returns void language plpgsql as $$
begin
  if exists (select 1 from public.hr_employees where profile_id = test.id(p_who)) then
    update public.hr_employees set joining_date = p_date::text where profile_id = test.id(p_who);
  else
    insert into public.hr_employees (id, name, joining_date, profile_id) values ('TEST-PO-' || p_who, p_who, p_date::text, test.id(p_who));
  end if;
  update public.employee_personal_details set joining_date = null where profile_id = test.id(p_who);
end $$;
grant execute on all functions in schema test to anon, authenticated, service_role;
select test.po_join('tm_a', date '2026-01-01');
select test.po_join('tc_a', date '2026-01-01');
select test.po_join('acc_m', date '2026-01-01');
select test.po_earn('tm_a', '1', 1000);
select test.po_earn('tm_a', '2', 2000);
-- tm_a may already hold earnings from the incentives suite: amounts below are relative to what they hold now
select coalesce(sum(amount), 0) as earned0 from earnings where profile_id = test.id('tm_a') and status = 'EARNED' \gset
create temp table po (k text primary key, v text);
grant all on po to authenticated;

\echo '   payout details and the available balance'
set role authenticated;
select test.login('tm_a');
select test.check((payout_method_save('{"kind":"BANK","holderName":"Test Member","accountNumber":"123456789012","ifsc":"hdfc0001234"}') ->> 'accountNumber') = '123456789012',
  'a person saves their bank details and sees them in full');
select test.check((payout_method_get() ->> 'ifsc') = 'HDFC0001234', 'the IFSC is stored in capitals');
select test.must_fail($$select payout_method_save('{"kind":"BANK","holderName":"Test Member","accountNumber":"123456789012","ifsc":"HDFC001234"}')$$, 'a wrong IFSC is refused', 'VALIDATION_ERROR');
select test.must_fail($$select payout_method_save('{"kind":"BANK","holderName":"Test Member","accountNumber":"12AB","ifsc":"HDFC0001234"}')$$, 'a wrong account number is refused', 'VALIDATION_ERROR');
select test.must_fail($$select payout_method_save('{"kind":"UPI","holderName":"Test Member","upiId":"bad"}')$$, 'a wrong UPI ID is refused', 'VALIDATION_ERROR');
select test.must_fail($$select payout_method_save('{"kind":"BANK","holderName":"Test Member","accountNumber":"123456789012","ifsc":"HDFC0001234","pan":"ABCDE1234"}')$$, 'a wrong PAN is refused', 'VALIDATION_ERROR');
select test.must_fail($$select payout_method_save('{"kind":"OTHER","holderName":"Test Member","otherDetails":" "}')$$, 'international details need the details', 'VALIDATION_ERROR');
select test.check((income_summary() ->> 'available')::numeric = :earned0 and (income_summary() ->> 'withdrawn')::numeric = 0
                  and income_summary() ? 'withdrawOpensOn' and income_summary() -> 'openRequest' = 'null'::jsonb,
  'My Income shows withdrawn 0 and everything earned as available');
reset role;
select test.check((select private.payout_method_json(m, false) ->> 'accountNumber' = '••••9012' from payout_methods m where profile_id = test.id('tm_a')),
  'anyone else sees only the last four digits');
select test.check((select count(*) >= 1 from audit_logs where action = 'PAYOUT_METHOD_SAVED' and entity_id = test.id('tm_a')), 'saving details is audited');
select test.check(private.payout_opens_on(test.id('tm_a')) = date '2026-01-16', 'withdrawals open 15 days after the HR joining date');
select test.po_join('tc_a', null);
update hr_employees set joining_date = null where profile_id = test.id('tc_a');
select test.check(private.payout_opens_on(test.id('tc_a')) is null, 'no HR joining date: withdrawals stay closed (no fallback to the account date)');
select test.po_join('tc_a', date '2026-01-01');
