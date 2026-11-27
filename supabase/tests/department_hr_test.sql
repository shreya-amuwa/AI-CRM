-- =============================================================================
-- Department HR ("HR (Digitree)") and the probation confirmation that completes only after the e-mail is sent (migration 20270223000100).
-- Runs after rls_test.sql (fixtures: sa, hr_head, dh_wab, th_wab, tm_a ...) on the same database. No e-mail is sent: the queue is driven directly.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- Department HR (HR Digitree) and confirmation after the e-mail'
reset role;
-- earlier suites re-run older migrations (which redefine the dashboard trigger): apply this one again, twice (it must be safe to re-run)
\i supabase/migrations/20270223000100_department_hr_and_confirmation_email.sql
\i supabase/migrations/20270223000100_department_hr_and_confirmation_email.sql
select set_config('request.jwt.claims', '', false);

select test.check((select division = 'GENERAL' from teams where id = test.team('digitree', 'Digitree HR')), 'Digitree has its own General "Digitree HR" team');

-- the Digitree HR member, created as the Super Admin's form does (Team Member of the Digitree HR team, designation Department HR)
select test.create_auth_user('dhr_dig', 'dhr.dig@amuwa.com', '{"full_name":"Digi HR"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('digitree', 'Digitree HR')));
insert into employee_personal_details (profile_id, designation, joining_date) values (test.id('dhr_dig'), 'Department HR', date '2025-01-01');
select test.check((select hr_sub_role = 'HR_DEPARTMENT' and default_dashboard = 'hr-department' and department_id = test.dept('digitree') and role = 'TEAM_MEMBER'
                     from profiles where id = test.id('dhr_dig')), 'the designation makes them Digitree''s HR: department Digitree, the department HR dashboard');

-- a Digitree Department Head (the overdue reminder goes to them) unless one is already active
do $$
begin
  if not exists (select 1 from profiles where department_id = test.dept('digitree') and role = 'DEPARTMENT_HEAD' and status = 'ACTIVE') then
    perform test.create_auth_user('dh_dig', 'dh.dig@amuwa.com', '{"full_name":"Digi Head"}',
      jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('digitree')));
  end if;
end $$;

-- employees: two in Digitree, one in Wabastore
select test.create_auth_user('dig_emp1', 'dig.emp1@amuwa.com', '{"full_name":"Digi One"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('digitree', 'Sales')));
select test.create_auth_user('dig_emp2', 'dig.emp2@amuwa.com', '{"full_name":"Digi Two"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('digitree', 'Sales')));
select test.create_auth_user('wab_emp9', 'wab.emp9@amuwa.com', '{"full_name":"Waba Nine"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
insert into employee_personal_details (profile_id, joining_date, blood_group)
values (test.id('dig_emp1'), private.hr_today() - 200, 'O+'), (test.id('dig_emp2'), private.hr_today() - 200, 'A+'), (test.id('wab_emp9'), private.hr_today() - 200, 'B+');

-- probation cycles (as hr_schedule_emails opens them): two overdue in Digitree, one overdue in Wabastore, one not yet due in Digitree
insert into hr_probation_cycles (employee_key, profile_id, employee_name, employee_email, employee_code, department_id, department_name, joining_date, probation_end)
values (test.id('dig_emp1')::text, test.id('dig_emp1'), 'Digi One', 'dig.emp1@amuwa.com', 'DIG-1', test.dept('digitree'), 'Digitree Infotech', private.hr_today() - 200, private.hr_today() - 10),
       (test.id('dig_emp2')::text, test.id('dig_emp2'), 'Digi Two', 'dig.emp2@amuwa.com', 'DIG-2', test.dept('digitree'), 'Digitree Infotech', private.hr_today() - 200, private.hr_today() - 5),
       (test.id('wab_emp9')::text, test.id('wab_emp9'), 'Waba Nine', 'wab.emp9@amuwa.com', 'WAB-9', test.dept('wabastore'), 'Wabastore', private.hr_today() - 200, private.hr_today() - 10),
       ('HR:DIG-LATER', null, 'Digi Later', 'dig.later@amuwa.com', 'DIG-L', test.dept('digitree'), 'Digitree Infotech', private.hr_today() - 100, private.hr_today() + 80);
create temp table tm as select 'hr' as k, test.team('digitree', 'Digitree HR') as id union all select 'sales', test.team('digitree', 'Sales')
  union all select 'hrdept', (select t.id from teams t where t.department_id = test.dept('hr') order by t.created_at limit 1);
grant all on tm to authenticated;
create or replace function test.tm(p text) returns uuid language sql as $$ select id from tm where k = p $$;
grant execute on function test.tm(text) to authenticated;
create temp table dig_ids as select id from profiles where department_id = test.dept('digitree');
grant all on dig_ids to authenticated;
create temp table dc as select employee_name as n, id from hr_probation_cycles where employee_name in ('Digi One', 'Digi Two', 'Waba Nine', 'Digi Later');
grant all on dc to authenticated;
create or replace function test.dc(p text) returns uuid language sql as $$ select id from dc where n = p $$;
grant execute on function test.dc(text) to authenticated;

-- ---------------------------------------------------------------- the Digitree HR sees Digitree only
\echo '   Digitree HR: Digitree only'
set role authenticated;
select test.login('dhr_dig');
select test.check(not private.is_hr_staff(), 'Digitree HR is not company-wide HR staff');
select test.check((select bool_and(e ->> 'departmentSlug' = 'digitree') and bool_or(e ->> 'name' = 'Digi One') and not bool_or(e ->> 'name' = 'Waba Nine')
                     from jsonb_array_elements(hr_employee_directory() -> 'employees') e), 'the employee directory lists Digitree employees only');
select test.check((select count(*) = 1 and bool_and(d ->> 'slug' = 'digitree') from jsonb_array_elements(hr_employee_directory() -> 'departments') d), 'and only the Digitree department');
select test.check((select bool_and((x ->> 'profileId')::uuid in (select id from dig_ids)) and bool_or(x ->> 'profileId' = test.id('dig_emp1')::text)
                          and not bool_or(x ->> 'profileId' = test.id('wab_emp9')::text)
                     from jsonb_array_elements(hr_personal_details()) x), 'personal details: Digitree employees only');
select test.check((select bool_and(c ->> 'department' = 'Digitree Infotech') and count(*) = 3 from jsonb_array_elements(hr_probation_list()) c), 'probation confirmations: Digitree only');
select test.must_fail($$select hr_probation_get(test.dc('Waba Nine'))$$, 'another department''s confirmation cannot be read by its id', 'NOT_FOUND');
select test.must_fail($$select hr_confirm_probation(test.dc('Waba Nine'))$$, 'nor confirmed', 'FORBIDDEN');
select test.must_fail($$select hr_dismiss_probation(test.dc('Waba Nine'), 'not mine at all')$$, 'nor closed', 'FORBIDDEN');
select test.must_fail($$select hr_probation_retry_email(test.dc('Waba Nine'))$$, 'nor its e-mail retried', 'FORBIDDEN');
select test.must_fail($$select hr_probation_remind_overdue(test.dc('Waba Nine'))$$, 'nor reminded', 'FORBIDDEN');
-- a department header is not a way in (it only ever applies to Department Heads, and never grants anything)
select set_config('request.headers', json_build_object('x-active-department', test.dept('wabastore'))::text, false);
select test.check((select bool_and(c ->> 'department' = 'Digitree Infotech') from jsonb_array_elements(hr_probation_list()) c)
                  and (select bool_and(e ->> 'departmentSlug' = 'digitree') from jsonb_array_elements(hr_employee_directory() -> 'employees') e),
  'an X-Active-Department header naming Wabastore changes nothing');
select set_config('request.headers', '', false);
-- the company-wide HR functions stay closed to them
select test.must_fail($$select hr_email_overview()$$, 'the company-wide e-mail overview is refused', 'FORBIDDEN');
select test.must_fail($$select hr_email_history(null, null, 10, 0)$$, 'the company-wide e-mail history is refused', 'FORBIDDEN');
select test.must_fail($$select hr_paid_leave_balances(null)$$, 'company-wide paid leave balances are refused', 'FORBIDDEN');
select test.check((select count(*) = 0 from hr_employees), 'the HR records table shows them nothing directly');

-- ---------------------------------------------------------------- who else sees what
\echo '   other HR members, the Super Admin, others'
select test.login('hr_head');
select test.check(private.is_hr_staff(), 'the existing HR head (Payal) is still company-wide HR staff');
select test.check((select bool_or(c ->> 'department' = 'Digitree Infotech') and bool_or(c ->> 'department' = 'Wabastore') from jsonb_array_elements(hr_probation_list()) c),
  'she sees Digitree''s confirmations and keeps every other department''s');
select test.check((select count(*) > 1 and bool_or(d ->> 'slug' = 'digitree') from jsonb_array_elements(hr_employee_directory() -> 'departments') d),
  'and the whole directory, Digitree included');
select test.check((hr_probation_get(test.dc('Digi One')) ->> 'canDecide')::boolean, 'and may decide a Digitree confirmation');
select test.login('sa');
select test.check((select bool_or(c ->> 'department' = 'Digitree Infotech') and bool_or(c ->> 'department' = 'Wabastore') from jsonb_array_elements(hr_probation_list()) c),
  'the Super Admin sees every department');
select test.login('dig_emp2');
select test.must_fail($$select hr_probation_list()$$, 'a Digitree sales member cannot read the confirmations', 'FORBIDDEN');
select test.must_fail($$select hr_employee_directory()$$, 'nor the directory', 'FORBIDDEN');

-- ---------------------------------------------------------------- only the Super Admin gives the designation
\echo '   creating a Department HR'
select test.login('dh_wab');
select test.must_fail($$select assert_designation_allowed(null, test.tm('hr'), 'TEAM_MEMBER', 'Department HR')$$, 'a Department Head cannot create a department HR member', 'FORBIDDEN');
select test.login('sa');
select assert_designation_allowed(null, test.tm('hr'), 'TEAM_MEMBER', 'Department HR');
select test.check(true, 'the Super Admin can, in the department''s HR team');
select test.must_fail($$select assert_designation_allowed(null, test.tm('sales'), 'TEAM_MEMBER', 'Department HR')$$, 'not in a Sales team', 'HR team');
select test.must_fail($$select assert_designation_allowed(test.dept('digitree'), null, 'DEPARTMENT_HEAD', 'Department HR')$$, 'and only as a Team Member', 'Team Member');
select test.must_fail($$select assert_designation_allowed(null, test.tm('hrdept'), 'TEAM_MEMBER', 'Department HR')$$,
  'never inside the HR department itself', 'not in HR');
reset role;
select test.login('dh_wab');
select test.must_fail($$update employee_personal_details set designation = 'Department HR' where profile_id = test.id('dig_emp2')$$,
  'a signed-in non-Super Admin cannot turn someone into a department HR member', 'FORBIDDEN');
select set_config('request.jwt.claims', '', false);
select test.check((select hr_sub_role is null and default_dashboard <> 'hr-department' from profiles where id = test.id('dig_emp2')), 'and nothing changed');

-- ---------------------------------------------------------------- overdue action, confirm, e-mail failure, retry, success
\echo '   confirmation only after the e-mail'
set role authenticated;
select test.login('dhr_dig');
select test.check((hr_probation_get(test.dc('Digi One')) ->> 'overdue')::boolean and (hr_probation_get(test.dc('Digi One')) ->> 'canDecide')::boolean,
  'the overdue Digitree employee is listed as overdue, and Digitree HR may decide it');
select test.check((hr_probation_remind_overdue(test.dc('Digi One')) ->> 'reminded')::int >= 1, 'the overdue reminder reaches the Digitree Department Head');
reset role;
select test.check((select count(*) >= 1 from notifications n join profiles p on p.id = n.recipient_id
                    where n.type = 'HR_PROBATION_OVERDUE' and n.entity_id = test.dc('Digi One') and p.role = 'DEPARTMENT_HEAD' and p.department_id = test.dept('digitree')),
  'as a CRM notification');
select test.check((select status = 'PENDING' and overdue_reminded_at is not null from hr_probation_cycles where id = test.dc('Digi One')), 'the reminder confirms nobody');
set role authenticated;
select test.login('dhr_dig');
select test.must_fail($$select hr_probation_remind_overdue(test.dc('Digi Later'))$$, 'a confirmation that is not overdue cannot be reminded', 'overdue');
select test.must_fail($$select hr_probation_retry_email(test.dc('Digi One'))$$, 'there is no e-mail to retry before Confirm', 'Confirm the employee first');

create temp table c1 as select hr_confirm_probation(test.dc('Digi One'), null, 'Reviewed') as j;
select test.check((select j ->> 'status' = 'CONFIRMING' and (j ->> 'overdue')::boolean and j -> 'email' ->> 'status' = 'PENDING' from c1),
  'Confirm starts the confirmation: not confirmed yet, still overdue, the e-mail is queued');
select test.must_fail($$select hr_confirm_probation(test.dc('Digi One'))$$, 'a second Confirm (double click) is refused', 'already in progress');
reset role;
select test.check((select count(*) = 1 from hr_email_events where event_key = 'CONFIRMATION_EMPLOYEE:' || test.dc('Digi One') and send_after <= now()),
  'one employee e-mail, due at once because the probation has ended');

-- the e-mail fails
select test.check((select count(*) >= 1 from jsonb_array_elements(hr_email_claim_cycle(test.dc('Digi One'), 'live')) e where e ->> 'kind' = 'CONFIRMATION_EMPLOYEE'), 'the server claims the cycle''s e-mail');
select test.check(jsonb_array_length(hr_email_claim_cycle(test.dc('Digi One'), 'live')) = 0, 'a second sender gets nothing (no duplicate send)');
select hr_email_finish(id, 'FAILED', 'Provider refused (422)') from hr_email_events where cycle_id = test.dc('Digi One') and kind = 'CONFIRMATION_EMPLOYEE';
select hr_email_finish(id, 'SENT', 'ok') from hr_email_events where cycle_id = test.dc('Digi One') and kind = 'CONFIRMATION_HR' and status = 'SENDING';
set role authenticated;
select test.login('dhr_dig');
select test.check((select c ->> 'status' = 'CONFIRMING' and (c ->> 'overdue')::boolean and c -> 'email' ->> 'status' = 'FAILED' and c -> 'email' ->> 'error' ~ '422'
                     from jsonb_array_elements(hr_probation_list()) c where c ->> 'id' = test.dc('Digi One')::text),
  'a failed e-mail keeps the employee unconfirmed and in the overdue list, with the error');
reset role;
select test.check((select status = 'CONFIRMING' from hr_probation_cycles where id = test.dc('Digi One'))
                  and (select count(*) = 0 from audit_logs where action = 'EMPLOYEE_CONFIRMED' and entity_id = test.dc('Digi One')), 'nobody is confirmed prematurely');

-- retry: the same e-mail row again, then it is sent
set role authenticated;
select test.login('dhr_dig');
select test.check(hr_probation_retry_email(test.dc('Digi One')) -> 'email' ->> 'status' = 'PENDING', 'Retry re-queues the confirmation e-mail');
reset role;
select test.check((select count(*) = 1 and bool_and(attempts = 0) from hr_email_events where event_key = 'CONFIRMATION_EMPLOYEE:' || test.dc('Digi One')),
  'the retry reuses the same e-mail (no second confirmation e-mail)');
select hr_email_finish((e ->> 'id')::uuid, 'SENT', 'ok') from jsonb_array_elements(hr_email_claim_cycle(test.dc('Digi One'), 'live')) e;
select test.check((select status = 'APPROVED' from hr_probation_cycles where id = test.dc('Digi One')), 'once the e-mail is sent the employee is confirmed');
select test.check((select count(*) = 1 from audit_logs where action = 'EMPLOYEE_CONFIRMED' and entity_id = test.dc('Digi One')), 'and audited as confirmed, once');
set role authenticated;
select test.login('dhr_dig');
select test.check((select c ->> 'status' = 'APPROVED' and not (c ->> 'overdue')::boolean and c -> 'email' ->> 'status' = 'SENT'
                     from jsonb_array_elements(hr_probation_list()) c where c ->> 'id' = test.dc('Digi One')::text),
  'it leaves the overdue list');
select test.check(hr_probation_retry_email(test.dc('Digi One')) ->> 'status' = 'APPROVED', 'a late Retry click changes nothing');
reset role;
select test.check((select count(*) = 1 from hr_email_events where event_key = 'CONFIRMATION_EMPLOYEE:' || test.dc('Digi One') and status = 'SENT'), 'still one e-mail');
select test.check(jsonb_array_length(hr_email_claim_cycle(test.dc('Digi One'), 'live')) = 0, 'and nothing more to send');

-- a confirmation whose e-mail never goes out can be closed: its e-mails are dropped
set role authenticated;
select test.login('dhr_dig');
select test.check(hr_confirm_probation(test.dc('Digi Two')) ->> 'status' = 'CONFIRMING', 'the second Digitree employee is being confirmed');
select test.check(hr_dismiss_probation(test.dc('Digi Two'), 'Left before the e-mail went out') ->> 'status' = 'DISMISSED', 'and can still be closed');
reset role;
select test.check((select bool_and(status = 'SKIPPED') from hr_email_events where cycle_id = test.dc('Digi Two')), 'its unsent e-mails are dropped');
select test.check(jsonb_array_length(hr_email_claim_cycle(test.dc('Digi Two'), 'live')) = 0, 'nothing is sent for a closed confirmation');

-- the Department HR person cannot decide their own confirmation
insert into hr_probation_cycles (employee_key, profile_id, employee_name, employee_email, employee_code, department_id, department_name, joining_date, probation_end)
values (test.id('dhr_dig')::text, test.id('dhr_dig'), 'Digi HR', 'dhr.dig@amuwa.com', 'DIG-HR', test.dept('digitree'), 'Digitree Infotech', private.hr_today() - 200, private.hr_today() - 3);
insert into dc select 'Digi HR', id from hr_probation_cycles where employee_key = test.id('dhr_dig')::text;
set role authenticated;
select test.login('dhr_dig');
select test.must_fail($$select hr_confirm_probation(test.dc('Digi HR'))$$, 'nobody confirms themselves', 'FORBIDDEN');
reset role;
select set_config('request.jwt.claims', '', false);

-- clean up: later suites re-run older migrations whose designation check does not know 'Department HR' yet
delete from hr_probation_cycles where id in (select id from dc);
delete from auth.users where id in (select id from test.users where name in ('dhr_dig', 'dig_emp1', 'dig_emp2', 'wab_emp9', 'dh_dig'));
select test.check((select count(*) = 0 from employee_personal_details where designation = 'Department HR'), 'the test leaves no Department HR behind');

\echo '=== DEPARTMENT HR TESTS PASSED ==='
