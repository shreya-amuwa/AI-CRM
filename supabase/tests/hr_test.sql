-- =============================================================================
-- HR: attendance timing, personal details, leave approval (Department Head -> HR), monthly totals, notifications
-- (migration 20261027000100). Runs after the other suites (same database, reuses the `test` helpers and users).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

\echo '--- 31. HR: attendance, leave approval, monthly totals, notifications'
reset role;
create temp table hrn as select 0 as n;
grant all on hrn to authenticated, service_role;

-- ---------------------------------------------------------------- attendance: the RM login is the first of the day
set role authenticated;
select test.login('tm_a');
select record_rm_login();
select pg_sleep(0.05);
select record_rm_login();
reset role;
select test.check((select count(*) = 1 and bool_and(rm_login_at is not null) and bool_and(biometric_login_at is null) from attendance_records
                    where profile_id = test.id('tm_a') and attendance_date = private.office_today()), 'the CRM login of the day is recorded once for the employee');
select test.check((select updated_at > rm_login_at from attendance_records where profile_id = test.id('tm_a') and attendance_date = private.office_today()),
  'a second login the same day keeps the first time');
select test.check((select count(*) = 0 from attendance_records where profile_id = test.id('dir_pend')), 'a revoked account records nothing');
set role authenticated;
select test.login('dir_pend');
select record_rm_login();
reset role;
select test.check((select count(*) = 0 from attendance_records where profile_id = test.id('dir_pend')), 'and a revoked account cannot record a login');

-- ---------------------------------------------------------------- the time difference (whole minutes, > 15 is a discrepancy)
insert into attendance_records (profile_id, attendance_date, rm_login_at, biometric_login_at) values
  (test.id('tm_a'), '2026-01-15', '2026-01-15 09:00+05:30', '2026-01-15 09:08+05:30'),     -- 8
  (test.id('tm_d1'), '2026-01-15', '2026-01-15 09:00+05:30', '2026-01-15 09:15+05:30'),     -- exactly 15: normal
  (test.id('tm_s2'), '2026-01-15', '2026-01-15 09:00+05:30', '2026-01-15 09:22+05:30'),    -- 22: warning
  (test.id('ov_m1'), '2026-01-15', '2026-01-15 09:20+05:30', '2026-01-15 09:00+05:30'), -- biometric earlier: 20, warning
  (test.id('ov_m2'), '2026-01-15', '2026-01-15 09:00+05:30', null),                     -- missing: no difference
  (test.id('ov_s1'), '2026-01-15', null, '2026-01-15 09:05+05:30'),                     -- missing RM
  (test.id('sup_b'), '2026-01-15', '2026-01-15 23:55+05:30', '2026-01-16 00:10+05:30'), -- across midnight: 15, normal
  (test.id('sup_plain'), '2026-01-15', '2026-01-15 23:50+05:30', '2026-01-16 00:10+05:30'), -- across midnight: 20, warning
  (test.id('tc_new'), '2026-01-15', '2026-01-15 09:00:59+05:30', '2026-01-15 09:15:59+05:30'); -- seconds ignored: 15
create temp table att as select null::jsonb as j;
grant all on att to authenticated;
set role authenticated;
select test.login('hr_head');
update att set j = hr_attendance('2026-01-15');
select test.check((select count(*) = 9 from att, jsonb_array_elements(j -> 'rows')), 'HR sees the attendance of the chosen day');
select test.check((select (r ->> 'diffMinutes')::int = 8 and (r ->> 'discrepancy')::boolean = false
                     from att, jsonb_array_elements(j -> 'rows') r where r ->> 'email' = 'a@amuwa.com'), '8 minutes is a normal difference');
select test.check((select (r ->> 'diffMinutes')::int = 15 and (r ->> 'discrepancy')::boolean = false
                     from att, jsonb_array_elements(j -> 'rows') r where r ->> 'email' = 'delivery.member@amuwa.com'), 'exactly 15 minutes is still normal');
select test.check((select (r ->> 'diffMinutes')::int = 22 and (r ->> 'discrepancy')::boolean
                     from att, jsonb_array_elements(j -> 'rows') r where r ->> 'email' = 's2@amuwa.com'), '22 minutes is a discrepancy');
select test.check((select (r ->> 'diffMinutes')::int = 20 and (r ->> 'discrepancy')::boolean
                     from att, jsonb_array_elements(j -> 'rows') r where r ->> 'email' = 'ov.m1@amuwa.com'), 'the same when the biometric punch is the earlier one');
select test.check((select r -> 'diffMinutes' = 'null'::jsonb and (r ->> 'discrepancy')::boolean = false
                     from att, jsonb_array_elements(j -> 'rows') r where r ->> 'email' = 'ov.m2@amuwa.com'), 'a missing biometric punch gives no difference');
select test.check((select r -> 'diffMinutes' = 'null'::jsonb from att, jsonb_array_elements(j -> 'rows') r where r ->> 'email' = 'ov.s1@amuwa.com'), 'nor does a missing CRM login');
select test.check((select (r ->> 'diffMinutes')::int = 15 and not (r ->> 'discrepancy')::boolean
                     from att, jsonb_array_elements(j -> 'rows') r where r ->> 'email' = 'sup.b@amuwa.com'), 'across midnight: 23:55 to 00:10 is 15 minutes');
select test.check((select (r ->> 'diffMinutes')::int = 20 and (r ->> 'discrepancy')::boolean
                     from att, jsonb_array_elements(j -> 'rows') r where r ->> 'email' = 'sup.plain@amuwa.com'), 'across midnight: 23:50 to 00:10 is 20 minutes');
select test.check((select (r ->> 'diffMinutes')::int = 15 and not (r ->> 'discrepancy')::boolean
                     from att, jsonb_array_elements(j -> 'rows') r where r ->> 'email' = 'tc.new@amuwa.com'), 'seconds do not tip a difference over the limit');
select test.login('tm_a');
select test.must_fail($$select hr_attendance('2026-01-15')$$, 'an ordinary employee cannot read attendance', 'Only HR staff');
select test.login('dh_wab');
select test.must_fail($$select hr_attendance('2026-01-15')$$, 'nor can another department''s head', 'Only HR staff');
select test.must_fail($$select * from attendance_records$$, 'the table is not readable directly', 'permission denied');
select test.login('hr_head');
-- the Super Admin corrects a punch by hand (HR is told; the person making the change is not)
select test.login('sa');
select hr_record_punch(test.id('ov_m2'), 'BIOMETRIC', '2026-01-15 09:40+05:30');
select test.login('hr_head');
update att set j = hr_attendance('2026-01-15');
select test.check((select (r ->> 'diffMinutes')::int = 40 and (r ->> 'discrepancy')::boolean
                     from att, jsonb_array_elements(j -> 'rows') r where r ->> 'email' = 'ov.m2@amuwa.com'), 'a manual punch updates the difference');
select test.login('tm_a');
select test.must_fail($$select hr_record_punch(test.id('tm_a'), 'RM', now())$$, 'an employee cannot edit attendance', 'Only HR staff');
select test.login('hr_head');
select test.must_fail($$select hr_record_punch(test.id('tm_a'), 'RM', now() + interval '2 hours')$$, 'a punch in the future is refused', 'not be in the future|not in the future');

-- ---------------------------------------------------------------- biometric punches (service role only)
reset role;
select test.check((select record_biometric_punch('a@amuwa.com', '2026-02-02 09:02+05:30') = 'RECORDED'), 'a biometric punch is recorded for the employee');
select test.check((select record_biometric_punch('a@amuwa.com', '2026-02-02 09:30+05:30') = 'RECORDED'
                     and (select biometric_login_at = '2026-02-02 09:02+05:30' from attendance_records where profile_id = test.id('tm_a') and attendance_date = '2026-02-02')),
  'the first punch of the day counts');
select test.check((select record_biometric_punch('nobody@amuwa.com', now()) = 'UNKNOWN_EMPLOYEE'), 'an unknown e-mail is refused');
select test.check((select record_biometric_punch('dir.pending@amuwa.com', now()) = 'UNKNOWN_EMPLOYEE'), 'and so is an inactive employee');
set role authenticated;
select test.login('hr_head');
select test.must_fail($$select record_biometric_punch('a@amuwa.com', now())$$, 'a signed-in user cannot post a biometric punch', 'permission denied');

-- ---------------------------------------------------------------- the discrepancy reaches HR once
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('hr_head') and type = 'ATTENDANCE_GAP' and data ->> 'employeeId' = test.id('ov_m2')::text and (data ->> 'minutes')::int = 40),
  'HR is told when a manual punch makes the difference 40 minutes');
select test.check((select count(*) = 0 from notifications where recipient_id = test.id('hr_head') and type = 'ATTENDANCE_GAP' and data ->> 'employeeId' = test.id('tm_a')::text),
  'and not about a normal one');
select set_config('request.jwt.claims', '', false); -- the nightly / device path has no signed-in user
select private.check_attendance_gap((select id from attendance_records where profile_id = test.id('tm_s2') and attendance_date = '2026-01-15'));
select private.check_attendance_gap((select id from attendance_records where profile_id = test.id('tm_s2') and attendance_date = '2026-01-15'));
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('hr_head') and type = 'ATTENDANCE_GAP' and data ->> 'employeeId' = test.id('tm_s2')::text and (data ->> 'minutes')::int = 22),
  'a 22 minute discrepancy notifies HR, and processing the same event again does not notify twice');
select test.check((select count(*) = 0 from notifications where type = 'ATTENDANCE_GAP' and recipient_id = test.id('tm_a')), 'employees are not sent HR attendance alerts');

-- ---------------------------------------------------------------- leave: submission
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select submit_leave_request('FULL_DAY', '2026-11-04', '2026-11-02', null, 'trip')$$, 'the end date cannot be before the start', 'cannot be before');
select test.must_fail($$select submit_leave_request('HALF_DAY', '2026-11-10', null, null, 'dentist')$$, 'a half day needs the morning or the afternoon', 'morning or the afternoon');
select test.must_fail($$select submit_leave_request('FULL_DAY', '2026-11-02', '2026-11-04', null, '')$$, 'a reason is required', 'reason');
create temp table lv as select null::uuid as a, null::uuid as b, null::uuid as c, null::uuid as d, null::uuid as e;
grant all on lv to authenticated;
update lv set a = (submit_leave_request('FULL_DAY', '2026-11-02', '2026-11-04', null, 'Family function') ->> 'id')::uuid;
reset role;
select test.check((select status = 'PENDING_DEPARTMENT_HEAD' and employee_id = test.id('tm_a') and department_id = (select department_id from profiles where id = test.id('tm_a'))
                     from leave_requests where id = (select a from lv)), 'a new request waits for the Department Head');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('dh_wab') and type = 'LEAVE_AWAITING_DEPARTMENT_HEAD' and entity_id = (select a from lv)),
  'the Department Head is notified');
select test.check((select count(*) = 0 from notifications where type like 'LEAVE_AWAITING%' and entity_id = (select a from lv) and recipient_id in (test.id('hr_head'), test.id('dh_acc'), test.id('th_wab'))),
  'HR, another department''s head and the Team Lead are not');
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select submit_leave_request('FULL_DAY', '2026-11-03', '2026-11-03', null, 'again')$$, 'overlapping requests are refused', 'already have a leave request');

-- ---------------------------------------------------------------- leave: who may decide, and in which order
select test.must_fail($$select decide_leave_department_head((select a from lv), true, null)$$, 'an employee cannot approve their own leave', 'not found');
select test.must_fail($$select decide_leave_hr((select a from lv), true, null)$$, 'nor give HR approval', 'Only HR');
select test.login('th_wab');
select test.must_fail($$select decide_leave_department_head((select a from lv), true, null)$$, 'a Team Lead is not the approver', 'not found');
select test.login('dh_acc');
select test.must_fail($$select decide_leave_department_head((select a from lv), true, null)$$, 'another department''s head cannot decide', 'not found');
select test.login('hr_head');
select test.must_fail($$select decide_leave_department_head((select a from lv), true, null)$$, 'HR cannot take the Department Head''s step', 'not found');
select test.must_fail($$select decide_leave_hr((select a from lv), true, null)$$, 'HR cannot finalize before the Department Head approved', 'has not approved');
select test.login('dh_wab');
select test.must_fail($$select decide_leave_hr((select a from lv), true, null)$$, 'a Department Head is not HR', 'Only HR');
select test.must_fail($$select decide_leave_department_head((select a from lv), false, '')$$, 'a rejection needs a reason', 'reason');
select decide_leave_department_head((select a from lv), true, 'Fine');
select test.must_fail($$select decide_leave_department_head((select a from lv), true, 'again')$$, 'a request cannot be decided twice', 'already been decided');
reset role;
select test.check((select status = 'PENDING_HR' and dh_decided_by = test.id('dh_wab') and dh_decided_at is not null and dh_note = 'Fine' from leave_requests where id = (select a from lv)),
  'approval by the Department Head forwards it to HR and records who, when and the note');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('hr_head') and type = 'LEAVE_AWAITING_HR' and entity_id = (select a from lv)), 'HR is notified that it needs their approval');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and type = 'LEAVE_DEPARTMENT_HEAD_APPROVED' and entity_id = (select a from lv)), 'the employee is told it moved on');
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select decide_leave_hr((select a from lv), true, null)$$, 'the employee still cannot approve it', 'Only HR');
select test.login('hr_head');
select test.check((select count(*) = 1 from jsonb_array_elements(leave_requests_to_review() -> 'awaiting') r where r ->> 'id' = (select a::text from lv)), 'HR sees it once the Department Head approved');
select decide_leave_hr((select a from lv), true, null);
select test.must_fail($$select decide_leave_hr((select a from lv), true, null)$$, 'HR cannot approve it twice', 'already been decided');
reset role;
select test.check((select status = 'APPROVED' and hr_decided_by = test.id('hr_head') and hr_decided_at is not null from leave_requests where id = (select a from lv)), 'HR approval makes the leave approved');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and type = 'LEAVE_APPROVED' and entity_id = (select a from lv)), 'the employee is told');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('dh_wab') and type = 'LEAVE_APPROVED' and entity_id = (select a from lv)), 'and so is the Department Head');

-- rejection by the Department Head ends the request; HR never sees it
set role authenticated;
select test.login('tm_a');
update lv set b = (submit_leave_request('FULL_DAY', '2026-12-07', '2026-12-08', null, 'Personal work') ->> 'id')::uuid;
select test.login('dh_wab');
select decide_leave_department_head((select b from lv), false, 'Busy week');
select test.login('hr_head');
select test.must_fail($$select decide_leave_hr((select b from lv), true, null)$$, 'HR cannot approve a request the Department Head rejected', 'already been decided');
select test.check((select count(*) = 0 from jsonb_array_elements(leave_requests_to_review() -> 'awaiting') r where r ->> 'id' = (select b::text from lv)), 'it is not on HR''s list');
reset role;
select test.check((select status = 'REJECTED_BY_DEPARTMENT_HEAD' and dh_note = 'Busy week' from leave_requests where id = (select b from lv)), 'the rejection and its reason are stored');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and type = 'LEAVE_DEPARTMENT_HEAD_REJECTED' and entity_id = (select b from lv) and body = 'Busy week'), 'the employee gets the reason');

-- rejection by HR (the Super Admin may act as HR)
set role authenticated;
select test.login('tm_d1');
update lv set c = (submit_leave_request('HALF_DAY', '2026-11-10', null, 'AFTERNOON', 'Bank work') ->> 'id')::uuid;
select test.login('dh_wab');
select decide_leave_department_head((select c from lv), true, null);
select test.login('sa');
select test.must_fail($$select decide_leave_hr((select c from lv), false, null)$$, 'HR must give a reason when rejecting', 'reason');
select decide_leave_hr((select c from lv), false, 'Quota used');
reset role;
select test.check((select status = 'REJECTED_BY_HR' and hr_note = 'Quota used' and hr_decided_by = test.id('sa') from leave_requests where id = (select c from lv)), 'HR can reject, with the reason recorded');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_d1') and type = 'LEAVE_REJECTED_BY_HR' and body = 'Quota used'), 'and the employee is told');

-- a Department Head's own leave is reviewed by the Super Admin
set role authenticated;
select test.login('dh_wab');
update lv set d = (submit_leave_request('FULL_DAY', '2026-12-14', '2026-12-14', null, 'Medical') ->> 'id')::uuid;
select test.must_fail($$select decide_leave_department_head((select d from lv), true, null)$$, 'a Department Head cannot approve their own leave', 'not found');
select test.login('hr_head');
select test.must_fail($$select decide_leave_hr((select d from lv), true, null)$$, 'HR cannot approve it before the Super Admin', 'has not approved');
select test.login('sa');
select decide_leave_department_head((select d from lv), true, null);
select test.login('hr_head');
select decide_leave_hr((select d from lv), true, null);
reset role;
select test.check((select status = 'APPROVED' from leave_requests where id = (select d from lv)), 'the chain works for a Department Head');
select test.check((select count(*) = 0 from notifications where recipient_id = test.id('dh_wab') and entity_id = (select d from lv) and type = 'LEAVE_AWAITING_DEPARTMENT_HEAD'), 'nobody is asked to approve their own leave');

-- ---------------------------------------------------------------- the lists
set role authenticated;
select test.login('tm_a');
select test.check((select jsonb_array_length(my_leave_requests()) = 2), 'an employee sees their own requests');
select test.check((select jsonb_array_length(leave_requests_to_review() -> 'awaiting') = 0 and not (leave_requests_to_review() ->> 'canReviewAsHr')::boolean), 'and has nothing to review');
select test.login('tm_d1');
select test.check((select jsonb_array_length(my_leave_requests()) = 1), 'another employee sees only theirs');
select test.must_fail($$select * from leave_requests$$, 'the table is not readable directly', 'permission denied');
select test.login('ov_m1');
update lv set e = (submit_leave_request('FULL_DAY', '2026-10-29', '2026-11-03', null, 'Festival') ->> 'id')::uuid;
select test.login('dh_acc');
select test.check((select jsonb_array_length(leave_requests_to_review() -> 'awaiting') = 0 from (select 1) x), 'another department''s head sees none of it');
select test.login('dh_wab');
select test.check((select count(*) = 1 from jsonb_array_elements(leave_requests_to_review() -> 'awaiting') r where r ->> 'id' = (select e::text from lv)), 'the Department Head sees their department''s request');
select decide_leave_department_head((select e from lv), true, null);
select test.login('hr_head');
select decide_leave_hr((select e from lv), true, null);

-- ---------------------------------------------------------------- monthly totals (approved leave only, Sundays are the weekly off)
select test.login('hr_head');
create temp table mo as select null::jsonb as nov, null::jsonb as oct, null::jsonb as dec_, null::jsonb as feb;
grant all on mo to authenticated;
update mo set nov = leave_monthly_summary('2026-11-15'), oct = leave_monthly_summary('2026-10-01'), dec_ = leave_monthly_summary('2026-12-20'), feb = leave_monthly_summary('2026-02-01');
select test.check((select e ->> 'leaveDays' = '3' and e ->> 'halfDays' = '0' from mo, jsonb_array_elements(nov -> 'employees') e where e ->> 'profileId' = test.id('tm_a')::text),
  'November: a 2-4 Nov leave counts 3 days');
select test.check((select count(*) = 0 from mo, jsonb_array_elements(nov -> 'employees') e where e ->> 'profileId' = test.id('tm_d1')::text),
  'a rejected half day is not counted');
select test.check((select e ->> 'leaveDays' = '2' from mo, jsonb_array_elements(nov -> 'employees') e where e ->> 'profileId' = test.id('ov_m1')::text),
  'a leave across two months: November counts 2 and 3 Nov (Sunday 1 Nov excluded)');
select test.check((select e ->> 'leaveDays' = '3' from mo, jsonb_array_elements(oct -> 'employees') e where e ->> 'profileId' = test.id('ov_m1')::text),
  'and October counts 29, 30 and 31 Oct');
select test.check((select count(*) = 1 from mo, jsonb_array_elements(dec_ -> 'employees') e where e ->> 'profileId' = test.id('dh_wab')::text and e ->> 'leaveDays' = '1')
                  and (select count(*) = 0 from mo, jsonb_array_elements(dec_ -> 'employees') e where e ->> 'profileId' = test.id('tm_a')::text),
  'December: the rejected request is left out');
select test.check((select jsonb_array_length(feb -> 'employees') = 0 from mo), 'a month without leave gives no rows');
-- a half day in the month
select test.login('ov_m2');
update lv set c = (submit_leave_request('HALF_DAY', '2026-11-20', null, 'MORNING', 'Appointment') ->> 'id')::uuid;
select test.login('dh_wab');
select decide_leave_department_head((select c from lv), true, null);
select test.login('hr_head');
select decide_leave_hr((select c from lv), true, null);
update mo set nov = leave_monthly_summary('2026-11-01');
select test.check((select e ->> 'halfDays' = '1' and e ->> 'leaveDays' = '0' from mo, jsonb_array_elements(nov -> 'employees') e where e ->> 'profileId' = test.id('ov_m2')::text),
  'a half day counts as one half day');
select test.login('dh_acc');
select test.check((select jsonb_array_length(leave_monthly_summary('2026-11-01') -> 'employees') = 0), 'a Department Head sees only their own department''s totals');
select test.login('dh_wab');
select test.check((select jsonb_array_length(leave_monthly_summary('2026-11-01') -> 'employees') = 3), 'the head of the department sees theirs');
select test.login('tm_a');
select test.must_fail($$select leave_monthly_summary('2026-11-01')$$, 'an employee cannot read department totals', 'Not allowed');
select test.login('th_wab');
select test.must_fail($$select leave_monthly_summary('2026-11-01')$$, 'nor can a Team Lead', 'Not allowed');

-- ---------------------------------------------------------------- HR members have an HR employee record (migration 20261103000100)
reset role;
select test.check((select count(*) = 1 and bool_and(department_id = 'hr' and id = 'EMP-' || upper(left(profile_id::text, 8)))
                     from hr_employees where profile_id = test.id('hr_head')), 'the HR head is linked to one HR employee record (the directory''s own id)');
select test.check((select count(*) = 0 from hr_employees where profile_id = test.id('tm_a')), 'a member of another department gets none');
select private.link_hr_employee_record(test.id('hr_head'));
select private.link_hr_employee_record(test.id('hr_head'));
select test.check((select count(*) = 1 from hr_employees where profile_id = test.id('hr_head')), 'linking again never duplicates it');
select test.check((select count(*) = 0 from hr_employees where profile_id = (select id from profiles where role = 'SUPER_ADMIN' limit 1)), 'the Super Admin is not an HR employee');

-- ---------------------------------------------------------------- personal details
reset role;
insert into employee_personal_details (profile_id, designation, joining_date, date_of_birth, blood_group, emergency_contact)
  values (test.id('tm_a'), 'Team Member', '2026-01-05', '1999-03-04', 'O+', '+91 98765 43210');
select test.must_fail($$insert into employee_personal_details (profile_id, blood_group) values (test.id('tm_d1'), 'Z+')$$, 'a blood group is checked', 'check constraint');
select test.must_fail($$insert into employee_personal_details (profile_id, emergency_contact) values (test.id('tm_d1'), 'call me')$$, 'so is the emergency number', 'check constraint');
select test.must_fail($$insert into employee_personal_details (profile_id, designation) values (test.id('tm_d1'), 'Boss')$$, 'and the designation', 'check constraint');
set role authenticated;
select test.login('hr_head');
select test.check((select count(*) = 1 from jsonb_array_elements(hr_personal_details()) d where d ->> 'bloodGroup' = 'O+' and d ->> 'emergencyContact' = '+91 98765 43210'), 'HR can read the details');
select test.login('tm_a');
select test.check((select my_personal_details() ->> 'dateOfBirth' = '1999-03-04'), 'an employee can read their own');
select test.must_fail($$select hr_personal_details()$$, 'but not everyone''s', 'Only HR staff');
select test.login('tm_d1');
select test.check((select my_personal_details() = 'null'::jsonb), 'nor anyone else''s');
select test.must_fail($$select * from employee_personal_details$$, 'the table is not readable directly', 'permission denied');
select test.login('sa');
select notify_member_created(test.id('tm_a'));
select notify_member_created(test.id('tm_a'));
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('hr_head') and type = 'TEAM_MEMBER_CREATED' and entity_id = test.id('tm_a')), 'HR is told about a new member once');
select test.check((select count(*) = 0 from notifications where recipient_id = test.id('hr_head') and type = 'TEAM_MEMBER_CREATED' and entity_id = test.id('hr_head')), 'and a member is never told about their own creation');
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select notify_member_created(test.id('tm_d1'))$$, 'an employee cannot raise that notice', 'Not allowed');

-- ---------------------------------------------------------------- notifications stay private
select test.check((select count(*) = 0 from notifications where recipient_id = test.id('hr_head')), 'one person cannot read another''s notifications');
reset role;
\echo '=== ALL HR TESTS PASSED ==='
