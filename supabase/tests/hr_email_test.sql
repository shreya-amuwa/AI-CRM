-- =============================================================================
-- HR e-mail automation (migration 20261107000100): birthdays, anniversaries, probation reminders, approval, queue, permissions.
-- Runs after the other suites on the same database. "Today" is injected (hr_schedule_emails(p_today)), so the dates below are
-- fixed and the test does not depend on the day it runs. No e-mail is sent: only the queue is exercised.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- HR e-mail automation'
reset role;

-- HR staff: the existing HR head, plus an HR team member (cannot approve) and an HR team lead (can approve)
select test.create_auth_user('hrx_tm', 'hrx.tm@amuwa.com', '{"full_name":"HRX Member"}',
  jsonb_build_object('provisioned_by', test.id('hr_head'), 'provisioned_role', 'TEAM_MEMBER',
                     'provisioned_team_id', (select t.id from teams t where t.department_id = test.dept('hr') order by t.created_at limit 1)));

-- employees (wabastore Sales team) with the dates the automation reads
create or replace function test.hrx_employee(p_name text, p_email text, p_dob date, p_joining date, p_hr_status text default null) returns void language plpgsql as $$
begin
  perform test.create_auth_user(p_name, p_email, jsonb_build_object('full_name', initcap(replace(p_name, '_', ' '))),
    jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
  insert into employee_personal_details (profile_id, date_of_birth, joining_date) values (test.id(p_name), p_dob, p_joining);
  if p_hr_status is not null then
    insert into hr_employees (id, name, email, department_id, status, joining_date, profile_id)
    values ('HRX-' || upper(p_name), initcap(replace(p_name, '_', ' ')), p_email, 'wabastore', p_hr_status, to_char(p_joining, 'YYYY-MM-DD'), test.id(p_name));
  end if;
end $$;

select test.hrx_employee('hrx_bday',   'hrx.bday@amuwa.com',   date '1990-04-14', date '2020-01-10');
select test.hrx_employee('hrx_anniv',  'hrx.anniv@amuwa.com',  date '1991-07-01', date '2023-04-14');
select test.hrx_employee('hrx_leap',   'hrx.leap@amuwa.com',   date '1992-02-29', date '2019-02-28');
select test.hrx_employee('hrx_prob',   'hrx.prob@amuwa.com',   date '1995-01-01', date '2026-09-14');                       -- probation ends 2027-03-14
select test.hrx_employee('hrx_over',   'hrx.over@amuwa.com',   date '1995-01-02', date '2026-09-01');                       -- ended 2027-03-01
select test.hrx_employee('hrx_old',    'hrx.old@amuwa.com',    date '1985-01-03', date '2018-01-01');                       -- long ago: no cycle
select test.hrx_employee('hrx_intern', 'hrx.intern@amuwa.com', date '2003-01-04', date '2026-12-15', 'Intern');             -- interns: no cycle
select test.hrx_employee('hrx_late',   'hrx.late@amuwa.com',   date '1990-05-20', date '2021-01-01');
select test.hrx_employee('hrx_susp',   'hrx.susp@amuwa.com',   date '1990-04-14', date '2020-04-14');
update profiles set status = 'SUSPENDED' where id = test.id('hrx_susp');
select test.hrx_employee('hrx_nodob',  'hrx.nodob@amuwa.com',  null,              date '2022-06-01');
insert into hr_employees (id, name, email, department_id, status, joining_date, data)
values ('HRX-ONLY-BAD', 'Hrx Bad Email', 'not-an-email', 'wabastore', 'Full-Time', '2021-04-14', '{"dateOfBirth":"1990-04-14"}'),
       ('HRX-ONLY-LEFT', 'Hrx Left', 'hrx.left@amuwa.com', 'wabastore', 'Left', '2020-04-14', '{"dateOfBirth":"1990-04-14"}');
select test.hrx_employee('hrx_prob2', 'hrx.prob2@amuwa.com', date '1995-01-05', date '2026-09-20', 'Training / Probation');  -- HR record says probation

create or replace function test.ev(p_kind text, p_name text) returns bigint language sql as
  $$ select count(*) from hr_email_events where kind = p_kind and payload ->> 'employeeName' = p_name $$;
create or replace function test.hrcount() returns bigint language sql as $$ select count(*) from private.hr_notify_recipients() $$;

\echo '   dates and recipients'
select test.check(test.hrcount() >= 2 and (select count(*) = 2 from private.hr_notify_recipients() where email in ('hr.head@amuwa.com', 'hrx.tm@amuwa.com')), 'HR recipients are the active HR department members');
select test.check((select count(*) = 1 from private.hr_mail_employees() where full_name = 'Hrx Anniv' and joining_date = date '2023-04-14' and date_of_birth = date '1991-07-01'),
  'the employee dates come from the personal details');

-- ---------------------------------------------------------------- probation: calculation, reminder one week before, overdue
\echo '   probation'
select hr_schedule_emails(date '2027-03-06');
select test.check((select probation_end = date '2027-03-14' and status = 'PENDING' from hr_probation_cycles where employee_name = 'Hrx Prob'),
  'probation ends six months after the joining date (14 Sep -> 14 Mar)');
select test.check(test.ev('PROBATION_REMINDER_EMPLOYEE', 'Hrx Prob') = 0, 'no reminder eight days before the end');
select test.check((select count(*) = 0 from hr_probation_cycles where employee_name in ('Hrx Old', 'Hrx Intern')), 'long-standing employees and interns have no probation cycle');
select test.check((select count(*) = 1 from hr_probation_cycles where employee_name = 'Hrx Prob2' and status = 'PENDING'), 'an employee marked "Training / Probation" gets a cycle');
select hr_schedule_emails(date '2027-03-07');
select test.check(test.ev('PROBATION_REMINDER_EMPLOYEE', 'Hrx Prob') = 1, 'exactly seven days before the end the employee gets the reminder');
-- HR's own 7-day copy was replaced by the review reminders (20270312000100): the first one went out at T-10..T-5 (here T-8)
select test.check((select count(*) = test.hrcount() from hr_email_events where kind = 'REVIEW_FIRST' and payload ->> 'employeeName' = 'Hrx Prob' and payload ->> 'recipientRole' = 'HR'), 'and every HR recipient got the review reminder');
select test.check((select recipient_email = 'hrx.prob@amuwa.com' and send_after = timestamptz '2027-03-07 09:00:00+05:30' from hr_email_events
                    where kind = 'PROBATION_REMINDER_EMPLOYEE' and payload ->> 'employeeName' = 'Hrx Prob'), 'the employee reminder goes to the employee at 09:00');
select test.check((select (payload ->> 'daysLeft')::int = 8 and payload ->> 'employeeCode' = 'EMP-' || upper(left(test.id('hrx_prob')::text, 8)) and payload ->> 'department' = 'Wabastore'
                      and payload ->> 'joiningDate' = '2026-09-14' and payload ->> 'probationEndDate' = '2027-03-14'
                     from hr_email_events where kind = 'REVIEW_FIRST' and payload ->> 'recipientRole' = 'HR' and payload ->> 'employeeName' = 'Hrx Prob' limit 1),
  'the HR reminder carries name, id, department, joining date and completion date');
select test.check((select payload ->> 'designation' = 'Team Member' and payload ->> 'reportingManager' not in ('', 'Not assigned') and payload ->> 'reportingManager' = (select full_name from profiles where id = test.id('th_wab'))
                     from hr_email_events where kind = 'REVIEW_FIRST' and payload ->> 'recipientRole' = 'HR' and payload ->> 'employeeName' = 'Hrx Prob' limit 1),
  'the HR reminder also carries the designation and the reporting manager (the Team Lead of the team)');
select test.check((select (payload ->> 'daysLeft')::int = 7 from hr_email_events where kind = 'PROBATION_REMINDER_EMPLOYEE' and payload ->> 'employeeName' = 'Hrx Prob'),
  'the employee reminder knows it is seven days before');
select hr_schedule_emails(date '2027-03-07');
select hr_schedule_emails(date '2027-03-10');
select hr_schedule_emails(date '2027-03-14');
select test.check(test.ev('PROBATION_REMINDER_EMPLOYEE', 'Hrx Prob') = 1 and (select count(*) = test.hrcount() from hr_email_events where kind = 'REVIEW_FIRST' and payload ->> 'recipientRole' = 'HR' and payload ->> 'employeeName' = 'Hrx Prob'), 'the reminder is sent once per confirmation cycle');
select test.check((select status = 'PENDING' from hr_probation_cycles where employee_name = 'Hrx Prob'), 'nothing confirms the employee automatically');
select test.check(test.ev('PROBATION_OVERDUE_HR', 'Hrx Over') >= test.hrcount(), 'a confirmation that is overdue reminds HR');
select test.check(test.ev('CONFIRMATION_EMPLOYEE', 'Hrx Over') = 0 and (select status = 'PENDING' from hr_probation_cycles where employee_name = 'Hrx Over'),
  'and the employee is NOT confirmed');
create temp table od as select count(*) as n from hr_email_events where kind = 'PROBATION_OVERDUE_HR' and payload ->> 'employeeName' = 'Hrx Over';
select hr_schedule_emails(date '2027-03-15');
select test.check((select count(*) = (select n from od) from hr_email_events where kind = 'PROBATION_OVERDUE_HR' and payload ->> 'employeeName' = 'Hrx Over'),
  'overdue reminders are weekly, not daily');
select hr_schedule_emails(date '2027-03-21');
select test.check((select count(*) > (select n from od) from hr_email_events where kind = 'PROBATION_OVERDUE_HR' and payload ->> 'employeeName' = 'Hrx Over'), 'the next week brings the next overdue reminder');
select test.check((select count(*) = 0 from hr_email_events where kind = 'PROBATION_OVERDUE_HR' and recipient_email = 'hrx.over@amuwa.com'), 'the employee gets no overdue e-mail, only HR');

-- ---------------------------------------------------------------- birthdays and anniversaries
create temp table sched as select hr_schedule_emails(date '2027-04-14') as j;
select test.check(test.ev('BIRTHDAY', 'Hrx Bday') = 1, 'a birthday e-mail is queued on the birthday');
select test.check(test.ev('ANNIVERSARY', 'Hrx Anniv') = 1 and (select (payload ->> 'years')::int = 4 from hr_email_events where kind = 'ANNIVERSARY' and payload ->> 'employeeName' = 'Hrx Anniv'),
  'a work anniversary e-mail is queued with the completed years (4)');
select test.check(test.ev('BIRTHDAY', 'Hrx Anniv') = 0 and test.ev('ANNIVERSARY', 'Hrx Bday') = 0, 'only the matching occasion is queued');
select test.check(test.ev('BIRTHDAY', 'Hrx Susp') = 0 and test.ev('BIRTHDAY', 'Hrx Left') = 0, 'inactive (suspended / left) employees get nothing');
select test.check((select status = 'SKIPPED' and last_error like 'No valid e-mail%' from hr_email_events where kind = 'BIRTHDAY' and payload ->> 'employeeName' = 'Hrx Bad Email'),
  'an invalid e-mail address is recorded as skipped, not sent');
select test.check((select count(*) = 1 from hr_email_events where kind = 'ANNIVERSARY' and payload ->> 'employeeName' = 'Hrx Bad Email') , 'an anniversary for the same person is separate (and also skipped)');
select test.check((select event_key = 'BIRTHDAY:' || test.id('hrx_bday') || ':2027' from hr_email_events where kind = 'BIRTHDAY' and payload ->> 'employeeName' = 'Hrx Bday'),
  'the unique key is per employee, occasion and year');
select test.check((select send_after = timestamptz '2027-04-14 09:00:00+05:30' from hr_email_events where kind = 'BIRTHDAY' and payload ->> 'employeeName' = 'Hrx Bday'),
  'e-mails go out at 09:00 Indian time');

create temp table n1 as select count(*) as n from hr_email_events;
select hr_schedule_emails(date '2027-04-14');
select hr_schedule_emails(date '2027-04-14');
select test.check((select count(*) from hr_email_events) = (select n from n1),
  'running the check again the same day queues nothing twice');
-- (the next day may legitimately queue a probation reminder whose week starts then, so only birthdays and anniversaries are compared)
create temp table n2 as select count(*) as n from hr_email_events where kind in ('BIRTHDAY', 'ANNIVERSARY');
select hr_schedule_emails(date '2027-04-15');
select test.check((select count(*) from hr_email_events where kind in ('BIRTHDAY', 'ANNIVERSARY')) = (select n from n2),
  'and the next day queues no second birthday or anniversary e-mail');
select test.check(test.ev('BIRTHDAY', 'Hrx Bday') = 1 and test.ev('ANNIVERSARY', 'Hrx Anniv') = 1, 'still exactly one birthday and one anniversary e-mail');
select hr_schedule_emails(date '2028-04-14');
select test.check(test.ev('BIRTHDAY', 'Hrx Bday') = 2 and test.ev('ANNIVERSARY', 'Hrx Anniv') = 2
                   and (select (payload ->> 'years')::int = 5 from hr_email_events where event_key = 'ANNIVERSARY:' || test.id('hrx_anniv') || ':5'),
  'the next year gets its own e-mail (once per year, years of service = 5)');

-- 29 February: celebrated on 28 February in a common year, on the 29th in a leap year
select hr_schedule_emails(date '2027-02-28');
select test.check(test.ev('BIRTHDAY', 'Hrx Leap') = 1 and test.ev('ANNIVERSARY', 'Hrx Leap') = 1, 'a 29 February birthday is celebrated on 28 February in a common year');
select hr_schedule_emails(date '2028-02-28');
select test.check(test.ev('BIRTHDAY', 'Hrx Leap') = 1, 'and not twice in a leap year before the 29th');
select hr_schedule_emails(date '2028-02-29');
select test.check(test.ev('BIRTHDAY', 'Hrx Leap') = 2, 'in a leap year it is the 29th');

-- a missed run still sends (within 2 days), later than that it does not
select hr_schedule_emails(date '2027-05-22');
select test.check(test.ev('BIRTHDAY', 'Hrx Late') = 1, 'a run that was missed by two days still queues the birthday e-mail (once)');
select hr_schedule_emails(date '2027-05-23');
select test.check(test.ev('BIRTHDAY', 'Hrx Late') = 1, 'a run three days late does not');

-- ---------------------------------------------------------------- approval workflow
\echo '   approval'
create temp table cyc as select id from hr_probation_cycles where employee_name = 'Hrx Prob';
grant all on cyc to authenticated;
-- the reviews started at T-10 (20270312000100): the Department Head and CEO reports are recorded first (the review workflow is tested in hr_review_cycles_test.sql)
insert into hr_review_evaluations (cycle_id, round, reviewer_role, reviewer_id, status, ratings, recommendation, submitted_at, version)
select c.id, 1, r, null, 'SUBMITTED', '{"work_quality": 4}', 'CONFIRM', now(), 1
  from hr_probation_cycles c cross join (values ('DH'), ('CEO')) x(r) where c.employee_name in ('Hrx Prob', 'Hrx Prob2');
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select hr_confirm_probation((select id from cyc))$$, 'a sales member cannot approve a confirmation', 'FORBIDDEN');
select test.must_fail($$select hr_probation_list()$$, 'nor read the list', 'FORBIDDEN');
select test.login('hrx_tm');
select test.must_fail($$select hr_confirm_probation((select id from cyc))$$, 'an HR team member (not a lead) cannot approve', 'FORBIDDEN');
select test.check(jsonb_array_length(hr_probation_list()) >= 2, 'but HR staff can see the list');
select test.check((select bool_and(not (c ->> 'canDecide')::boolean) from jsonb_array_elements(hr_probation_list()) c), 'and it tells them they cannot decide');
select test.login('hrx_prob');
select test.must_fail($$select hr_confirm_probation((select id from cyc))$$, 'an employee cannot confirm themselves', 'FORBIDDEN');
select test.login('dh_wbx');
select test.must_fail($$select hr_confirm_probation((select id from cyc))$$, 'another department''s head cannot approve', 'FORBIDDEN');
select test.must_fail($$select hr_dismiss_probation((select id from cyc), 'not mine to close')$$, 'nor close it', 'FORBIDDEN');

select test.login('hr_head');
create temp table conf as select hr_confirm_probation((select id from cyc), null, 'Good review') as j;
grant all on conf to authenticated;
select test.check((select j ->> 'status' = 'CONFIRMING' and j ->> 'effectiveDate' = '2027-03-14' and j ->> 'approvedBy' = 'HR Head' and j ->> 'note' = 'Good review'
                      and j -> 'email' ->> 'status' = 'PENDING' from conf),
  'the HR head confirms: effective date, approver and note are recorded; the employee is NOT confirmed until the e-mail is sent (20270223000100)');
reset role;
select test.check((select status = 'CONFIRMING' and approved_at is not null and approved_by = test.id('hr_head') and effective_date = date '2027-03-14' from hr_probation_cycles where id = (select id from cyc)),
  'the decision date is stored and the confirmation waits for its e-mail');
select test.check(test.ev('CONFIRMATION_EMPLOYEE', 'Hrx Prob') = 1 and test.ev('CONFIRMATION_HR', 'Hrx Prob') = test.hrcount(), 'the employee and HR confirmation e-mails are queued by the approval');
select test.check((select recipient_email = 'hrx.prob@amuwa.com' and status = 'PENDING' and send_after = timestamptz '2027-03-14 09:00:00+05:30' and payload ->> 'confirmationEffectiveDate' = '2027-03-14'
                     from hr_email_events where kind = 'CONFIRMATION_EMPLOYEE' and payload ->> 'employeeName' = 'Hrx Prob'),
  'the confirmation e-mail waits for the end of the probation period');
select test.check((select payload ->> 'approvalStatus' = 'Approved' and payload ->> 'confirmationEffectiveDate' = '2027-03-14' and payload ->> 'joiningDate' = '2026-09-14'
                     from hr_email_events where kind = 'CONFIRMATION_HR' and payload ->> 'employeeName' = 'Hrx Prob' limit 1), 'the HR notice carries the dates and "Approved"');
select test.check((select count(*) = 1 from audit_logs where action = 'EMPLOYEE_CONFIRMATION_STARTED' and actor_id = test.id('hr_head')), 'the decision is audited');
select test.check((select count(*) = 0 from audit_logs where action = 'EMPLOYEE_CONFIRMED' and entity_id = (select id from cyc)), 'but nobody is audited as confirmed before the e-mail is sent');
set role authenticated;
select test.login('hr_head');
select test.must_fail($$select hr_confirm_probation((select id from cyc))$$, 'a second approval is refused (no second e-mail)', 'already in progress');
reset role;
select test.check(test.ev('CONFIRMATION_EMPLOYEE', 'Hrx Prob') = 1, 'still exactly one confirmation e-mail');

-- the department head of the employee's own department may approve / close; the HR record follows an approval
create temp table cyc_over as select id from hr_probation_cycles where employee_name = 'Hrx Over';
create temp table cyc_prob2 as select id from hr_probation_cycles where employee_name = 'Hrx Prob2';
grant all on cyc_over, cyc_prob2 to authenticated;
set role authenticated;
select test.login('dh_wab');
select test.must_fail($$select hr_dismiss_probation((select id from cyc_over), 'x')$$, 'closing needs a reason', 'Say why');
select test.check(hr_dismiss_probation((select id from cyc_over), 'Confirmed on paper last year') ->> 'status' = 'DISMISSED',
  'the employee''s Department Head can close a cycle with a reason');
-- the final decision is HR's once the review has started (20270312000100): the Department Head writes the evaluation, HR confirms
select test.must_fail($$select hr_confirm_probation((select id from cyc_prob2), date '2027-03-20')$$, 'but the final decision of a started review is HR''s', 'HR records the final decision');
select test.login('hr_head');
select test.check(hr_confirm_probation((select id from cyc_prob2), date '2027-03-20') ->> 'status' = 'CONFIRMING', 'and HR confirms one');
select test.must_fail($$select hr_confirm_probation((select id from cyc_prob2), date '2000-01-01')$$, 'a confirmation in progress cannot be decided again', 'already in progress');
reset role;
select test.check((select status = 'Training / Probation' from hr_employees where id = 'HRX-HRX_PROB2'), 'the HR record does not change before the confirmation e-mail is sent');
-- the employee's confirmation e-mail is sent: only now is the employee confirmed and the HR record Full-Time
update hr_email_events set send_after = now() - interval '1 minute' where cycle_id = (select id from cyc_prob2);
select test.check((select count(*) >= 1 from jsonb_array_elements(hr_email_claim_cycle((select id from cyc_prob2), 'live')) e where e ->> 'kind' = 'CONFIRMATION_EMPLOYEE'), 'the cycle''s confirmation e-mail is claimed for sending');
select hr_email_finish(id, 'SENT', 'ok') from hr_email_events where cycle_id = (select id from cyc_prob2) and status = 'SENDING';
select test.check((select status = 'APPROVED' from hr_probation_cycles where id = (select id from cyc_prob2)), 'once the e-mail is sent, the employee is confirmed');
select test.check((select status = 'Full-Time' from hr_employees where id = 'HRX-HRX_PROB2'), 'the HR record moves from "Training / Probation" to "Full-Time" once confirmed');
select test.check((select count(*) = 1 from audit_logs where action = 'EMPLOYEE_CONFIRMED' and entity_id = (select id from cyc_prob2)), 'and the confirmation is audited once');
select test.check(test.ev('CONFIRMATION_EMPLOYEE', 'Hrx Over') = 0, 'a closed cycle sends no confirmation');
set role authenticated;
select test.login('hr_head');
select test.must_fail($$select hr_confirm_probation(gen_random_uuid())$$, 'an unknown cycle is not found', 'not found');
reset role;

-- ---------------------------------------------------------------- the sending queue
\echo '   queue, retries, duplicates'
update hr_email_events set status = 'SKIPPED', last_error = 'test cleanup' where status in ('PENDING', 'RETRY', 'DRY_RUN', 'SENDING');
create temp table q as select id from hr_email_events where kind = 'BIRTHDAY' and payload ->> 'employeeName' = 'Hrx Bday' and event_date = date '2027-04-14';
grant all on q to authenticated;
update hr_email_events set status = 'PENDING', last_error = null, send_after = now() - interval '1 minute' where id = (select id from q);
select test.check(jsonb_array_length(hr_email_claim(10, 'live')) = 1, 'the due e-mail is claimed');
select test.check(jsonb_array_length(hr_email_claim(10, 'live')) = 0, 'a second sender gets nothing: the e-mail is not claimed twice');
select test.check((select status = 'SENDING' and attempts = 1 from hr_email_events where id = (select id from q)), 'a claimed e-mail is SENDING (attempt 1)');
select hr_email_finish((select id from q), 'RETRY', 'SMTP error 421: try later', 421, null);
select test.check((select status = 'RETRY' and next_attempt_at > now() + interval '4 minutes' and last_error like 'SMTP error 421%' from hr_email_events where id = (select id from q)),
  'a temporary failure waits (5 minutes) and keeps the error');
select test.check(jsonb_array_length(hr_email_claim(10, 'live')) = 0, 'it is not retried before its time');
do $$
declare i int;
begin
  for i in 2..5 loop
    update hr_email_events set next_attempt_at = now() - interval '1 second' where id = (select id from q);
    perform test.check(jsonb_array_length(hr_email_claim(10, 'live')) = 1, format('retry %s is claimed when due', i));
    perform hr_email_finish((select id from q), 'RETRY', 'SMTP error 421: try later', 421, null);
  end loop;
end $$;
select test.check((select status = 'FAILED' and attempts = 5 from hr_email_events where id = (select id from q)), 'after five attempts the e-mail is FAILED');
select test.check((select count(*) = 1 from audit_logs where action = 'HR_EMAIL_FAILED'), 'the failure is audited');
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select hr_email_retry((select id from q))$$, 'a sales member cannot retry', 'FORBIDDEN');
select test.login('hrx_tm');
select test.check(hr_email_retry((select id from q)) ->> 'status' = 'PENDING', 'HR staff can retry a failed e-mail');
select test.must_fail($$select hr_email_retry((select id from q))$$, 'only a failed e-mail can be retried', 'Only a failed');
reset role;
select test.check(jsonb_array_length(hr_email_claim(10, 'live')) = 1, 'the retried e-mail is claimed again');
select test.check(hr_email_finish((select id from q), 'SENT', 'ok', 250, '<id@mail>') ->> 'status' = 'SENT', 'a successful send is recorded');
select test.check((select status = 'SENT' and sent_at is not null and last_error is null and provider_ref = '<id@mail>' from hr_email_events where id = (select id from q)),
  'with its time and provider reference');
select test.must_fail($$select hr_email_finish((select id from q), 'SENT', 'again')$$, 'a sent e-mail cannot be finished again', 'not being sent');
update hr_email_events set send_after = now() - interval '1 minute' where id = (select id from q);
select test.check(jsonb_array_length(hr_email_claim(10, 'live')) = 0, 'a sent e-mail is never claimed again');
select hr_schedule_emails(date '2027-04-14');
select test.check((select status = 'SENT' from hr_email_events where id = (select id from q)) and test.ev('BIRTHDAY', 'Hrx Bday') = 2, 'the daily check does not queue it again');

-- dry run first, live later
update hr_email_events set status = 'PENDING', last_error = null, attempts = 0, sent_at = null, next_attempt_at = now(), send_after = now() - interval '1 minute' where id = (select id from q);
select test.check(jsonb_array_length(hr_email_claim(10, 'dry_run')) = 1, 'dry run claims the e-mail');
select hr_email_finish((select id from q), 'DRY_RUN', 'Dry run - not sent');
select test.check((select status = 'DRY_RUN' from hr_email_events where id = (select id from q)), 'it is recorded as a dry run (not SENT)');
select test.check(jsonb_array_length(hr_email_claim(10, 'dry_run')) = 0, 'and not claimed again in dry-run mode');
select test.check((select (e ->> 'attempts')::int = 1 from jsonb_array_elements(hr_email_claim(10, 'live')) e), 'when sending goes live the dry-run e-mail is sent (attempts start again)');
select hr_email_finish((select id from q), 'SENT', 'ok');

-- a crashed sender: the lease ends and the e-mail is picked up again
update hr_email_events set status = 'SENDING', locked_until = now() - interval '1 minute', send_after = now() - interval '1 hour' where id = (select id from q);
select test.check(jsonb_array_length(hr_email_claim(10, 'live')) = 1, 'an e-mail left SENDING by a crashed run is taken again after its lease');
select hr_email_finish((select id from q), 'SENT', 'ok');

-- not yet due / too late / already decided
insert into hr_email_events (event_key, kind, recipient_email, payload, event_date, send_after, status)
values ('T:future', 'BIRTHDAY', 'a@b.co', '{}', private.hr_today(), now() + interval '2 hours', 'PENDING'),
       ('T:old', 'BIRTHDAY', 'a@b.co', '{}', private.hr_today() - 5, now() - interval '5 days', 'PENDING'),
       ('T:old-anniv-retry', 'ANNIVERSARY', 'a@b.co', '{}', private.hr_today() - 3, now() - interval '3 days', 'RETRY');
select test.check(jsonb_array_length(hr_email_claim(10, 'live')) = 0, 'an e-mail is not claimed before its send time');
select test.check((select count(*) = 2 and bool_and(last_error like 'Too late%') from hr_email_events where event_key in ('T:old', 'T:old-anniv-retry') and status = 'SKIPPED'),
  'a birthday greeting that is days late is skipped, not sent');
insert into hr_email_events (event_key, kind, cycle_id, recipient_email, payload, event_date, send_after, status)
values ('T:decided', 'PROBATION_REMINDER_HR', (select id from cyc), 'a@b.co', '{}', private.hr_today(), now() - interval '1 minute', 'PENDING');
select test.check(jsonb_array_length(hr_email_claim(10, 'live')) = 0, 'a reminder for a confirmation that has been decided is not claimed');
select test.check((select status = 'SKIPPED' and last_error like '%already been decided%' from hr_email_events where event_key = 'T:decided'), 'it is marked skipped, not sent');

-- ---------------------------------------------------------------- permissions and the HR dashboard views
\echo '   permissions and dashboard'
set role authenticated;
select test.login('hr_head');
select test.must_fail($$select hr_schedule_emails()$$, 'the scheduler is not callable by users', 'permission denied');
select test.must_fail($$select hr_email_claim()$$, 'nor the claim', 'permission denied');
select test.must_fail($$select hr_email_finish(gen_random_uuid(), 'SENT')$$, 'nor the result', 'permission denied');
select test.must_fail($$select * from hr_email_events$$, 'the event table has no direct access', 'permission denied');
select test.must_fail($$select * from hr_probation_cycles$$, 'nor the cycles', 'permission denied');
reset role;
set role anon;
select test.must_fail($$select hr_email_overview()$$, 'a signed-out visitor cannot read the overview', 'permission denied');
reset role;
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select hr_email_overview()$$, 'a sales member cannot read the overview', 'FORBIDDEN');
select test.must_fail($$select hr_email_history()$$, 'nor the history', 'FORBIDDEN');
select test.must_fail($$select hr_email_data_issues()$$, 'nor the data issues', 'FORBIDDEN');
select test.must_fail($$select hr_set_employee_dates(test.id('hrx_nodob')::text, date '1990-01-01', null)$$, 'nor fix employee dates', 'FORBIDDEN');
select test.login('hrx_tm');
select test.check((hr_email_overview() -> 'confirmations' ->> 'pending')::int >= 1 and hr_email_overview() ? 'last30Days' and hr_email_overview() ? 'upcoming' and hr_email_overview() ? 'lastRun',
  'HR staff see the overview (status, upcoming, last run)');
select test.check((hr_email_history('SENT', null, 10, 0) ->> 'total')::int >= 1 and (select bool_and(i ->> 'status' = 'SENT') from jsonb_array_elements(hr_email_history('SENT', null, 10, 0) -> 'items') i),
  'the history can be filtered by status');
select test.check((select count(*) >= 1 from jsonb_array_elements(hr_email_history(null, 'BIRTHDAY', 50, 0) -> 'items') i where i ->> 'employeeName' = 'Hrx Bday'), 'and by kind');
select test.check((select count(*) = 1 from jsonb_array_elements(hr_email_data_issues()) i where i ->> 'name' = 'Hrx Nodob' and i -> 'issues' ? 'NO_DATE_OF_BIRTH'), 'employees without a date of birth are listed');
select test.check((select count(*) = 1 from jsonb_array_elements(hr_email_data_issues()) i where i ->> 'name' = 'Hrx Bad Email' and i -> 'issues' ? 'NO_VALID_EMAIL'), 'and those without a valid e-mail address');
select test.check((select count(*) = 0 from jsonb_array_elements(hr_email_data_issues()) i where i ->> 'name' in ('Hrx Susp', 'Hrx Left')), 'inactive employees are not listed');
select test.must_fail($$select hr_set_employee_dates(test.id('hrx_nodob')::text, date '2999-01-01', null)$$, 'a date of birth in the future is refused', 'valid date of birth');
select test.must_fail($$select hr_set_employee_dates(test.id('hrx_nodob')::text, null, null)$$, 'at least one date is required', 'Enter a date');
select hr_set_employee_dates(test.id('hrx_nodob')::text, date '1993-08-09', null);
select test.check((select count(*) = 0 from jsonb_array_elements(hr_email_data_issues()) i where i ->> 'name' = 'Hrx Nodob'), 'HR can fill in the missing date of birth');
select hr_set_employee_dates('HR:HRX-ONLY-BAD', date '1991-01-01', date '2021-04-01');
select test.check((select data ->> 'dateOfBirth' = '1991-01-01' and joining_date = '2021-04-01' from hr_employees where id = 'HRX-ONLY-BAD'), 'and for an HR-only record');
-- the three automation cards (HR staff only; live figures)
select test.check((hr_email_cards() ? 'birthday' and hr_email_cards() ? 'anniversary' and hr_email_cards() ? 'confirmation'
                   and (hr_email_cards() -> 'birthday' ->> 'sent')::int >= 1 and jsonb_typeof(hr_email_cards() -> 'confirmation' -> 'upcoming') = 'array'
                   and hr_email_cards() -> 'birthday' -> 'last' ->> 'status' is not null),
  'HR staff see the three cards with live figures (sent, last execution, upcoming confirmations)');
select test.check((select bool_and((u ->> 'reminderDate')::date = (u ->> 'confirmationDate')::date - 7) from jsonb_array_elements(hr_email_cards() -> 'confirmation' -> 'upcoming') u),
  'every upcoming reminder date is exactly seven days before the confirmation date');
select test.login('tm_a');
select test.must_fail($$select hr_email_cards()$$, 'a sales member cannot read the cards', 'FORBIDDEN');
reset role;
set role anon;
select test.must_fail($$select hr_email_cards()$$, 'a signed-out visitor cannot read the cards', 'permission denied');
reset role;
select test.check((select date_of_birth = date '1993-08-09' and joining_date = date '2022-06-01' from employee_personal_details where profile_id = test.id('hrx_nodob')), 'the existing joining date is kept');
select test.check((select count(*) = 2 from audit_logs where action = 'EMPLOYEE_DATES_SET'), 'the changes are audited');
select test.check(not exists (select 1 from audit_logs where action like 'HR_EMAIL%' and metadata::text ~* '@'), 'no e-mail address is written to the audit log');

\echo '=== ALL HR E-MAIL AUTOMATION TESTS PASSED ==='
