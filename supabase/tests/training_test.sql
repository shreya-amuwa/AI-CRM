-- =============================================================================
-- HR Training workspace (migration 20261116000300): three-day programs, day reports, completion from real attendance and activity,
-- history across programs, trainer permissions and the daily check. Uses the HR head / HR member of the HR e-mail suite and Sales members.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- HR training'
reset role;
reset role;
create or replace function test.enr(p_program text, p_employee text) returns uuid language sql security definer set search_path = '' as
  $$ select e.id from public.hr_training_enrollments e join public.hr_training_programs p on p.id = e.program_id where p.name = p_program and e.employee_name = p_employee $$;
create or replace function test.prog(p_program text) returns uuid language sql security definer set search_path = '' as
  $$ select id from public.hr_training_programs where name = p_program $$;
grant execute on function test.enr(text, text), test.prog(text) to authenticated;
grant usage on schema test to authenticated;
set role authenticated;

\echo '   access'
select test.login('tm_a');
select test.must_fail($$select hr_training_programs_list()$$, 'a Sales member cannot open the training workspace', 'FORBIDDEN');
select test.must_fail($$select hr_training_overview()$$, 'nor its overview', 'FORBIDDEN');
select test.must_fail($$select hr_training_program_save(null, 'Sneaky', null, (now() at time zone 'Asia/Kolkata')::date)$$, 'nor create a program', 'FORBIDDEN');
select test.login('dh_wab');
select test.must_fail($$select hr_training_records()$$, 'a Department Head of another department cannot read training records', 'FORBIDDEN');
select test.login('hr_head');
select test.must_fail($$insert into hr_training_programs (name, start_date) values ('Direct', (now() at time zone 'Asia/Kolkata')::date)$$, 'the tables cannot be written directly', 'permission denied');

\echo '   programs and days'
select hr_training_program_save(null, 'Onboarding Bootcamp A', 'Three days for new joiners', (now() at time zone 'Asia/Kolkata')::date - 5, test.id('hrx_tm'));
select test.check((select jsonb_array_length(j -> 'days') = 3 and j ->> 'endDate' = ((now() at time zone 'Asia/Kolkata')::date - 3)::text and j ->> 'phase' = 'ENDED'
                         and (j -> 'days' -> 0 ->> 'title') = 'Initial Training' and (j -> 'days' -> 1 ->> 'title') = 'Practical Training' and (j -> 'days' -> 2 ->> 'title') = 'Final Training and Assessment'
                         and (j -> 'days' -> 1 ->> 'date')::date = (now() at time zone 'Asia/Kolkata')::date - 4
                     from (select x as j from jsonb_array_elements(hr_training_programs_list()) x where x ->> 'name' = 'Onboarding Bootcamp A') q),
  'a program gets its three days on consecutive dates from the start date');
select test.must_fail($$select hr_training_program_save(null, 'X', null, (now() at time zone 'Asia/Kolkata')::date)$$, 'a program needs a name', 'name');
select test.must_fail($$select hr_training_program_save(null, 'Bad Date', null, (now() at time zone 'Asia/Kolkata')::date + 5000)$$, 'and a sensible start date', 'start date');
select hr_training_program_save(null, 'Onboarding Bootcamp B', null, (now() at time zone 'Asia/Kolkata')::date, test.id('hrx_tm'));
select hr_training_program_save(null, 'Later Bootcamp C', null, (now() at time zone 'Asia/Kolkata')::date + 10, test.id('hrx_tm'));
select hr_training_day_save(test.prog('Onboarding Bootcamp B'), 1, 'Initial Training', '["CRM basics","Company policies"]', 'Rina Trainer', null, '[]', null);
select hr_training_day_save(test.prog('Onboarding Bootcamp B'), 3, 'Final Training and Assessment', '["Mock calls"]', 'Th Wab', test.id('th_wab'), '[{"name":"Quiz","max":10},{"name":"Role play","max":10}]', 60);
select test.must_fail($$select hr_training_day_save(test.prog('Onboarding Bootcamp B'), 2, 'Practical', '[]', null, null, '[{"name":"","max":0}]', null)$$, 'a criterion needs a name and a maximum', 'criterion');
select test.must_fail($$select hr_training_day_save(test.prog('Onboarding Bootcamp B'), 4, 'Day four', '[]', null, null, '[]', null)$$, 'a program has only three days', 'three days');
select test.check((select (j -> 'days' -> 0 -> 'topics') = '["CRM basics","Company policies"]'::jsonb and (j -> 'days' -> 2 ->> 'passPercent') = '60' and (j -> 'days' -> 2 ->> 'trainerName') = 'Th Wab'
                     from (select x as j from jsonb_array_elements(hr_training_programs_list()) x where x ->> 'name' = 'Onboarding Bootcamp B') q),
  'topics, trainer and assessment criteria are configured, not hard-coded');

\echo '   enrolment'
select test.check((hr_training_enroll(test.prog('Onboarding Bootcamp A'), array[test.id('tm_a')::text, test.id('tm_b')::text, 'not-an-employee']) ->> 'added')::int = 2, 'employees are enrolled; an unknown one is reported');
select test.check((hr_training_enroll(test.prog('Onboarding Bootcamp A'), array[test.id('tm_a')::text]) ->> 'added')::int = 0, 'enrolling twice adds nothing');
select hr_training_enroll(test.prog('Onboarding Bootcamp B'), array[test.id('tm_a')::text, test.id('tm_b')::text]);
select test.check((select e ->> 'employeeName' = 'Member A' and e ->> 'department' is not null and e ->> 'status' = 'NOT_STARTED' and e ->> 'designation' is not null
                     from jsonb_array_elements(hr_training_program_get(test.prog('Onboarding Bootcamp A')) -> 'enrollments') e where e ->> 'employeeName' = 'Member A'),
  'the employee record shows name, department, designation and a status of Not started');
select test.check(jsonb_array_length(hr_training_employees()) >= 3, 'the employee picker lists the HR directory');

\echo '   a day is complete only through attendance and recorded activity'
-- Program B starts today: only Day 1 can be reported
select test.must_fail($$select hr_training_report_save(test.enr('Onboarding Bootcamp B', 'Member A'), 2, 'PRESENT', '["x"]', '[]', '[]', null, null, null)$$,
  'a day cannot be reported before it takes place', 'before it takes place');
select test.check((hr_training_report_save(test.enr('Onboarding Bootcamp B', 'Member A'), 1, 'PRESENT',
  '["CRM basics"]', '[{"title":"Set up the CRM account","done":true}]', '[]', 'Good start', 'Asks good questions', 'Attended all sessions') ->> 'completed') = 'true', 'present + topics and tasks recorded = Day 1 complete');
select test.check((select e ->> 'status' = 'IN_PROGRESS' from jsonb_array_elements(hr_training_program_get(test.prog('Onboarding Bootcamp B')) -> 'enrollments') e where e ->> 'employeeName' = 'Member A'),
  'the status becomes In progress');
select test.check((hr_training_report_save(test.enr('Onboarding Bootcamp B', 'Member B'), 1, 'PRESENT', '[]', '[]', '[]', null, null, null) ->> 'completed') = 'false',
  'present but nothing recorded: the day is not complete');
select test.must_fail($$select hr_training_report_save(test.enr('Onboarding Bootcamp B', 'Member B'), 1, 'ABSENT', '["CRM basics"]', '[]', '[]', null, null, null)$$,
  'an absent employee cannot have topics done', 'absent');
select test.check((hr_training_report_save(test.enr('Onboarding Bootcamp B', 'Member B'), 1, 'ABSENT', '[]', '[]', '[]', null, null, 'Sick') ->> 'completed') = 'false',
  'an absent day is not complete');
-- time passes: Program B started two days ago
reset role;
update hr_training_programs set start_date = (now() at time zone 'Asia/Kolkata')::date - 2 where name = 'Onboarding Bootcamp B';
set role authenticated;
select test.login('hr_head');
select test.check((select e ->> 'status' = 'IN_PROGRESS' and (e -> 'days' -> 1 ->> 'completed') = 'false' and (e -> 'days' -> 1 ->> 'overdue') = 'true'
                     from jsonb_array_elements(hr_training_program_get(test.prog('Onboarding Bootcamp B')) -> 'enrollments') e where e ->> 'employeeName' = 'Member A'),
  'Day 2 has passed but nobody marked it: it is NOT complete, only flagged as overdue');
select hr_training_report_save(test.enr('Onboarding Bootcamp B', 'Member A'), 2, 'LATE', '[]', '[{"title":"Practice call","done":true}]', '[]', null, 'Arrived late', null);
select test.must_fail($$select hr_training_report_save(test.enr('Onboarding Bootcamp B', 'Member A'), 3, 'PRESENT', '[]', '[]', '[{"criterion":"Unknown","score":5}]', null, null, null)$$,
  'a score must belong to a configured criterion', 'not an assessment criterion');
select test.must_fail($$select hr_training_report_save(test.enr('Onboarding Bootcamp B', 'Member A'), 3, 'PRESENT', '[]', '[]', '[{"criterion":"Quiz","score":11}]', null, null, null)$$,
  'and stay within its maximum', 'between 0 and 10');
select test.check((hr_training_report_save(test.enr('Onboarding Bootcamp B', 'Member A'), 3, 'PRESENT', '["Mock calls"]', '[]', '[]', null, null, null) ->> 'completed') = 'false',
  'Day 3 needs its assessment: with topics only it is not complete');
select test.check((select hr_training_report_save(test.enr('Onboarding Bootcamp B', 'Member A'), 3, 'PRESENT', '["Mock calls"]', '[]',
  '[{"criterion":"Quiz","score":8},{"criterion":"Role play","score":7}]', 'Strong final day', null, null) ->> 'assessmentResult') = 'PASS', '15 of 20 against a pass mark of 60% is a pass');
select test.check((select e ->> 'status' = 'COMPLETED' and e -> 'consolidated' ->> 'daysCompleted' = '3' and (e -> 'consolidated' ->> 'assessmentPercent')::numeric = 75.0 and e ->> 'consolidatedAt' is not null
                     from jsonb_array_elements(hr_training_program_get(test.prog('Onboarding Bootcamp B')) -> 'enrollments') e where e ->> 'employeeName' = 'Member A'),
  'all three days complete: Completed, with the consolidated report (75% assessment)');
select hr_training_enrollment_review(test.enr('Onboarding Bootcamp B', 'Member A'), 'Quick learner', 'Needs practice with objections', 'Recommended');
select test.check((select (h ->> 'strengths') = 'Quick learner' and (h -> 'consolidated' ->> 'strengths') = 'Quick learner' and jsonb_array_length(h -> 'reports') = 3 and (h -> 'reports' -> 2 ->> 'assessmentResult') = 'PASS'
                     from (select hr_training_enrollment_get(test.enr('Onboarding Bootcamp B', 'Member A')) h) x),
  'HR opens one record and sees all three daily reports, the strengths and the areas to improve');
select test.check((select e ->> 'status' = 'IN_PROGRESS' from jsonb_array_elements(hr_training_program_get(test.prog('Onboarding Bootcamp B')) -> 'enrollments') e where e ->> 'employeeName' = 'Member B'),
  'the absent employee is still In progress (the program has not ended)');

\echo '   trainers'
select test.login('th_wab');
select test.check(jsonb_array_length(hr_training_programs_list()) = 1, 'a trainer sees only the program they train');
select test.check((hr_training_report_save(test.enr('Onboarding Bootcamp B', 'Member B'), 3, 'PRESENT', '["Mock calls"]', '[]', '[{"criterion":"Quiz","score":2}]', null, null, null) ->> 'assessmentResult') = 'FAIL',
  'the trainer of Day 3 can record Day 3 (2 of 10 is below the pass mark)');
select test.must_fail($$select hr_training_report_save(test.enr('Onboarding Bootcamp B', 'Member B'), 1, 'PRESENT', '["x"]', '[]', '[]', null, null, null)$$,
  'but not Day 1, which is not theirs', 'FORBIDDEN');
select test.must_fail($$select hr_training_enroll(test.prog('Onboarding Bootcamp B'), array[test.id('tm_a')::text])$$, 'a trainer cannot enrol people', 'FORBIDDEN');
select test.must_fail($$select hr_training_records()$$, 'nor read all employees'' records', 'FORBIDDEN');
select test.login('tm_b');
select test.must_fail($$select hr_training_program_get(test.prog('Onboarding Bootcamp B'))$$, 'someone who is not a trainer cannot open a program', 'NOT_FOUND');

\echo '   the daily check, history and the overview'
select test.login('hr_head');
reset role;
select test.check((select (r ->> 'statusesChanged')::int >= 2 and (r ->> 'consolidatedReports')::int >= 2 from (select hr_training_tick((now() at time zone 'Asia/Kolkata')::date) r) x), 'the daily check ends the training of a program that is over without the work done: Incomplete, with a consolidated report');
select test.check((select count(*) = 2 and bool_and(consolidated is not null) from hr_training_enrollments e join hr_training_programs p on p.id = e.program_id where p.name = 'Onboarding Bootcamp A' and e.status = 'INCOMPLETE'),
  'both employees of the past program are Incomplete (the dates passed, nothing was attended)');
select test.check((select (consolidated -> 'missing') @> '["Day 1: no attendance recorded"]'::jsonb and (consolidated ->> 'daysCompleted') = '0' from hr_training_enrollments e where employee_name = 'Member A' and program_id = test.prog('Onboarding Bootcamp A')),
  'the consolidated report says what is missing instead of inventing it');
select test.check((select count(*) = 2 from notifications where type = 'TRAINING_REPORTS_PENDING' and recipient_id = test.id('hrx_tm')), 'the responsible HR employee is reminded, once per program, of the day reports still missing');
select test.check((select (r ->> 'statusesChanged')::int = 0 and (r ->> 'consolidatedReports')::int = 0 from (select hr_training_tick((now() at time zone 'Asia/Kolkata')::date) r) x), 'a second run changes and creates nothing');
select test.check((select count(*) = 2 from notifications where type = 'TRAINING_REPORTS_PENDING' and recipient_id = test.id('hrx_tm')), 'and sends no second reminder');
set role authenticated;
select test.login('hr_head');
select test.check((select (o ->> 'employeesEnrolled')::int = 2 and (o ->> 'completed')::int = 1 and (o ->> 'incomplete')::int = 2 and (o ->> 'activePrograms')::int = 1 and (o ->> 'upcomingPrograms')::int = 1 and (o ->> 'pendingTraining')::int = 1 from (select hr_training_overview() o) x),
  'the overview counts what is real (2 employees, 1 completed, 2 incomplete, 1 running program, 1 upcoming)');
select test.check((hr_training_records('member a', null, 50, 0) ->> 'total')::int = 2, 'an employee who attended two programs has two records (history is kept, not overwritten)');
select test.check((hr_training_records(null, 'COMPLETED', 50, 0) ->> 'total')::int = 1, 'records can be filtered by status');
select test.must_fail($$select hr_training_records(null, 'WHATEVER')$$, 'an unknown status is refused', 'Unknown');
select hr_training_enroll(test.prog('Later Bootcamp C'), array[test.id('tm_a')::text]);
select test.must_fail($$select hr_training_unenroll(test.enr('Onboarding Bootcamp B', 'Member A'))$$, 'a record with reports is kept', 'kept');
select hr_training_unenroll((select e.id from hr_training_enrollments e join hr_training_programs p on p.id = e.program_id where p.name = 'Later Bootcamp C'));
select test.check((select count(*) = 0 from hr_training_enrollments e join hr_training_programs p on p.id = e.program_id where p.name = 'Later Bootcamp C'), 'an enrolment made by mistake can be removed');
-- rescheduling moves the three days
select hr_training_program_save(test.prog('Later Bootcamp C'), 'Later Bootcamp C', null, (now() at time zone 'Asia/Kolkata')::date + 20);
select test.check((select (j -> 'days' -> 2 ->> 'date')::date = (now() at time zone 'Asia/Kolkata')::date + 22 from (select x as j from jsonb_array_elements(hr_training_programs_list()) x where x ->> 'name' = 'Later Bootcamp C') q), 'changing the start date moves all three days');
-- cancelling
select hr_training_program_cancel(test.prog('Later Bootcamp C'));
select test.must_fail($$select hr_training_enroll(test.prog('Later Bootcamp C'), array[test.id('tm_a')::text])$$, 'nobody can be enrolled in a cancelled program', 'cancelled');
select test.login('hrx_tm');
select test.check((hr_training_overview() ->> 'employeesEnrolled')::int = 2, 'another HR employee sees the same records');
select test.login('sa');
select test.check(jsonb_array_length(hr_training_programs_list()) = 3, 'the Super Admin reads every program');
reset role;
set role anon;
select test.must_fail($$select hr_training_overview()$$, 'a signed-out visitor cannot', 'permission denied');
reset role;
set role authenticated;
select test.login('hr_head');
select test.must_fail($$select hr_training_tick()$$, 'a user cannot run the daily check', 'permission denied');
reset role;
\echo '=== ALL HR TRAINING TESTS PASSED ==='
