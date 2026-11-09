-- =============================================================================
-- Paid leave after probation (migration 20261231000200): 2 days a month for confirmed full-time employees, carried forward, deducted once
-- on final approval, reserved while pending, audited HR corrections. Reuses sa, hr_head and tm_a from the earlier suites; adds three employees.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 132. Paid leave: accrual, carry forward, deduction'
reset role;
\i supabase/migrations/20261231000200_paid_leave_accrual.sql
\i supabase/migrations/20261231000200_paid_leave_accrual.sql

delete from leave_requests where employee_id in (select id from profiles where email like 'pl.%@example.com');
delete from hr_probation_cycles where employee_email like 'pl.%@example.com';
delete from auth.users where email like 'pl.%@example.com';
delete from test.users where name like 'pl\_%';
update paid_leave_settings set enabled = false, accrual_start_month = null, monthly_days = 2, credit_day = 1, partial_month_rule = 'NEXT_FULL_MONTH';

select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select test.create_auth_user(n, 'pl.' || substr(n, 4) || '@example.com', jsonb_build_object('full_name', 'PL ' || substr(n, 4)),
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')))
  from unnest(array['pl_conf', 'pl_prob', 'pl_wait']) n;
reset role;
select set_config('request.jwt.claims', '', false);
create or replace function test.pl_month(p_offset int) returns date language sql stable as $$ select (date_trunc('month', private.hr_today()) + make_interval(months => p_offset))::date $$;
-- a Monday at least p_weeks weeks ahead (leave dates in the future, never on a Sunday)
create or replace function test.pl_monday(p_weeks int) returns date language sql stable as $$ select (private.hr_today() + 7 * p_weeks + (8 - extract(isodow from private.hr_today())::int)) $$;
grant execute on function test.pl_month(int), test.pl_monday(int) to authenticated;
-- confirmed (approved effective date in the middle of the month three months ago), still on probation, six months done but not confirmed
insert into hr_probation_cycles (employee_key, profile_id, employee_name, employee_email, employee_code, joining_date, probation_end, status, effective_date, approved_by, approved_at)
values (test.id('pl_conf')::text, test.id('pl_conf'), 'PL conf', 'pl.conf@example.com', 'PL-1', test.pl_month(-9), test.pl_month(-3) + 9, 'APPROVED', test.pl_month(-3) + 9, test.id('sa'), now()),
       (test.id('pl_prob')::text, test.id('pl_prob'), 'PL prob', 'pl.prob@example.com', 'PL-2', private.hr_today() - 30, private.hr_today() + 150, 'PENDING', null, null, null),
       (test.id('pl_wait')::text, test.id('pl_wait'), 'PL wait', 'pl.wait@example.com', 'PL-3', private.hr_today() - 200, private.hr_today() - 17, 'PENDING', null, null, null);

\echo '   switched off until HR confirms the policy'
set role authenticated;
select test.login('pl_conf');
select test.check((select (my_paid_leave_balance() ->> 'balance')::numeric = 0 and not (my_paid_leave_balance() -> 'policy' ->> 'enabled')::boolean), 'nothing is credited while the policy is off');
select test.must_fail($$select submit_paid_leave_request('FULL_DAY', test.pl_monday(2), test.pl_monday(2), null, 'Family function')$$, 'and paid leave cannot be requested yet', 'unpaid leave');
select test.login('tm_a');
select test.must_fail($$select paid_leave_settings_set(true, 2, 1, 'NEXT_FULL_MONTH', test.pl_month(-2))$$, 'an employee cannot switch it on', 'FORBIDDEN');
select test.login('sa');
select test.must_fail($$select paid_leave_settings_set(true, 2, 1, 'NEXT_FULL_MONTH', null)$$, 'switching on needs the first month to credit (no backfill guess)', 'first month');
select paid_leave_settings_set(true, 2, 1, 'NEXT_FULL_MONTH', test.pl_month(-2));
reset role;
select test.check((select count(*) >= 1 from audit_logs where action = 'PAID_LEAVE_POLICY_SET'), 'the policy change is audited');

\echo '   who earns paid leave'
set role authenticated;
select test.login('pl_conf');
select test.check((select my_paid_leave_balance() -> 'employment' ->> 'status') = 'FULL_TIME', 'the confirmed employee is full-time');
select test.check((select (my_paid_leave_balance() ->> 'balance')::numeric = 6), 'and has 2 days for each of the three months since the first credited month');
select test.check((select (my_paid_leave_balance() ->> 'creditedThisMonth')::numeric = 2 and (my_paid_leave_balance() ->> 'carriedForward')::numeric = 4),
  'this month: 2 credited, 4 carried forward from the earlier months');
reset role;
select private.paid_leave_accrue_all();
select private.paid_leave_accrue_all();
select test.check((select count(*) = 3 from paid_leave_ledger where profile_id = test.id('pl_conf') and entry_type = 'MONTHLY_CREDIT'), 'running the accrual again creates no duplicate credit');
select test.check((select count(*) = 0 from paid_leave_ledger where profile_id = test.id('pl_conf') and entry_type = 'MONTHLY_CREDIT' and entry_month < test.pl_month(-2)),
  'nothing is credited before the first month HR chose');
set role authenticated;
select test.login('pl_prob');
select test.check((select (my_paid_leave_balance() ->> 'balance')::numeric = 0 and my_paid_leave_balance() -> 'employment' ->> 'status' = 'PROBATION'), 'an employee on probation earns nothing');
select test.must_fail($$select submit_paid_leave_request('FULL_DAY', test.pl_monday(2), test.pl_monday(2), null, 'Family function')$$, 'and cannot take paid leave', 'unpaid leave');
select test.check((select submit_leave_request('FULL_DAY', test.pl_monday(2), test.pl_monday(2), null, 'Family function') ->> 'id') is not null, 'but unpaid leave is unchanged');
select test.login('pl_wait');
select test.check((select (my_paid_leave_balance() ->> 'balance')::numeric = 0 and my_paid_leave_balance() -> 'employment' ->> 'status' = 'CONFIRMATION_PENDING'),
  'six months done but not yet confirmed: nothing (no automatic full-time)');

\echo '   a request reserves, the final approval deducts once, a rejection gives nothing up'
select test.login('pl_conf');
create temp table pl (k text primary key, id uuid);
grant all on pl to authenticated;
insert into pl select 'two', (submit_paid_leave_request('FULL_DAY', test.pl_monday(3), test.pl_monday(3) + 1, null, 'Two days off') ->> 'id')::uuid;
select test.check((select (my_paid_leave_balance() ->> 'balance')::numeric = 6 and (my_paid_leave_balance() ->> 'pendingPaidDays')::numeric = 2 and (my_paid_leave_balance() ->> 'available')::numeric = 4),
  'a waiting request is not deducted, but its 2 days are reserved');
select test.must_fail($$select submit_paid_leave_request('FULL_DAY', test.pl_monday(5), test.pl_monday(5) + 4, null, 'Five days off')$$, 'more than the available days is refused (no overbooking)', '4');
insert into pl select 'half', (submit_paid_leave_request('HALF_DAY', test.pl_monday(6), null, 'MORNING', 'Doctor') ->> 'id')::uuid;
select test.check((select (my_paid_leave_balance() ->> 'available')::numeric = 3.5), 'a half day reserves half a day');
insert into pl select 'rej', (submit_paid_leave_request('FULL_DAY', test.pl_monday(8), test.pl_monday(8), null, 'One day') ->> 'id')::uuid;
reset role;
-- the approvers' decisions (the chain itself is tested in leave_multi_level_test): any path that ends in APPROVED deducts
update leave_requests set status = 'APPROVED' where id = (select id from pl where k = 'two');
update leave_requests set status = 'APPROVED', updated_at = now() where id = (select id from pl where k = 'two');
update leave_requests set status = 'APPROVED' where id = (select id from pl where k = 'half');
update leave_requests set status = 'REJECTED_BY_HR' where id = (select id from pl where k = 'rej');
select test.check((select count(*) = 1 and sum(days) = -2 from paid_leave_ledger where leave_request_id = (select id from pl where k = 'two')), 'the approved 2-day leave is deducted exactly once');
select test.check((select sum(days) = -0.5 from paid_leave_ledger where leave_request_id = (select id from pl where k = 'half')), 'the approved half day deducts 0.5');
select test.check(not exists (select 1 from paid_leave_ledger where leave_request_id = (select id from pl where k = 'rej')), 'the rejected request consumed nothing');
select test.must_fail($$update leave_requests set status = 'PENDING_HR' where id = (select id from pl where k = 'two')$$, 'a deducted leave cannot silently leave Approved', 'correction');
set role authenticated;
select test.login('pl_conf');
select test.check((select (my_paid_leave_balance() ->> 'balance')::numeric = 3.5 and (my_paid_leave_balance() ->> 'pendingPaidDays')::numeric = 0
                     and (my_paid_leave_balance() ->> 'available')::numeric = 3.5 and (my_paid_leave_balance() ->> 'totalUsed')::numeric = 2.5),
  '6 credited - 2.5 used = 3.5, nothing reserved any more');
select test.check((select count(*) = 0 from paid_leave_ledger where profile_id <> test.id('pl_conf')), 'the employee reads only their own entries');

\echo '   HR corrections, append-only, the same figures for HR and the employee'
select test.login('tm_a');
select test.must_fail($$select hr_paid_leave_adjust(test.id('pl_conf'), 'CORRECTION', 1, 'Missed credit for March')$$, 'only HR corrects', 'FORBIDDEN');
select test.must_fail($$select hr_paid_leave_balances()$$, 'and only HR lists balances', 'FORBIDDEN');
select test.login('hr_head');
select test.must_fail($$select hr_paid_leave_adjust(test.id('pl_conf'), 'CORRECTION', 1, 'x')$$, 'a correction needs a reason', 'reason');
select test.must_fail($$select hr_paid_leave_adjust(test.id('pl_conf'), 'CORRECTION', 0.3, 'Missed credit for March')$$, 'whole or half days only', 'half days');
select test.must_fail($$select hr_paid_leave_adjust(test.id('hr_head'), 'CORRECTION', 1, 'My own balance')$$, 'nobody corrects their own balance', 'FORBIDDEN');
select hr_paid_leave_adjust(test.id('pl_conf'), 'CORRECTION', 1, 'Missed credit for an earlier month');
select hr_paid_leave_adjust(test.id('pl_conf'), 'OPENING_BALANCE', 2, 'Balance carried over from the earlier HR sheet');
select test.must_fail($$select hr_paid_leave_adjust(test.id('pl_conf'), 'OPENING_BALANCE', 2, 'Balance carried over again')$$, 'one opening balance per employee', 'already has an opening balance');
select test.check((select (hr_paid_leave_detail(test.id('pl_conf')) ->> 'balance')::numeric = 6.5), 'HR sees 3.5 + 1 + 2 = 6.5');
select test.check((select x ->> 'fullName' = 'PL conf' and (x ->> 'balance')::numeric = 6.5 from jsonb_array_elements(hr_paid_leave_balances('PL conf') -> 'items') x), 'and in the HR list');
select test.login('pl_conf');
select test.check((select (my_paid_leave_balance() ->> 'balance')::numeric = 6.5), 'the employee sees the same 6.5');
reset role;
select test.check((select count(*) = 2 from audit_logs where action in ('PAID_LEAVE_CORRECTION', 'PAID_LEAVE_OPENING_BALANCE') and entity_id = test.id('pl_conf')), 'every HR change is audited');
select test.must_fail($$update paid_leave_ledger set days = 10 where profile_id = test.id('pl_conf')$$, 'a ledger entry is never changed', 'never changed');
select test.must_fail($$delete from paid_leave_ledger where profile_id = test.id('pl_conf')$$, 'or removed', 'never changed');

\echo '   confirmation date corrections and inactive employees'
insert into pl select 'cycle', id from hr_probation_cycles where profile_id = test.id('pl_conf');
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select hr_confirmation_effective_date_set((select id from pl where k = 'cycle'), test.pl_month(-1), 'Corrected date')$$,
  'only the people who confirm may change the confirmation date', 'FORBIDDEN|not found');
select test.login('sa');
select hr_confirmation_effective_date_set((select id from pl where k = 'cycle'), test.pl_month(-1) + 3, 'Confirmation letter dated later');
reset role;
select test.check((select count(*) = 3 from paid_leave_ledger where profile_id = test.id('pl_conf') and entry_type = 'MONTHLY_CREDIT'), 'credits already given stay (no past record changes silently)');
select test.check((select count(*) = 1 from audit_logs where action = 'EMPLOYEE_CONFIRMATION_DATE_CHANGED' and entity_id = (select id from pl where k = 'cycle')
                     and (metadata ->> 'after')::date = test.pl_month(-1) + 3), 'the date change is audited (before and after)');
update profiles set status = 'SUSPENDED' where id = test.id('pl_conf');
select test.check(private.paid_leave_first_month(test.id('pl_conf')) is null and private.paid_leave_accrue(test.id('pl_conf')) = 0, 'an inactive employee earns nothing more');
update profiles set status = 'ACTIVE' where id = test.id('pl_conf');
update paid_leave_settings set enabled = false;
