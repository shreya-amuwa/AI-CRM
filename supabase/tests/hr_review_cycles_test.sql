-- =============================================================================
-- Employee confirmation reviews (20270312000100): T-10 / T-4 reminders to HR, the Department Head and the CEO, separate evaluations,
-- revision, reassignment, the final decision (confirm, extend, not confirmed, on hold), the attendance day engine and the holiday calendar.
-- "Today" of the planner is injected (hr_schedule_emails(p_today)); no e-mail is sent: only the queue is exercised.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 140. Employee confirmation reviews'
reset role;
-- other suites re-run older migrations (which redefine some of these functions): this one runs its own, twice (safe to run again)
\i supabase/migrations/20270312000100_employee_review_cycles.sql
\i supabase/migrations/20270312000100_employee_review_cycles.sql

create or replace function test.as_id(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false)
$$;
grant execute on function test.as_id(uuid) to authenticated;

-- people: employees in Whatsbox Sales (Department Head dh_wbx), a CEO for Whatsbox Sales, an HR Assistant (not a decider)
do $$
begin
  if not exists (select 1 from test.users where name = 'rv_ceo') then
    perform test.create_auth_user('rv_ceo', 'rv.ceo@amuwa.com', '{"full_name":"RV Whatsbox CEO"}', jsonb_build_object('provisioned_by', test.id('sa'),
      'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('whatsbox'), 'provisioned_head_division', 'SALES', 'provisioned_operations_head', true));
    perform test.create_auth_user('rv_hrtm', 'rv.hrtm@amuwa.com', '{"full_name":"RV HR Assistant"}', jsonb_build_object('provisioned_by', test.id('hr_head'),
      'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', (select t.id from teams t where t.department_id = test.dept('hr') order by t.created_at limit 1)));
    perform test.create_auth_user(n, n || '@rv.example', jsonb_build_object('full_name', 'RV ' || initcap(replace(n, 'rv_', ''))),
      jsonb_build_object('provisioned_by', test.id('th_wbx'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('whatsbox', 'Sales')))
      from unnest(array['rv_emp', 'rv_two', 'rv_three', 'rv_late', 'rv_gap', 'rv_left', 'rv_jan']) n;
  end if;
end $$;
update profiles set status = 'ACTIVE', is_operations_head = true where id = test.id('rv_ceo');
delete from operations_head_departments where profile_id = test.id('rv_ceo');
insert into operations_head_departments (profile_id, department_id, division) values (test.id('rv_ceo'), test.dept('whatsbox'), 'SALES');
update profiles set status = 'ACTIVE' where id in (select id from test.users where name like 'rv\_%');
delete from employee_personal_details where profile_id in (select id from test.users where name like 'rv\_%');
insert into employee_personal_details (profile_id, joining_date) values
  (test.id('rv_emp'), date '2026-09-14'),    -- 6 months -> 14 Mar 2027
  (test.id('rv_two'), date '2026-09-20'),    -- 20 Mar 2027
  (test.id('rv_three'), date '2026-09-25'),  -- 25 Mar 2027
  (test.id('rv_late'), date '2026-09-10'),   -- 10 Mar 2027: found late (fewer than 10 days left)
  (test.id('rv_gap'), date '2026-09-07'),    -- 7 Mar 2027: missed runs, only the current stage
  (test.id('rv_left'), date '2026-09-16'),
  (test.id('rv_jan'), date '2026-08-31');    -- month end -> 28 Feb 2027
update profiles set status = 'REVOKED' where id = test.id('rv_left');

create or replace function test.cyc(p text) returns uuid language sql stable security definer as
  $$ select id from hr_probation_cycles where profile_id = test.id(p) order by created_at desc limit 1 $$;
create or replace function test.rv_ev(p_kind text, p text, p_role text default null) returns bigint language sql stable security definer as
  $$ select count(*) from hr_email_events where kind = p_kind and cycle_id = test.cyc(p) and (p_role is null or payload ->> 'recipientRole' = p_role) $$;
create or replace function test.hr_n() returns bigint language sql stable as
  $$ select count(*) from private.hr_notify_recipients() $$;
-- the planner runs as the service, with nobody signed in
create or replace function test.sched(p date) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false);
  return hr_schedule_emails(p);
end $$;
grant execute on all functions in schema test to authenticated;

\echo '   dates and the start of the review'
select test.sched(date '2027-03-01');
select test.check((select probation_end = date '2027-03-14' and original_end = date '2027-03-14' and cycle_type = 'PROBATION' and review_round = 1
                     from hr_probation_cycles where id = test.cyc('rv_emp')), 'six calendar months from joining (14 Sep -> 14 Mar), original date kept');
select test.check((select probation_end = date '2027-02-28' from hr_probation_cycles where id = test.cyc('rv_jan')), 'a 31 August joiner is due on 28 February (month end)');
select test.check(test.cyc('rv_left') is null, 'an inactive employee gets no review');
select test.check((select review_started_at is null from hr_probation_cycles where id = test.cyc('rv_emp')) and test.rv_ev('REVIEW_FIRST', 'rv_emp') = 0,
  'eleven days or more before: no review and no reminder yet');
-- rv_late: 9 days left on the first run (found late) -> first stage with the real number of days
select test.check(test.rv_ev('REVIEW_FIRST', 'rv_late') > 0 and (select bool_and((payload ->> 'daysLeft')::int = 9) from hr_email_events where cycle_id = test.cyc('rv_late') and kind = 'REVIEW_FIRST'),
  'a cycle found with 9 days left gets the first reminder saying 9 days (never "10")');
-- rv_gap: 6 days left now; the planner did not run for a week -> next run is at 3 days left: only the second stage
select test.check(test.rv_ev('REVIEW_FIRST', 'rv_gap') > 0, 'rv_gap got its first reminder at 6 days');
delete from hr_email_events where cycle_id = test.cyc('rv_gap');
delete from hr_review_notice_log where cycle_id = test.cyc('rv_gap');
update hr_probation_cycles set review_started_at = null where id = test.cyc('rv_gap');
select test.sched(date '2027-03-04');
select test.check(test.rv_ev('REVIEW_FIRST', 'rv_gap') = 0 and test.rv_ev('REVIEW_SECOND', 'rv_gap') > 0,
  'after downtime only the current (second) stage goes out, not both together');

select test.check((select review_started_at is not null and dh_reviewer_id = test.id('dh_wbx') and ceo_reviewer_id is not null and config_issue is null
                     from hr_probation_cycles where id = test.cyc('rv_emp')),
  'ten days before: the review starts with the Department Head of the department and the CEO of its function');
create temp table rv_ceo_of as select ceo_reviewer_id as id from hr_probation_cycles where id = test.cyc('rv_emp');
grant all on rv_ceo_of to authenticated;
select test.check(test.rv_ev('REVIEW_FIRST', 'rv_emp', 'HR') = test.hr_n() and test.rv_ev('REVIEW_FIRST', 'rv_emp', 'DH') = 1 and test.rv_ev('REVIEW_FIRST', 'rv_emp', 'CEO') = 1,
  'the first reminder goes to HR, the Department Head and the CEO');
select test.check((select bool_and((payload ->> 'daysLeft')::int = 10 and payload ->> 'employeeName' = 'RV Emp' and payload ->> 'department' = 'Whatsbox'
                                    and payload ->> 'joiningDate' = '2026-09-14' and payload ->> 'probationEndDate' = '2027-03-14' and payload ->> 'reviewPath' = '/?review=' || test.cyc('rv_emp')
                                    and payload ->> 'dhStatus' = 'NOT_STARTED' and send_after = timestamptz '2027-03-04 10:00:00+05:30')
                     from hr_email_events where cycle_id = test.cyc('rv_emp') and kind = 'REVIEW_FIRST'),
  'it carries the employee, dates, days left (10), the review statuses and the link, at 10:00 India time');
select test.check((select count(*) = 2 from notifications where type = 'EMPLOYEE_REVIEW_REMINDER' and entity_id = test.cyc('rv_emp')
                     and recipient_id in (test.id('dh_wbx'), (select id from rv_ceo_of))), 'the Department Head and the CEO get the in-app reminder');
select test.check((select body like 'Please submit your evaluation%' from notifications where type = 'EMPLOYEE_REVIEW_REMINDER' and entity_id = test.cyc('rv_emp')
                     and recipient_id = test.id('dh_wbx')), 'asking them to submit their evaluation');
create temp table rv_n1 as select count(*) as n from hr_email_events where kind in ('REVIEW_FIRST', 'REVIEW_SECOND');
select test.sched(date '2027-03-04');
select test.sched(date '2027-03-05');
select test.check((select count(*) from hr_email_events where kind in ('REVIEW_FIRST', 'REVIEW_SECOND') and cycle_id = test.cyc('rv_emp')) = test.hr_n() + 2,
  'running the planner again (same day, next day) sends nothing twice');

\echo '   who may open a review'
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select hr_review_detail(test.cyc('rv_emp'))$$, 'an employee of another department cannot open it', 'not found');
select test.check(jsonb_array_length(hr_reviews_list() -> 'rows') = 0, 'nor list it');
select test.login('rv_emp');
select test.must_fail($$select hr_review_detail(test.cyc('rv_emp'))$$, 'the employee cannot open their own review', 'not found');
select test.login('dh_wab');
select test.must_fail($$select hr_review_detail(test.cyc('rv_emp'))$$, 'another department''s head cannot open it', 'not found');
select test.login('dh_wbx');
select test.check((select count(*) = 1 from jsonb_array_elements(hr_review_my_queue() -> 'rows') r where r ->> 'id' = test.cyc('rv_emp')::text and r ->> 'myRole' = 'DH'),
  'the Department Head finds it in their Employee Confirmation Reviews');
select test.check((hr_review_detail(test.cyc('rv_emp')) ->> 'myRole') = 'DH' and not (hr_review_detail(test.cyc('rv_emp')) ->> 'canDecide')::boolean,
  'the Department Head reviews but does not decide');

\echo '   the Department Head''s evaluation: draft, validation, submit, no silent change'
select test.check(hr_review_save(test.cyc('rv_emp'), 'DH', '{"ratings":{"work_quality":4,"attendance":null},"answers":{"strengths":"Fast learner"}}') -> 'dh' ->> 'status' = 'DRAFT',
  'a draft is saved and is not a submission');
select test.must_fail($$select hr_review_save(test.cyc('rv_emp'), 'DH', '{"ratings":{"work_quality":4},"submit":true}')$$, 'submitting needs a recommendation', 'recommendation');
select test.must_fail($$select hr_review_save(test.cyc('rv_emp'), 'DH', '{"ratings":{"work_quality":7},"recommendation":"CONFIRM","submit":true}')$$, 'ratings are 1 to 5', '1 to 5');
select test.must_fail($$select hr_review_save(test.cyc('rv_emp'), 'DH', '{"ratings":{"work_quality":2},"recommendation":"NOT_CONFIRM","answers":{"recommendationReason":"no"},"submit":true}')$$,
  'not recommending needs a detailed reason', 'in detail');
select test.must_fail($$select hr_review_save(test.cyc('rv_emp'), 'DH', '{"ratings":{"work_quality":3},"recommendation":"EXTEND","answers":{"recommendationReason":"Needs more time"},"submit":true}')$$,
  'an extension recommendation needs the duration and the improvement expected', 'duration');
select test.must_fail($$select hr_review_save(test.cyc('rv_emp'), 'CEO', '{"ratings":{"work_quality":3}}')$$, 'the Department Head cannot write the CEO''s report', 'FORBIDDEN');
select test.check(hr_review_save(test.cyc('rv_emp'), 'DH', '{"ratings":{"work_quality":4,"attendance":5,"attendance_na":null},"answers":{"strengths":"Fast learner","recommendationReason":"Consistent"},"recommendation":"CONFIRM","submit":true}') -> 'dh' ->> 'status' = 'SUBMITTED',
  'the Department Head submits: recommend confirmation');
select test.must_fail($$select hr_review_save(test.cyc('rv_emp'), 'DH', '{"ratings":{"work_quality":1},"recommendation":"CONFIRM","submit":true}')$$,
  'a submitted report cannot be changed without a revision', 'return it for revision');
reset role;
select test.check((select reviewer_id = test.id('dh_wbx') and submitted_at is not null and version = 1 from hr_review_evaluations where cycle_id = test.cyc('rv_emp') and reviewer_role = 'DH'),
  'the reviewer and the submission time are recorded');
select test.check((select count(*) = 1 from hr_review_evaluation_versions v join hr_review_evaluations e on e.id = v.evaluation_id where e.cycle_id = test.cyc('rv_emp')),
  'the submitted version is kept');
select test.check((select count(*) >= 1 from notifications where type = 'EMPLOYEE_REVIEW_SUBMITTED' and recipient_id = test.id('hr_head') and entity_id = test.cyc('rv_emp')
                     and body not like '%Fast learner%'), 'HR is told, without the report''s content');

\echo '   the second reminder knows who submitted'
select test.sched(date '2027-03-10');
select test.check(test.rv_ev('REVIEW_SECOND', 'rv_emp', 'HR') = test.hr_n() and test.rv_ev('REVIEW_SECOND', 'rv_emp', 'DH') = 1 and test.rv_ev('REVIEW_SECOND', 'rv_emp', 'CEO') = 1,
  'four days before: the second reminder to HR, the Department Head and the CEO');
select test.check((select payload ->> 'ownStatus' = 'SUBMITTED' and payload ->> 'dhStatus' = 'SUBMITTED' and payload ->> 'ceoStatus' = 'NOT_STARTED' and (payload ->> 'daysLeft')::int = 4
                     from hr_email_events where cycle_id = test.cyc('rv_emp') and kind = 'REVIEW_SECOND' and payload ->> 'recipientRole' = 'DH'),
  'the Department Head''s copy acknowledges the submitted report; the CEO''s is still pending');
select test.check((select body like 'Your evaluation has been submitted%' from notifications where type = 'EMPLOYEE_REVIEW_REMINDER' and entity_id = test.cyc('rv_emp')
                     and recipient_id = test.id('dh_wbx') and data ->> 'stage' = 'SECOND'), 'and so does the in-app reminder');

\echo '   the CEO, HR revision, the decision rules'
set role authenticated;
select test.as_id((select id from rv_ceo_of));
select test.check((select count(*) = 0 from jsonb_array_elements(hr_review_detail(test.cyc('rv_emp')) -> 'evaluations') e where e ->> 'role' = 'DH'),
  'the CEO does not read the Department Head''s report (each reviewer sees their own)');
select test.must_fail($$select hr_review_decide(test.cyc('rv_emp'), '{"decision":"CONFIRM","reason":"All good here"}')$$, 'the CEO does not record the final decision', 'FORBIDDEN');
select test.login('hr_head');
select test.check((select count(*) = 1 from jsonb_array_elements(hr_review_detail(test.cyc('rv_emp')) -> 'evaluations') e where e ->> 'role' = 'DH' and e -> 'ratings' ->> 'work_quality' = '4'),
  'HR reads the Department Head''s full report');
select test.must_fail($$select hr_review_decide(test.cyc('rv_emp'), '{"decision":"CONFIRM","reason":"Department Head recommends"}')$$,
  'without the CEO report the decision is refused by default', 'both needed');
select test.must_fail($$select hr_confirm_probation(test.cyc('rv_emp'))$$, 'and the old Confirm button cannot bypass the review', 'HR records the final decision');
select test.login('rv_hrtm');
select test.must_fail($$select hr_review_decide(test.cyc('rv_emp'), '{"decision":"CONFIRM","reason":"Department Head recommends it","exceptional":true}')$$,
  'an HR Assistant cannot record the final decision', 'FORBIDDEN');
select test.check(hr_review_return(test.cyc('rv_emp'), 'DH', 'Please add the key achievements') -> 'dh' ->> 'status' = 'RETURNED', 'HR returns the report for revision');
select test.login('dh_wbx');
select test.check(hr_review_save(test.cyc('rv_emp'), 'DH', '{"ratings":{"work_quality":4,"attendance":5},"answers":{"strengths":"Fast learner","achievements":"Closed 12 leads","recommendationReason":"Consistent"},"recommendation":"CONFIRM","submit":true}') -> 'dh' ->> 'status' = 'SUBMITTED',
  'the Department Head revises and submits again');
select test.as_id((select id from rv_ceo_of));
select test.must_fail($$select hr_review_save(test.cyc('rv_emp'), 'CEO', '{"ratings":{"overall":3},"recommendation":"EXTEND","answers":{"recommendationReason":"More time needed"},"submit":true}')$$,
  'the CEO''s extension recommendation needs the duration too', 'duration');
select test.check(hr_review_save(test.cyc('rv_emp'), 'CEO', '{"ratings":{"overall":3},"recommendation":"EXTEND","answers":{"recommendationReason":"More time needed","extensionMonths":"2","improvementExpectations":"Reach 80% of the target"},"submit":true}') -> 'ceo' ->> 'status' = 'SUBMITTED',
  'the CEO submits a separate evaluation: recommend an extension');
reset role;
select test.check((select count(*) = 2 from hr_review_evaluation_versions v join hr_review_evaluations e on e.id = v.evaluation_id where e.cycle_id = test.cyc('rv_emp') and e.reviewer_role = 'DH'),
  'both submitted versions of the Department Head''s report are kept');
select test.check((select count(*) = 2 from hr_review_evaluations where cycle_id = test.cyc('rv_emp') and reviewer_role in ('DH', 'CEO') and status = 'SUBMITTED'),
  'the two reports are stored separately on the same cycle');

\echo '   extension: same cycle, next round, original date kept, old reminders dropped'
insert into hr_email_events (event_key, kind, cycle_id, recipient_email, recipient_name, event_date, send_after, status)
values ('TEST_OBSOLETE:' || test.cyc('rv_emp'), 'REVIEW_SECOND', test.cyc('rv_emp'), 'x@rv.example', 'X', date '2027-03-12', now() + interval '1 day', 'PENDING');
set role authenticated;
select test.login('hr_head');
select test.must_fail($$select hr_review_decide(test.cyc('rv_emp'), '{"decision":"EXTEND","reason":"Following the CEO","extensionMonths":"2"}')$$,
  'an extension records the improvement expected', 'improvement');
select test.check((select j ->> 'dueDate' = '2027-05-14' and (j ->> 'round')::int = 2 and j ->> 'originalEnd' = '2027-03-14' and j ->> 'status' = 'PENDING'
                     and j -> 'dh' ->> 'status' = 'NOT_STARTED' and jsonb_array_length(j -> 'extensions') = 1
                     from (select hr_review_decide(test.cyc('rv_emp'), '{"decision":"EXTEND","reason":"Following the CEO recommendation","extensionMonths":"2","expectations":"Reach 80% of the target","hrEvaluation":{"answers":{"observations":"Punctual"}}}') as j) x),
  'HR extends by two months: new date 14 May, round 2, original 14 March kept, fresh reports');
reset role;
select test.check((select status = 'SKIPPED' and last_error like 'Superseded%' from hr_email_events where event_key = 'TEST_OBSOLETE:' || test.cyc('rv_emp')),
  'a reminder still queued for the old date is cancelled');
select test.check((select count(*) = 3 from hr_review_evaluations where cycle_id = test.cyc('rv_emp') and round = 1 and status = 'SUBMITTED'),
  'every round-1 report (Department Head, CEO, HR) is preserved');
select test.check((select count(*) = 1 from hr_probation_cycles where profile_id = test.id('rv_emp')), 'no second cycle was created');
select test.sched(date '2027-05-04');
select test.check((select count(*) = test.hr_n() + 2 from hr_email_events where cycle_id = test.cyc('rv_emp') and kind = 'REVIEW_FIRST' and event_key like '%:2:%'),
  'the reminders are recalculated for the revised date (round 2, ten days before 14 May)');

\echo '   confirmation: the existing confirmation path'
set role authenticated;
select test.login('dh_wbx');
select hr_review_save(test.cyc('rv_emp'), 'DH', '{"ratings":{"work_quality":5},"answers":{"recommendationReason":"Improved"},"recommendation":"CONFIRM","submit":true}');
select test.as_id((select id from rv_ceo_of));
select hr_review_save(test.cyc('rv_emp'), 'CEO', '{"ratings":{"overall":4},"answers":{"recommendationReason":"Improved"},"recommendation":"CONFIRM","submit":true}');
select test.login('hr_head');
select test.check((hr_review_detail(test.cyc('rv_emp')) ->> 'overall') = 'AWAITING_HR_DECISION', 'both reports in: awaiting HR''s decision');
select test.check(hr_review_decide(test.cyc('rv_emp'), '{"decision":"CONFIRM","reason":"Both reviewers recommend confirmation","effectiveDate":"2027-05-14","hrEvaluation":{"answers":{"finalAssessment":"Confirmed"}}}') ->> 'status' = 'CONFIRMING',
  'HR confirms: the existing confirmation runs (CONFIRMING until the confirmation e-mail is sent)');
select test.must_fail($$select hr_review_decide(test.cyc('rv_emp'), '{"decision":"CONFIRM","reason":"Again please confirm"}')$$, 'a decided review cannot be decided twice', 'already decided');
reset role;
select test.check((select decision = 'CONFIRM' and decided_by = test.id('hr_head') and effective_date = date '2027-05-14' from hr_probation_cycles where id = test.cyc('rv_emp')),
  'the decision, the decision-maker and the effective date are recorded');
select test.check((select count(*) = 1 from hr_email_events where kind = 'CONFIRMATION_EMPLOYEE' and cycle_id = test.cyc('rv_emp')), 'one confirmation e-mail is queued');
update hr_email_events set send_after = now() - interval '1 minute' where cycle_id = test.cyc('rv_emp') and kind in ('CONFIRMATION_EMPLOYEE', 'CONFIRMATION_HR');
select hr_email_claim_cycle(test.cyc('rv_emp'), 'live');
select hr_email_finish(id, 'SENT', 'ok') from hr_email_events where cycle_id = test.cyc('rv_emp') and status = 'SENDING';
select test.check((select status = 'APPROVED' from hr_probation_cycles where id = test.cyc('rv_emp')), 'after the e-mail the employee is confirmed (APPROVED, as before)');
select test.check((select count(*) = 2 from hr_review_decisions where cycle_id = test.cyc('rv_emp')), 'the decision history has the extension and the confirmation');
select test.check((select count(*) = 1 from audit_logs where action = 'EMPLOYEE_REVIEW_DECIDED' and entity_id = test.cyc('rv_emp') and metadata ->> 'decision' = 'CONFIRM'), 'audited');

\echo '   a missing Department Head, reassignment, an exceptional "not confirmed"'
reset role;
update profiles set status = 'SUSPENDED' where id = test.id('dh_wbx');
select test.sched(date '2027-03-10');
update profiles set status = 'ACTIVE' where id = test.id('dh_wbx');
select test.check((select config_issue = 'NO_DEPARTMENT_HEAD' and dh_reviewer_id is null from hr_probation_cycles where id = test.cyc('rv_two')),
  'no active Department Head: recorded as a configuration issue, not skipped');
select test.check((select count(*) = 1 from notifications where type = 'EMPLOYEE_REVIEW_CONFIG' and entity_id = test.cyc('rv_two') and recipient_id = test.id('hr_head')
                     and body like 'Reviewer missing (no Department Head)%'), 'and HR is told to assign one');
set role authenticated;
select test.login('rv_hrtm');
select test.must_fail($$select hr_review_reassign(test.cyc('rv_two'), 'DH', test.id('rv_two'), 'self')$$, 'the employee cannot review themselves', 'not the employee');
select test.check(hr_review_reassign(test.cyc('rv_two'), 'DH', test.id('dh_wbx'), 'Department Head is back') -> 'dh' -> 'reviewer' ->> 'id' = test.id('dh_wbx')::text,
  'HR reassigns the pending review');
reset role;
select test.check((select config_issue is null from hr_probation_cycles where id = test.cyc('rv_two')), 'the configuration issue is cleared');
select test.check((select count(*) >= 1 from hr_review_assignments where cycle_id = test.cyc('rv_two') and changed_by = test.id('rv_hrtm') and to_id = test.id('dh_wbx')),
  'the assignment history is kept');
set role authenticated;
select test.login('dh_wbx');
select hr_review_save(test.cyc('rv_two'), 'DH', '{"ratings":{"attendance":1},"answers":{"recommendationReason":"Absent on most days without informing anyone"},"recommendation":"NOT_CONFIRM","submit":true}');
select test.login('rv_hrtm');
select test.must_fail($$select hr_review_decide(test.cyc('rv_two'), '{"decision":"NOT_CONFIRM","reason":"Attendance is far below what the role needs","exceptional":true}')$$,
  'only the HR Department Head may decide with a report missing', 'FORBIDDEN');
select test.login('hr_head');
select test.must_fail($$select hr_review_decide(test.cyc('rv_two'), '{"decision":"NOT_CONFIRM","reason":"short","exceptional":true}')$$, 'a reason is required', 'reason');
select test.check(hr_review_decide(test.cyc('rv_two'), '{"decision":"NOT_CONFIRM","reason":"Attendance far below what the role needs; the CEO is on leave and agreed by phone","exceptional":true}') ->> 'status' = 'NOT_CONFIRMED',
  'the HR Department Head records an exceptional "not confirmed" with the documented reason');
reset role;
select test.check((select status = 'ACTIVE' from profiles where id = test.id('rv_two')), 'nobody is deactivated by the decision (the exit process is separate)');
select test.check((select decision_exceptional from hr_probation_cycles where id = test.cyc('rv_two')), 'the decision is marked exceptional');

\echo '   on hold'
set role authenticated;
select test.login('hr_head');
select test.must_fail($$select hr_review_decide(test.cyc('rv_three'), '{"decision":"HOLD","reason":"Waiting for the project result"}')$$, 'a hold needs the next review date', 'next review date');
select test.check(hr_review_decide(test.cyc('rv_three'), jsonb_build_object('decision', 'HOLD', 'reason', 'Waiting for the project result', 'nextReviewDate', private.hr_today() + 20)) ->> 'status' = 'ON_HOLD',
  'HR puts the decision on hold (no reports needed for that)');
reset role;
select test.check((select hold_owner = test.id('hr_head') and hold_next_review = private.hr_today() + 20 from hr_probation_cycles where id = test.cyc('rv_three')),
  'the responsible person and the next review date are recorded');
select test.sched(private.hr_today() + 20);
select test.check((select count(*) = 1 from notifications where type = 'EMPLOYEE_REVIEW_HOLD_DUE' and entity_id = test.cyc('rv_three') and recipient_id = test.id('hr_head')),
  'on that date the case comes back to HR');
set role authenticated;
select test.login('hr_head');
select test.check((select count(*) >= 1 from jsonb_array_elements(hr_reviews_list('{"window":"PENDING_DECISION"}') -> 'rows') r where r ->> 'id' = test.cyc('rv_three')::text),
  'and it is in HR''s pending decisions');

\echo '   HR list, filters, failed e-mail visibility'
select test.check((hr_reviews_list() -> 'cards' ->> 'confirmed')::int >= 1 and (hr_reviews_list() -> 'cards' ->> 'extended')::int >= 1, 'the cards count confirmed and extended cases');
select test.check((select bool_and(r ->> 'department' = 'Whatsbox') from jsonb_array_elements(hr_reviews_list(jsonb_build_object('departmentId', test.dept('whatsbox'))) -> 'rows') r),
  'the department filter');
select test.check((select count(*) = 0 from jsonb_array_elements(hr_reviews_list('{"employee":"RV Emp","window":"OVERDUE"}') -> 'rows') r), 'the window filter');
reset role;
update hr_email_events set status = 'FAILED', last_error = 'SMTP error 550' where cycle_id = test.cyc('rv_late') and kind = 'REVIEW_FIRST' and payload ->> 'recipientRole' = 'DH';
set role authenticated;
select test.login('hr_head');
select test.check((select count(*) = 1 from jsonb_array_elements(hr_review_detail(test.cyc('rv_late')) -> 'reminders') r where r ->> 'status' = 'FAILED' and r ->> 'error' = 'SMTP error 550'),
  'a reminder that could not be delivered is visible to HR');
select test.check((select count(*) = 0 from jsonb_array_elements(hr_reviews_list('{"pendingRole":"DH"}') -> 'rows') r where r ->> 'id' = test.cyc('rv_emp')::text),
  'the pending-reviewer filter leaves out decided reviews');
reset role;

\echo '   attendance day engine and holidays'
delete from office_holidays where day in (date '2026-11-02');
insert into office_holidays (day, name) values (date '2026-11-02', 'Test Holiday');
delete from attendance_records where profile_id = test.id('rv_jan') and attendance_date between date '2026-11-02' and date '2026-11-04';
insert into attendance_records (profile_id, attendance_date, punch_in_at, punch_out_at) values
  (test.id('rv_jan'), date '2026-11-03', timestamptz '2026-11-03 10:05+05:30', null),
  (test.id('rv_jan'), date '2026-11-04', timestamptz '2026-11-04 10:45+05:30', timestamptz '2026-11-04 18:00+05:30');
delete from attendance_lunches where profile_id = test.id('rv_jan') and attendance_date = date '2026-11-04';
insert into attendance_lunches (profile_id, attendance_date, started_at, ended_at) values
  (test.id('rv_jan'), date '2026-11-04', timestamptz '2026-11-04 13:00+05:30', timestamptz '2026-11-04 13:40+05:30'),
  (test.id('rv_jan'), date '2026-11-04', timestamptz '2026-11-04 13:30+05:30', timestamptz '2026-11-04 14:00+05:30');
select test.check((select status = 'HOLIDAY' and not scheduled and holiday = 'Test Holiday' from private.att_day_rows(date '2026-11-02', date '2026-11-02', array[test.id('rv_jan')])),
  'a holiday in the calendar is a holiday, not an absence');
select test.check((select status = 'MISSING_PUNCH_OUT' and gross_minutes is null and net_minutes is null and incomplete from private.att_day_rows(date '2026-11-03', date '2026-11-03', array[test.id('rv_jan')])),
  'a missing Punch Out is marked incomplete and no hours are invented');
select test.check((select status = 'LATE' and late_minutes = 15 and break_minutes = 60 and break_count = 2 and gross_minutes = 435 and net_minutes = 375
                     from private.att_day_rows(date '2026-11-04', date '2026-11-04', array[test.id('rv_jan')])),
  'overlapping breaks are counted once (13:00-14:00 = 60 min); net = gross - breaks; late after 10:30');
select test.check(not private.office_working_day(date '2026-11-02'), 'the holiday is not a working day for the reminders either');
select test.check((select status = 'NOT_JOINED' from private.att_day_rows(date '2026-08-30', date '2026-08-30', array[test.id('rv_jan')])), 'before joining: not counted');
delete from office_holidays where day = date '2026-11-02';
delete from attendance_records where profile_id = test.id('rv_jan') and attendance_date between date '2026-11-03' and date '2026-11-04';
delete from attendance_lunches where profile_id = test.id('rv_jan') and attendance_date = date '2026-11-04';

\echo '=== EMPLOYEE CONFIRMATION REVIEW TESTS PASSED ==='
