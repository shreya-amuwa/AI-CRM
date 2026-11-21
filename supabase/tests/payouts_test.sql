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
delete from payout_requests where profile_id in (test.id('tm_a'), test.id('tc_a'), test.id('acc_m'), test.id('sec_user'));
delete from department_expenses where category = 'Sales Incentive' and description like 'Sales incentive payout - %';
delete from payout_methods where profile_id in (test.id('tm_a'), test.id('tc_a'), test.id('acc_m'), test.id('sec_user'));
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
    insert into public.hr_employees (id, name, joining_date, profile_id) values ('TEST-PO-' || p_who, p_who, p_date::text, test.id(p_who))
    on conflict (id) do update set profile_id = excluded.profile_id, joining_date = excluded.joining_date;
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

\echo '   withdrawal requests and the Accounts actions'
reset role;
select test.po_join('tm_a', private.office_today() - 10);
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select payout_request(600, 'po-req-early')$$, 'before the opening date a request is refused', 'Withdrawals open on');
reset role;
update hr_employees set joining_date = null where profile_id = test.id('tm_a');
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select payout_request(600, 'po-req-nodate')$$, 'without an HR joining date a request is refused', 'HR records your joining date');
reset role;
select test.po_join('tm_a', private.office_today() - 16);
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select payout_request(499, 'po-req-small')$$, 'less than 500 is refused', 'VALIDATION_ERROR');
select test.must_fail(format($$select payout_request(%s, 'po-req-big')$$, :earned0 + 1), 'more than available is refused', 'VALIDATION_ERROR');
insert into po select 'r1', payout_request(600, 'po-req-0001') ->> 'id';
select test.check((payout_request(600, 'po-req-0001') ->> 'id') = (select v from po where k = 'r1'), 'the same request sent twice is one request');
select test.must_fail($$select payout_request(700, 'po-req-0002')$$, 'a second open request is refused', 'CONFLICT');
select test.check((income_summary() ->> 'available')::numeric = :earned0 - 600 and (income_summary() -> 'openRequest' ->> 'id') = (select v from po where k = 'r1'),
  'the open request is taken off the available balance and shown');
select test.check((payout_cancel((select v from po where k = 'r1')::uuid) ->> 'status') = 'CANCELLED', 'the person cancels their request');
select test.check((income_summary() ->> 'available')::numeric = :earned0, 'cancelling frees the amount again');
select test.must_fail(format($$select payout_cancel(%L)$$, (select v from po where k = 'r1')), 'a cancelled request cannot be cancelled again', 'CONFLICT');
select test.must_fail($$select payout_queue('REQUESTED')$$, 'a Sales member cannot open the Accounts queue', 'FORBIDDEN');
insert into po select 'r2', payout_request(1234.50, 'po-req-0003') ->> 'id';
-- details changed while a request is open: the request keeps the details it was made with, and Accounts is told
select payout_method_save('{"kind":"BANK","holderName":"Test Member","accountNumber":"999999999999","ifsc":"ICIC0004321"}');
reset role;
select test.check((select count(*) >= 1 from notifications where type = 'PAYOUT_REQUESTED' and recipient_id = test.id('acc_m') and entity_id = (select v from po where k = 'r2')::uuid),
  'Accounts staff are told about a new request');
select test.check((select count(*) >= 1 from notifications where type = 'PAYOUT_DETAILS_CHANGED' and recipient_id = test.id('acc_m') and entity_id = (select v from po where k = 'r2')::uuid),
  'Accounts staff are told when details change while a request is open');
set role authenticated;
select test.login('tc_a');
select test.must_fail(format($$select payout_cancel(%L)$$, (select v from po where k = 'r2')), 'someone else''s request cannot be cancelled', 'FORBIDDEN');
select test.login('acc_m');
select test.check((payout_detail((select v from po where k = 'r2')::uuid) -> 'method' ->> 'accountNumber') = '123456789012',
  'Accounts sees the full details the request was made with');
select test.check(exists (select 1 from jsonb_array_elements(payout_queue('REQUESTED')) x where x ->> 'id' = (select v from po where k = 'r2')), 'the request is in the Accounts queue');
select test.check((payout_counts() ->> 'requested')::int >= 1, 'the Accounts badge counts it');
select test.must_fail(format($$select payout_mark_paid(%L, ' ', private.office_today(), 0)$$, (select v from po where k = 'r2')), 'paying needs a reference', 'VALIDATION_ERROR');
select test.must_fail(format($$select payout_mark_paid(%L, 'UTR1', private.office_today() + 1, 0)$$, (select v from po where k = 'r2')), 'a payment date in the future is refused', 'VALIDATION_ERROR');
select test.must_fail(format($$select payout_mark_paid(%L, 'UTR1', private.office_today(), 1300)$$, (select v from po where k = 'r2')), 'TDS above the amount is refused', 'VALIDATION_ERROR');
select test.check((select x ->> 'status' = 'PAID' and (x ->> 'netAmount')::numeric = 1184.25 and (x ->> 'tdsAmount')::numeric = 50.25
                     from (select payout_mark_paid((select v from po where k = 'r2')::uuid, 'UTR123', private.office_today(), 50.25) x) y),
  'Accounts marks 1,234.50 paid with TDS 50.25: net 1,184.25');
select test.must_fail(format($$select payout_mark_paid(%L, 'UTR124', private.office_today(), 0)$$, (select v from po where k = 'r2')), 'a paid request cannot be paid again', 'CONFLICT');
reset role;
select test.check((select e.category = 'Sales Incentive' and e.amount = 1234.50 and e.payment_status = 'PAID'
                          and (select count(*) = 1 and bool_and(a.department_id = (select department_id from profiles where id = test.id('tm_a')))
                                 from expense_allocations a where a.expense_id = e.id)
                     from payout_requests r join department_expenses e on e.id = r.expense_id where r.id = (select v from po where k = 'r2')::uuid),
  'the payout is a Sales Incentive expense of the person''s department');
select test.check((select count(*) >= 1 from notifications where type = 'PAYOUT_PAID' and recipient_id = test.id('tm_a')), 'the person is told it was paid');
select test.check((select count(*) >= 1 from audit_logs where action = 'PAYOUT_PAID' and entity_id = (select v from po where k = 'r2')::uuid), 'paying is audited');
set role authenticated;
select test.login('tm_a');
select test.check((income_summary() ->> 'withdrawn')::numeric = 1234.50 and (income_summary() ->> 'available')::numeric = :earned0 - 1234.50,
  'My Income: withdrawn 1,234.50, available reduced by the same');
-- reject
insert into po select 'r3', payout_request(500, 'po-req-0004') ->> 'id';
select test.login('acc_m');
select test.must_fail(format($$select payout_reject(%L, ' ')$$, (select v from po where k = 'r3')), 'rejecting needs a reason', 'VALIDATION_ERROR');
select test.check((payout_reject((select v from po where k = 'r3')::uuid, 'Wrong account') ->> 'status') = 'REJECTED', 'Accounts rejects with a reason');
reset role;
select test.check((select count(*) >= 1 from notifications where type = 'PAYOUT_REJECTED' and recipient_id = test.id('tm_a')), 'the person is told why');
-- nobody pays their own request
select test.po_earn('acc_m', 'acc1', 800);
set role authenticated;
select test.login('acc_m');
select payout_method_save('{"kind":"UPI","holderName":"Test Accounts","upiId":"acc.test@okhdfcbank"}');
insert into po select 'own', payout_request(500, 'po-req-0005') ->> 'id';
select test.must_fail(format($$select payout_mark_paid(%L, 'UTR9', private.office_today(), 0)$$, (select v from po where k = 'own')), 'nobody pays their own withdrawal', 'FORBIDDEN');
select test.login('sa');
select payout_mark_paid((select v from po where k = 'own')::uuid, 'UTR9', private.office_today(), 0);
-- clawback: an earning reversed after it was paid out
select test.login('tm_a');
select payout_request((income_summary() ->> 'available')::numeric, 'po-req-0006') ->> 'id' as rall \gset
select test.login('acc_m');
select payout_mark_paid(:'rall', 'UTR200', private.office_today(), 0);
reset role;
update earnings set status = 'REVERSED', reversed_at = now() where event_ref = 'TESTPO:2';
set role authenticated;
select test.login('tm_a');
select test.check((income_summary() ->> 'available')::numeric = -2000, 'an earning reversed after payout: available is -2,000 (to be recovered)');
select test.must_fail($$select payout_request(500, 'po-req-0007')$$, 'no withdrawal while money is to be recovered', 'VALIDATION_ERROR');
reset role;
select test.po_earn('tm_a', '3', 2600);
set role authenticated;
select test.login('tm_a');
select test.check((income_summary() ->> 'available')::numeric = 600, 'new earnings recover it first (2,600 - 2,000 = 600 available)');
-- final settlement of someone who left
select test.login('acc_m');
select test.must_fail(format($$select payout_final_settlement(%L, 600, 'UTR300', private.office_today(), 0)$$, test.id('tm_a')), 'an active person is not settled', 'VALIDATION_ERROR');
reset role;
update profiles set status = 'SUSPENDED' where id = test.id('tm_a');
set role authenticated;
select test.login('acc_m');
select test.check(exists (select 1 from jsonb_array_elements(payout_leavers()) x where x ->> 'profileId' = test.id('tm_a')::text and (x ->> 'available')::numeric = 600),
  'people who left with money to come are listed');
select test.must_fail(format($$select payout_final_settlement(%L, 500, 'UTR300', private.office_today(), 0)$$, test.id('tm_a')),
  'a final settlement must be the amount Accounts saw (the balance changed meanwhile)', 'CONFLICT');
select test.check((select x ->> 'status' = 'PAID' and (x ->> 'finalSettlement')::boolean and (x ->> 'amount')::numeric = 600
                     from (select payout_final_settlement(test.id('tm_a'), 600, 'UTR300', private.office_today(), 0) x) y),
  'Accounts pays the remaining 600 as a final settlement');
select test.check(not exists (select 1 from jsonb_array_elements(payout_leavers()) x where x ->> 'profileId' = test.id('tm_a')::text), 'and they leave the list');
reset role;
update profiles set status = 'ACTIVE' where id = test.id('tm_a');
-- a person without a department (sec_user, a pending account): a company-wide expense
update earnings set status = 'EARNED', reversed_at = null where event_ref = 'TESTPO:2';
delete from payout_requests where profile_id = test.id('sec_user');
delete from payout_methods where profile_id = test.id('sec_user');
select test.po_earn('sec_user', 'sec1', 700);
insert into payout_methods (profile_id, kind, holder_name, other_details)
  values (test.id('sec_user'), 'OTHER', 'Test Abroad', 'Test Bank, IBAN GB00TEST0000000000, SWIFT TESTGB00, United Kingdom');
set role authenticated;
select test.login('acc_m');
select payout_final_settlement(test.id('sec_user'), 700, 'SWIFT-REF-1', private.office_today(), 0) ->> 'id' as rsec \gset
reset role;
select test.check((select not exists (select 1 from expense_allocations a where a.expense_id = r.expense_id) and r.expense_id is not null
                          and r.method_snapshot -> 'full' ->> 'kind' = 'OTHER'
                     from payout_requests r where r.id = :'rsec'),
  'someone without a department: the expense is company-wide (international details paid by hand)');

\echo '   review fixes: only Accounts, masked queue, reject frees the amount'
set role authenticated;
select test.login('tc_a');
select test.must_fail(format($$select payout_detail(%L)$$, (select v from po where k = 'r2')), 'a Sales member cannot open a withdrawal', 'FORBIDDEN');
select test.must_fail(format($$select payout_mark_paid(%L, 'X1', private.office_today(), 0)$$, (select v from po where k = 'r3')), 'a Sales member cannot pay', 'FORBIDDEN');
select test.must_fail(format($$select payout_reject(%L, 'no')$$, (select v from po where k = 'r3')), 'a Sales member cannot reject', 'FORBIDDEN');
select test.must_fail($$select payout_leavers()$$, 'a Sales member cannot list leavers', 'FORBIDDEN');
select test.must_fail(format($$select payout_final_settlement(%L, 1, 'X1', private.office_today(), 0)$$, test.id('sec_user')), 'a Sales member cannot settle', 'FORBIDDEN');
select test.must_fail($$select payout_counts()$$, 'a Sales member cannot count requests', 'FORBIDDEN');
select test.must_fail(format($$select payout_slip_data(%L)$$, (select v from po where k = 'r2')), 'a colleague cannot read someone''s slip', 'FORBIDDEN');
select test.login('tm_a');
select test.check((payout_slip_data((select v from po where k = 'r2')::uuid) ->> 'netAmount')::numeric = 1184.25, 'the person reads their own slip');
select (income_summary() ->> 'available')::numeric as av_before \gset
insert into po select 'r4', payout_request(500, 'po-req-0009') ->> 'id';
select test.login('acc_m');
select test.check((select x -> 'method' ->> 'accountNumber' like '••••%' from jsonb_array_elements(payout_queue('REQUESTED')) x where x ->> 'id' = (select v from po where k = 'r4')),
  'the queue shows masked details (full details only when a request is opened)');
select payout_reject((select v from po where k = 'r4')::uuid, 'Test reject');
select test.login('tm_a');
select test.check((income_summary() ->> 'available')::numeric = :av_before, 'rejecting frees the amount again');
reset role;
