-- =============================================================================
-- Performance Management (migration 20261116000100): the figures, missing data, who may read what, no duplicates.
-- Runs after the other suites on the same database. The tasks below are created directly with fixed dates in January 2026, so the figures do
-- not depend on the day the test runs (a task still open from then is simply overdue). Nothing is sent anywhere: no AI, no notifications.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- Performance Management'
reset role;

-- two new members of the Wabastore Sales team (Team Lead: th_wab), so the figures belong only to this test
select test.create_auth_user('pf_m1', 'pf.m1@amuwa.com', '{"full_name":"Perf One"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('pf_m2', 'pf.m2@amuwa.com', '{"full_name":"Perf Two"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));

create or replace function test.pf_task(p_title text, p_who text, p_created timestamptz, p_due date, p_status text, p_completed timestamptz, p_priority text default 'MEDIUM') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into work_tasks (department_id, team_id, title, priority, due_date, assigned_by, assignee_id, status, progress, completed_at, created_at)
  values (test.dept('wabastore'), test.team('wabastore', 'Sales'), p_title, p_priority, p_due, test.id('th_wab'), test.id(p_who), p_status,
          case when p_status = 'COMPLETED' then 100 else 40 end, p_completed, p_created)
  returning id into v;
  return v;
end $$;

-- week of Monday 5 January 2026 (IST times)
select test.pf_task('PF on time',   'pf_m1', timestamptz '2026-01-05 09:00+05:30', date '2026-01-09', 'COMPLETED',   timestamptz '2026-01-08 09:00+05:30');
select test.pf_task('PF late',      'pf_m1', timestamptz '2026-01-06 09:00+05:30', date '2026-01-08', 'COMPLETED',   timestamptz '2026-01-10 09:00+05:30', 'HIGH');
select test.pf_task('PF open',      'pf_m1', timestamptz '2026-01-05 09:00+05:30', date '2026-01-09', 'IN_PROGRESS', null);
select test.pf_task('PF no stamp',  'pf_m1', timestamptz '2026-01-07 09:00+05:30', null,              'COMPLETED',   null, 'LOW');
select test.pf_task('PF next week', 'pf_m1', timestamptz '2026-01-12 09:00+05:30', date '2026-01-14', 'ASSIGNED',    null);
insert into work_task_updates (task_id, author_id, status, progress, note)
select id, test.id('pf_m1'), 'NOT_COMPLETED', 40, 'Waiting for the client documents' from work_tasks where title = 'PF late';

\echo '   the figures'
select test.check((select (private.perf_metrics('MEMBER', test.id('pf_m1'), test.team('wabastore', 'Sales'), test.dept('wabastore'), date '2026-01-05', date '2026-01-11', private.hr_today(), false) -> 'tasks') = '{"total":4,"completed":3,"pending":0,"overdue":1,"blocked":0}'::jsonb),
  'the week counts the four tasks due or assigned in it (not next week''s)');
create temp table pf_m on commit preserve rows as
  select private.perf_metrics('MEMBER', test.id('pf_m1'), test.team('wabastore', 'Sales'), test.dept('wabastore'), date '2026-01-05', date '2026-01-11', private.hr_today(), false) as m;
select test.check((select (m -> 'timing' ->> 'onTime')::int = 1 and (m -> 'timing' ->> 'late')::int = 1 and (m -> 'timing' ->> 'completedUnknownTiming')::int = 1 and (m -> 'timing' ->> 'onTimePct')::numeric = 50.0 from pf_m),
  'one on time, one late, one completed without a completion time: 50% on time (the unknown one is not guessed)');
select test.check((select (m ->> 'completionPct')::numeric = 75.0 from pf_m), 'completion is 3 of 4 = 75%');
select test.check((select (m -> 'duration' ->> 'avgActualDays')::numeric = 3.5 and (m -> 'duration' ->> 'comparedTasks')::int = 2
                          and (m -> 'duration' ->> 'comparedActualDays')::numeric = 3.5 and (m -> 'duration' ->> 'comparedPlannedDays')::numeric = 3.0 and (m -> 'duration' ->> 'avgDifferenceDays')::numeric = 0.5 from pf_m),
  'duration is calculated from the real timestamps: 3 and 4 days taken against windows of 4 and 2 (the task without a stamp is left out)');
select test.check((select (m -> 'activity' ->> 'tasksWithoutUpdates')::int = 3 and (m -> 'activity' ->> 'updates')::int = 1 and jsonb_array_length(m -> 'delayReasons') = 1
                          and m -> 'delayReasons' -> 0 ->> 'note' = 'Waiting for the client documents' from pf_m),
  'the status history and the recorded delay reason come from the updates');
select test.check((select exists (select 1 from jsonb_array_elements(m -> 'limitations') l where l::text like '%no completion time%') from pf_m), 'the missing completion time is listed as a data limitation');
select test.check((select (m -> 'workload' ->> 'peakOpenTasks')::int is not null and (m -> 'workload' -> 'byPriority' ->> 'HIGH')::int = 1 from pf_m), 'workload: priority mix and the most tasks open at once');
-- a person with no tasks: nothing is invented
select test.check((select (m ->> 'completionPct') is null and (m -> 'timing' ->> 'onTimePct') is null and (m -> 'duration' ->> 'avgActualDays') is null and m -> 'trend' = 'null'::jsonb
                     from (select private.perf_metrics('MEMBER', test.id('pf_m2'), test.team('wabastore', 'Sales'), test.dept('wabastore'), date '2026-01-05', date '2026-01-11', private.hr_today(), false) m) x),
  'without tasks every percentage and duration is null ("Insufficient data"), never 0 or a made-up value');
-- a month: the next-week task joins
select test.check((select (private.perf_metrics('MEMBER', test.id('pf_m1'), test.team('wabastore', 'Sales'), test.dept('wabastore'), date '2026-01-01', date '2026-01-31', private.hr_today(), false) -> 'tasks' ->> 'total')::int = 5), 'a month covers all five tasks');
-- team and department count tasks once
select test.check((select (private.perf_metrics('TEAM', null, test.team('wabastore', 'Sales'), test.dept('wabastore'), date '2026-01-05', date '2026-01-11', private.hr_today(), true) -> 'tasks' ->> 'total')::int = 4), 'the team report counts the same four tasks');

\echo '   who may read what'
set role authenticated;
select test.login('th_wab');
select test.check((select count(*) = 2 from jsonb_array_elements(performance_people('WEEK', date '2026-01-05', date '2026-01-11') -> 'people') p where p ->> 'name' in ('Perf One', 'Perf Two')),
  'a Team Lead sees the members of their own team');
select test.check((select count(*) = 0 from jsonb_array_elements(performance_people('WEEK', date '2026-01-05', date '2026-01-11') -> 'people') p where p ->> 'name' in ('Member C', 'Delivery Member', 'Delivery Lead', 'TH Wab Sales')),
  'and nobody from other teams or departments (nor themselves)');
select test.check(jsonb_array_length(performance_people('WEEK', date '2026-01-05', date '2026-01-11') -> 'teams') = 1 and performance_people('WEEK', date '2026-01-05', date '2026-01-11') -> 'department' = 'null'::jsonb,
  'a Team Lead gets their own team''s overall report, never the department''s');
select test.check((performance_report_refresh('MEMBER', test.id('pf_m1'), null, null, 'WEEK', date '2026-01-05', date '2026-01-11') ->> 'state') = 'CREATED', 'a Team Lead generates the report of a member of their team');
select test.must_fail($$select performance_report_refresh('MEMBER', test.id('tm_c'), null, null, 'WEEK', date '2026-01-05', date '2026-01-11')$$, 'a Team Lead cannot generate a report for another department''s member', 'FORBIDDEN');
select test.must_fail($$select performance_report_refresh('MEMBER', test.id('tm_d1'), null, null, 'WEEK', date '2026-01-05', date '2026-01-11')$$, 'nor for a member of another team of the same department', 'FORBIDDEN');
select test.must_fail($$select performance_report_refresh('DEPARTMENT', null, null, test.dept('wabastore'), 'WEEK', date '2026-01-05', date '2026-01-11')$$, 'nor the department report', 'FORBIDDEN');
select test.must_fail($$select performance_report_get('MEMBER', test.id('th_wab'), null, null, 'WEEK', date '2026-01-05', date '2026-01-11')$$, 'nor a Team Lead''s own report (that is the Department Head''s view)', 'FORBIDDEN');
select test.check((select count(*) = 1 from performance_reports where subject_id = test.id('pf_m1')), 'row-level security: the Team Lead reads the stored report of their member');
select test.login('th_gen');
select test.check((select count(*) = 0 from performance_reports where subject_id = test.id('pf_m1')), 'row-level security: another team''s Team Lead reads nothing of it');
select test.must_fail($$select performance_report_get('MEMBER', test.id('pf_m1'), null, null, 'WEEK', date '2026-01-05', date '2026-01-11')$$, 'and cannot ask for it', 'FORBIDDEN');
select test.login('th_wbx');
select test.must_fail($$select performance_report_refresh('MEMBER', test.id('pf_m1'), null, null, 'WEEK', date '2026-01-05', date '2026-01-11')$$, 'a Team Lead of another department cannot', 'FORBIDDEN');
select test.login('tm_a');
select test.must_fail($$select performance_people('WEEK', date '2026-01-05', date '2026-01-11')$$, 'a Team Member cannot open Performance Management', 'FORBIDDEN');
select test.check((select count(*) = 0 from performance_reports), 'and reads no report row');
select test.login('dh_wab');
select test.check((select count(*) >= 1 from jsonb_array_elements(performance_people('WEEK', date '2026-01-05', date '2026-01-11') -> 'people') p where p ->> 'name' = 'TH Wab Sales' and p ->> 'role' = 'Team Lead')
               and (select count(*) = 2 from jsonb_array_elements(performance_people('WEEK', date '2026-01-05', date '2026-01-11') -> 'people') p where p ->> 'name' in ('Perf One', 'Perf Two')),
  'a Department Head sees their Team Leads and the members');
select test.check((select count(*) = 0 from jsonb_array_elements(performance_people('WEEK', date '2026-01-05', date '2026-01-11') -> 'people') p where p ->> 'name' in ('Member C', 'TH Whatsbox')), 'but nobody from another department');
select test.check(performance_people('WEEK', date '2026-01-05', date '2026-01-11') -> 'department' ->> 'name' = 'Wabastore' and jsonb_array_length(performance_people('WEEK', date '2026-01-05', date '2026-01-11') -> 'teams') >= 2,
  'and the teams and the department');
select test.check((performance_report_refresh('TEAM', null, test.team('wabastore', 'Sales'), null, 'WEEK', date '2026-01-05', date '2026-01-11') ->> 'state') = 'CREATED', 'a Department Head generates a team report');
select test.check((performance_report_refresh('DEPARTMENT', null, null, test.dept('wabastore'), 'WEEK', date '2026-01-05', date '2026-01-11') ->> 'state') = 'CREATED', 'and the department report');
select test.must_fail($$select performance_report_refresh('MEMBER', test.id('tm_c'), null, null, 'WEEK', date '2026-01-05', date '2026-01-11')$$, 'a Department Head cannot reach another department''s member', 'FORBIDDEN');
select test.must_fail($$select performance_report_refresh('DEPARTMENT', null, null, test.dept('whatsbox'), 'WEEK', date '2026-01-05', date '2026-01-11')$$, 'nor another department', 'FORBIDDEN');
select test.must_fail($$select performance_report_refresh('MEMBER', test.id('dh_wab'), null, null, 'WEEK', date '2026-01-05', date '2026-01-11')$$, 'nor a Department Head''s own report', 'NOT_FOUND|FORBIDDEN');
select test.login('dh_wbx');
select test.check((select count(*) = 0 from performance_reports where department_id = test.dept('wabastore')), 'row-level security: another department''s head reads none of Wabastore''s reports');
select test.login('sa');
select test.check((select count(*) >= 3 from performance_reports), 'the Super Admin reads them (existing permissions)');
reset role;
set role anon;
select test.must_fail($$select performance_people('WEEK', date '2026-01-05', date '2026-01-11')$$, 'a signed-out visitor cannot call it', 'permission denied');
reset role;
set role authenticated;
select test.login('th_wab');
select test.must_fail($$select performance_schedule()$$, 'a user cannot run the scheduler', 'permission denied');
select test.must_fail($$insert into performance_reports (scope, department_id, subject_name, period_kind, period_start, period_end, metrics, fingerprint, trigger_kind) values ('DEPARTMENT', test.dept('wabastore'), 'x', 'WEEK', date '2026-01-05', date '2026-01-11', '{}', 'x', 'MANUAL')$$, 'nor write a report row directly', 'permission denied');
select test.must_fail($$select performance_report_refresh('MEMBER', test.id('pf_m1'), null, null, 'WEEK', date '2026-01-06', date '2026-01-12')$$, 'a week must run Monday to Sunday', 'Monday to Sunday');
select test.must_fail($$select performance_report_refresh('MEMBER', test.id('pf_m1'), null, null, 'CUSTOM', date '2026-01-05', date '2027-06-01')$$, 'a report covers at most a year', 'one year');

\echo '   no duplicates, history, narrative'
reset role;
select test.check((select version = 1 from performance_reports where subject_id = test.id('pf_m1') and period_kind = 'WEEK'), 'the first report is version 1');
set role authenticated;
select test.login('th_wab');
select test.check((performance_report_refresh('MEMBER', test.id('pf_m1'), null, null, 'WEEK', date '2026-01-05', date '2026-01-11') ->> 'state') = 'UNCHANGED', 'refreshing with unchanged tasks changes nothing');
reset role;
select test.check((select count(*) = 1 from performance_reports where subject_id = test.id('pf_m1') and period_kind = 'WEEK')
               and (select count(*) = 1 from performance_report_versions v join performance_reports r on r.id = v.report_id where r.subject_id = test.id('pf_m1') and r.period_kind = 'WEEK'),
  'no second report and no second version');
select performance_report_store_narrative(r.id, r.fingerprint, '{"summary":"s","observations":[],"improvementAreas":[],"recommendations":[],"limitations":[]}'::jsonb, 'RULES', 'NOT_CONFIGURED')
  from performance_reports r where subject_id = test.id('pf_m1') and period_kind = 'WEEK';
select test.check((select narrative ->> 'summary' = 's' and ai_status = 'NOT_CONFIGURED' and narrative_source = 'RULES' from performance_reports where subject_id = test.id('pf_m1') and period_kind = 'WEEK'), 'the written analysis is stored with its source');
select test.check(not (select performance_report_store_narrative(r.id, 'stale', '{"summary":"x"}'::jsonb, 'AI', 'OK') from performance_reports r where subject_id = test.id('pf_m1') and period_kind = 'WEEK'),
  'an analysis written for old figures is refused');
-- a task changes: the figures change, a new version is kept, the old analysis is not shown against the new figures
update work_tasks set status = 'COMPLETED', progress = 100, completed_at = timestamptz '2026-01-09 12:00+05:30' where title = 'PF open';
set role authenticated;
select test.login('th_wab');
select test.check((performance_report_refresh('MEMBER', test.id('pf_m1'), null, null, 'WEEK', date '2026-01-05', date '2026-01-11') ->> 'state') = 'UPDATED', 'when a task changed the report is updated');
reset role;
select test.check((select version = 2 and narrative is null and ai_status = 'PENDING' and (metrics -> 'tasks' ->> 'overdue')::int = 0 and (metrics -> 'tasks' ->> 'completed')::int = 4 from performance_reports where subject_id = test.id('pf_m1') and period_kind = 'WEEK'),
  'version 2 has the new figures and waits for a new analysis');
select test.check((select count(*) = 2 from performance_report_versions v join performance_reports r on r.id = v.report_id where r.subject_id = test.id('pf_m1') and r.period_kind = 'WEEK'), 'both versions are kept as history');
set role authenticated;
select test.login('th_wab');
select test.check((select jsonb_array_length(performance_report_history(r.id)) = 2 from performance_reports r where r.subject_id = test.id('pf_m1') and r.period_kind = 'WEEK'), 'the Team Lead reads the history');
select test.login('th_wbx');
select test.must_fail($$select performance_report_history((select id from performance_reports where subject_id = test.id('pf_m1') and period_kind = 'WEEK'))$$, 'another department cannot read it', 'NOT_FOUND');
reset role;

\echo '   the scheduler'
select test.check((select (performance_schedule(date '2026-01-07') ->> 'created')::int >= 1), 'the scheduler makes the weekly and monthly reports of everyone who has tasks');
select test.check((select count(*) = 0 from performance_reports where subject_id = test.id('pf_m2')), 'and none for a person without tasks (nothing is made up)');
select test.check((select (r ->> 'created')::int = 0 and (r ->> 'updated')::int = 0 from (select performance_schedule(date '2026-01-07') r) x), 'a second run creates and changes nothing (no duplicates)');
select test.check((select count(*) = (select count(distinct (scope, coalesce(subject_id, team_id, department_id), period_kind, period_start, period_end)) from performance_reports) from performance_reports), 'one current report per subject and period');
select test.check(jsonb_array_length(performance_reports_to_write(50, false)) >= 1, 'reports waiting for their analysis are listed for the server');
select test.check(not exists (select 1 from performance_reports where metrics::text ~* '@[a-z0-9-]+\.' ), 'no e-mail address is part of a report');
\echo '=== ALL PERFORMANCE MANAGEMENT TESTS PASSED ==='
