-- =============================================================================
-- Top Performers & Rankings (migration 20261214000100): scores from the real task and report records, rankings, trends, AI evaluation
-- storage, monthly recognition and who may see or decide what. Synthetic departments and people only.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 95. Top performers'
reset role;
\i supabase/migrations/20261214000100_top_performers.sql

delete from public.performer_recognitions where department_id in (select id from departments where slug like 'tp-%');
delete from public.performer_scores where department_id in (select id from departments where slug like 'tp-%');
delete from public.work_reports where department_id in (select id from departments where slug like 'tp-%');
delete from public.work_tasks where department_id in (select id from departments where slug like 'tp-%');
delete from auth.users where email like 'tp.%@example.com';
delete from test.users where name like 'tp\_%';
delete from teams where department_id in (select id from departments where slug like 'tp-%');
delete from departments where slug like 'tp-%';
insert into departments (slug, name) values ('tp-home1', 'TP Home One'), ('tp-home2', 'TP Home Two'), ('tp-a', 'TP Alpha'), ('tp-b', 'TP Beta');
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug like 'tp-%';
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug like 'tp-%';

create or replace function test.service() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;
create or replace function test.tpmk(p_name text, p_role text, p_dept text, p_team text default null) returns uuid language sql as $$
  select test.create_auth_user(p_name, 'tp.' || substr(p_name, 4) || '@example.com', jsonb_build_object('full_name', 'TP ' || substr(p_name, 4)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', p_role,
      'provisioned_department_id', test.dept(p_dept), 'provisioned_team_id', case when p_team is null then null else test.team(p_dept, p_team) end)))
$$;
grant execute on all functions in schema test to anon, authenticated;

\echo '   people: an Operations Head per department, a Department Head each, two Team Leads and five Team Members in Alpha'
select test.service(); select test.tpmk('tp_oh', 'DEPARTMENT_HEAD', 'tp-home1');
select test.service(); select test.tpmk('tp_oh2', 'DEPARTMENT_HEAD', 'tp-home2');
select test.service(); select test.tpmk('tp_dha', 'DEPARTMENT_HEAD', 'tp-a');
select test.service(); select test.tpmk('tp_dhb', 'DEPARTMENT_HEAD', 'tp-b');
select test.service(); select test.tpmk('tp_tl1', 'TEAM_HEAD', 'tp-a', 'Sales');
select test.service(); select test.tpmk('tp_tl2', 'TEAM_HEAD', 'tp-a', 'Support');
select test.service(); select test.tpmk('tp_m1', 'TEAM_MEMBER', 'tp-a', 'Sales');
select test.service(); select test.tpmk('tp_m2', 'TEAM_MEMBER', 'tp-a', 'Sales');
select test.service(); select test.tpmk('tp_m3', 'TEAM_MEMBER', 'tp-a', 'Sales');
select test.service(); select test.tpmk('tp_m4', 'TEAM_MEMBER', 'tp-a', 'Sales');
select test.service(); select test.tpmk('tp_m5', 'TEAM_MEMBER', 'tp-a', 'Support');
select test.service(); select test.tpmk('tp_mb', 'TEAM_MEMBER', 'tp-b', 'Sales');
select test.check((select count(*) = 12 from profiles where id in (select id from test.users where name like 'tp\_%') and status = 'ACTIVE'), 'the synthetic people exist and are active');
set role authenticated;
select test.login('sa');
select set_operations_head(test.id('tp_oh'), true, 'test');
select set_operations_head(test.id('tp_oh2'), true, 'test');
select operations_head_scope_set(test.id('tp_oh'), array[test.dept('tp-a')], array[test.dept('tp-a')]);
select operations_head_scope_set(test.id('tp_oh2'), array[test.dept('tp-b')], array[test.dept('tp-b')]);
reset role;

-- the month being ranked: last month (closed); days are counted from its first day, in India time like the scoring
select date_trunc('month', private.hr_today()::timestamp - interval '1 month')::date as pm \gset
select set_config('test.pm', :'pm', false);
create or replace function test.ts(p_day int, p_hour int default 10) returns timestamptz language sql stable as $$
  select (((current_setting('test.pm'))::date + p_day)::timestamp + p_hour * interval '1 hour') at time zone 'Asia/Kolkata' $$;
create or replace function test.pmday(p_day int) returns date language sql stable as $$ select (current_setting('test.pm'))::date + p_day $$;
create or replace function test.task(p_who text, p_title text, p_prio text, p_created_day int, p_due_day int, p_status text, p_done_day int default null, p_done_hours int default 24)
returns uuid language sql as $$
  insert into public.work_tasks (department_id, team_id, title, priority, due_date, assigned_by, assignee_id, status, progress, completed_at, created_at)
  select p.department_id, p.team_id, p_title, p_prio, case when p_due_day is null then null else test.pmday(p_due_day) end, test.id('tp_dha'), p.id, p_status,
         case when p_status = 'COMPLETED' then 100 else 0 end,
         case when p_done_day is null then null else test.ts(p_done_day, p_done_hours) end, test.ts(p_created_day, 9)
    from public.profiles p where p.id = test.id(p_who) returning id $$;
create or replace function test.report(p_who text, p_status text, p_from int, p_to int, p_revision int default 1, p_submitted_hours int default null, p_reviewed_hours int default null)
returns uuid language sql as $$
  insert into public.work_reports (kind, author_id, author_name, department_id, team_id, title, report_date, period_type, period_start, period_end, content, status, revision,
                                   submitted_at, reviewed_at, reviewed_by, review_comment)
  select case p.role when 'TEAM_HEAD' then 'TEAM_LEAD' else 'MEMBER' end, p.id, p.full_name, p.department_id, p.team_id, 'Report ' || p_from, test.pmday(p_to), 'CUSTOM',
         test.pmday(p_from), test.pmday(p_to), '{"workCompleted":"work"}'::jsonb, p_status, p_revision,
         test.ts(p_to, 17),
         case when p_reviewed_hours is null then null else test.ts(p_to, 17) + p_reviewed_hours * interval '1 hour' end,
         case when p_reviewed_hours is null then null else test.id('tp_tl1') end, case when p_status in ('REJECTED', 'REVISION_REQUIRED') then 'Please redo' else null end
    from public.profiles p where p.id = test.id(p_who) returning id $$;
create or replace function test.wrall() returns setof public.work_reports language sql stable security definer set search_path = '' as $$ select * from public.work_reports $$;
create or replace function test.tp_current_rec() returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.performer_recognitions where period_start = date_trunc('month', private.hr_today()::timestamp)::date and department_id = test.dept('tp-a') $$;
create temp table tp_view (j jsonb);
create temp table tp_before (s3 numeric, s2 numeric);
grant all on tp_view, tp_before to anon, authenticated, service_role;
create or replace function test.emp(p_name text) returns jsonb language sql stable as $$
  select e from tp_view v, jsonb_array_elements(v.j -> 'employees' || (v.j -> 'teamLeads')) e where e ->> 'name' = 'TP ' || substr(p_name, 4) $$;
grant execute on function test.emp(text) to anon, authenticated;
grant execute on all functions in schema test to anon, authenticated;
select test.check((select pm = date_trunc('month', pm::timestamp)::date from (select :'pm'::date as pm) x), 'the month under test starts on the first day');

\echo '   the records: tasks and reports of last month (and an earlier month for the trend)'
-- m1: six tasks, all on time, an approved report covering the whole month
select test.task('tp_m1', 'M1 task ' || g, (array['HIGH','HIGH','MEDIUM','MEDIUM','LOW','LOW'])[g], 1, 9 + g, 'COMPLETED', 7 + g, 24) from generate_series(1, 6) g;
select test.report('tp_m1', 'APPROVED', 0, 31, 1, 0, 5);
-- m2: three on time (H, M, L), one late (M), one High missed, one BLOCKED (an external dependency) and open
select test.task('tp_m2', 'M2 done H', 'HIGH', 1, 10, 'COMPLETED', 8);
select test.task('tp_m2', 'M2 done M', 'MEDIUM', 1, 11, 'COMPLETED', 9);
select test.task('tp_m2', 'M2 done L', 'LOW', 1, 12, 'COMPLETED', 10);
select test.task('tp_m2', 'M2 late M', 'MEDIUM', 1, 12, 'COMPLETED', 14);
select test.task('tp_m2', 'M2 missed H', 'HIGH', 1, 13, 'IN_PROGRESS');
select test.task('tp_m2', 'M2 blocked', 'HIGH', 1, 14, 'BLOCKED');
select test.report('tp_m2', 'APPROVED', 0, 6, 1, 0, 6);
select test.report('tp_m2', 'REJECTED', 7, 13, 1, 0, 8);
select test.report('tp_m2', 'SUBMITTED', 14, 20, 1, 0, null);
-- m3: the same task entered three times, one ticked off within two minutes, three real tasks (two on time, one missed); reports not approved
select test.task('tp_m3', 'Call lead A', 'MEDIUM', 1, 12, 'COMPLETED', 11) from generate_series(1, 3);
select test.task('tp_m3', 'Instant tick', 'HIGH', 3, 12, 'COMPLETED', 3, 10);
update public.work_tasks set completed_at = created_at + interval '2 minutes' where title = 'Instant tick';
select test.task('tp_m3', 'M3 real 1', 'MEDIUM', 1, 14, 'COMPLETED', 12);
select test.task('tp_m3', 'M3 real 2', 'MEDIUM', 1, 15, 'COMPLETED', 13);
select test.task('tp_m3', 'M3 real 3', 'MEDIUM', 1, 16, 'IN_PROGRESS');
select test.report('tp_m3', 'SUBMITTED', 0, 13, 1, 0, null);
-- m4: two tasks only
select test.task('tp_m4', 'M4 task ' || g, 'MEDIUM', 1, 10 + g, 'COMPLETED', 9 + g) from generate_series(1, 2) g;
-- m5 (Support team): four tasks, no reports
select test.task('tp_m5', 'M5 task ' || g, 'MEDIUM', 1, 10 + g, 'COMPLETED', 9 + g) from generate_series(1, 4) g;
-- team leads: two own tasks and an approved report each
select test.task('tp_tl1', 'TL1 own ' || g, 'MEDIUM', 1, 18 + g, 'COMPLETED', 17 + g) from generate_series(1, 2) g;
select test.task('tp_tl2', 'TL2 own 1', 'MEDIUM', 1, 20, 'COMPLETED', 19);
select test.report('tp_tl1', 'APPROVED', 0, 31, 1, 0, 5);
select test.report('tp_tl2', 'APPROVED', 0, 13, 2, 0, 5);
-- the member reports Team Lead one reviewed: two on time, one after 100 hours
select test.report('tp_m1', 'APPROVED', 14, 14, 1, 0, 5);
select test.report('tp_m1', 'APPROVED', 15, 15, 1, 0, 100);
-- the month before: m2 had a poor month (one of four tasks done)
select test.task('tp_m2', 'M2 old ' || g, 'MEDIUM', -25, -10 + g, case when g = 1 then 'COMPLETED' else 'IN_PROGRESS' end, case when g = 1 then -10 + g - 1 else null end) from generate_series(1, 4) g;

-- ---------------------------------------------------------------------------
\echo '   the scores come from the records'
select test.service();
select test.check((performer_schedule() -> 'departmentIds') @> to_jsonb(test.dept('tp-a')) and jsonb_array_length(performer_schedule() -> 'months') = 2, 'the daily run reports the departments and months it covered');
reset role;
select test.check((select count(*) from performer_scores where department_id = test.dept('tp-a') and period_start = :'pm'::date) = 7, 'the daily run scored the seven people of Alpha for last month');
select test.check((select count(*) from performer_scores where department_id = test.dept('tp-b') and period_start = :'pm'::date) = 1, 'and the one person of Beta');
select test.check((select count(*) from performer_scores s join performer_score_history h on h.score_id = s.id where s.department_id = test.dept('tp-a') and s.period_start = :'pm'::date) = 7, 'each score keeps a history version');

set role authenticated;
select test.login('tp_dha');
insert into tp_view select performers_department(:'pm'::date);
select test.check((select (j -> 'department' ->> 'name') = 'TP Alpha' and (j ->> 'canDecide')::boolean and (j ->> 'monthClosed')::boolean from tp_view), 'the Department Head sees their department for a closed month and may decide');
select test.check(jsonb_array_length((select j -> 'employees' from tp_view)) = 5 and jsonb_array_length((select j -> 'teamLeads' from tp_view)) = 2, 'five Team Members and two Team Leads are listed');
select test.check((test.emp('tp_m1') ->> 'status') = 'RANKED' and (test.emp('tp_m1') ->> 'rank') = '1' and (test.emp('tp_m1') ->> 'score')::numeric > 90, 'the member who did everything on time with approved reports is ranked first');
select test.check((test.emp('tp_m2') -> 'metrics' -> 'tasks' -> 'excluded' ->> 'blocked') = '1' and (test.emp('tp_m2') -> 'metrics' -> 'tasks' ->> 'judged') = '5', 'a BLOCKED task is neither counted as missed nor as late (5 judged, 1 excused)');
select test.check((test.emp('tp_m2') -> 'metrics' ->> 'weightedCompletionPct')::numeric = 72.7, 'completion is weighted by priority (8 of 11 points = 72.7%, not 4 of 5 tasks)');
select test.check((test.emp('tp_m3') -> 'metrics' -> 'tasks' -> 'excluded' ->> 'duplicates') = '2' and (test.emp('tp_m3') -> 'metrics' -> 'tasks' -> 'excluded' ->> 'instant') = '1', 'duplicate tasks count once and an instantly ticked task is not credited');
select test.check((test.emp('tp_m3') -> 'metrics' -> 'tasks' ->> 'judged') = '4', 'so the member has four judged tasks, not seven');
select test.check((test.emp('tp_m3') -> 'metrics' -> 'reports' ->> 'coveragePct')::numeric = 0 and (test.emp('tp_m3') -> 'metrics' -> 'reports' ->> 'pending') = '1', 'a submitted but unapproved report earns no coverage');
select test.check((test.emp('tp_m2') -> 'metrics' -> 'reports' ->> 'approved') = '1' and (test.emp('tp_m2') -> 'metrics' -> 'reports' ->> 'rejected') = '1'
  and (test.emp('tp_m2') -> 'metrics' -> 'reports' ->> 'coveredDays')::int < (test.emp('tp_m2') -> 'metrics' -> 'reports' ->> 'workingDays')::int, 'a rejected report does not cover any day');
select test.check((select (c ->> 'value')::numeric from jsonb_array_elements(test.emp('tp_m2') -> 'components') c where c ->> 'key' = 'report_quality') = 50, 'report quality: one approved first time (100) and one rejected (0) = 50');
select test.check((test.emp('tp_m4') ->> 'status') = 'INSUFFICIENT_DATA' and (test.emp('tp_m4') ->> 'rank') is null and (test.emp('tp_m4') ->> 'score') is null, 'a member with two tasks is Insufficient Data: no score, no rank');
select test.check(jsonb_array_length(test.emp('tp_m4') -> 'insufficientReasons') >= 1, 'with the reason');
select test.check((select array_agg((e ->> 'rank')::int order by (e ->> 'rank')::int) from tp_view v, jsonb_array_elements(v.j -> 'employees') e where e ->> 'status' = 'RANKED') = array[1, 2, 3, 4], 'the ranked members hold ranks 1 to 4 once each');
select test.check((test.emp('tp_m2') ->> 'trend') = 'IMPROVING' and (test.emp('tp_m2') ->> 'change')::numeric > 0 and (test.emp('tp_m1') ->> 'trend') is null, 'a member who did better than the month before is improving; one with no earlier month has no trend');
-- team lead one: reports reviewed within 48 hours, team tasks, distribution
select test.check((select (c ->> 'value')::numeric from jsonb_array_elements(test.emp('tp_tl1') -> 'components') c where c ->> 'key' = 'review_timeliness') =
  (select round(100.0 * count(*) filter (where reviewed_at is not null and reviewed_at - submitted_at <= interval '48 hours') /
          nullif(count(*) filter (where (reviewed_at is not null) or now() - submitted_at > interval '48 hours'), 0), 2) from test.wrall() r where r.kind = 'MEMBER' and r.team_id = test.team('tp-a', 'Sales')
          and (r.submitted_at at time zone 'Asia/Kolkata')::date between :'pm'::date and (:'pm'::date + interval '1 month - 1 day')::date), 'the Team Lead''s review timeliness is the share of team reports reviewed within 48 hours');
select test.check((test.emp('tp_tl1') ->> 'status') = 'RANKED' and (test.emp('tp_tl2') ->> 'status') = 'RANKED', 'both Team Leads are ranked on their own work and their team''s');
select test.check((select count(*) from jsonb_array_elements((select j -> 'teamLeads' from tp_view)) e where (e ->> 'rank') in ('1', '2')) = 2, 'and compared with each other (ranks 1 and 2)');
select test.check((select (j -> 'summary' ->> 'ranked')::int = 6 and (j -> 'summary' ->> 'insufficient')::int = 1 and (j -> 'summary' ->> 'avgScore')::numeric > 0 from tp_view), 'the department summary counts six ranked and one with insufficient data');
select test.check(jsonb_array_length((select j -> 'monthly' from tp_view)) >= 1 and (select j -> 'methodology' -> 'member' from tp_view) is not null, 'the monthly comparison and the methodology come with it');

\echo '   rankings follow the records'
insert into tp_before select (test.emp('tp_m3') ->> 'score')::numeric, (test.emp('tp_m2') ->> 'score')::numeric;
reset role;
-- an approved report for m3 covering the month and the missed High task of m2 finally done on time
update work_reports set status = 'APPROVED', reviewed_at = test.ts(5, 9), reviewed_by = test.id('tp_tl1'), period_start = test.pmday(0), period_end = test.pmday(31)
 where author_id = test.id('tp_m3');
update work_tasks set status = 'COMPLETED', progress = 100, completed_at = test.ts(12, 11) where assignee_id = test.id('tp_m2') and title = 'M2 missed H';
set role authenticated;
select test.login('tp_dha');
delete from tp_view;
insert into tp_view select performers_department(:'pm'::date);
select test.check((test.emp('tp_m3') ->> 'score')::numeric > (select s3 from tp_before), 'approving the report raised the score');
select test.check((test.emp('tp_m2') ->> 'score')::numeric > (select s2 from tp_before), 'and finishing the missed task raised the other one');
reset role;
select test.check((select version = 2 from performer_scores where profile_id = test.id('tp_m3') and period_start = :'pm'::date), 'the new figures made version 2 of the score');
select test.check((select count(*) = 2 from performer_score_history h join performer_scores s on s.id = h.score_id where s.profile_id = test.id('tp_m3') and s.period_start = :'pm'::date), 'and the first version is kept in the history');
set role authenticated;
select test.login('tp_dha');
select performers_department(:'pm'::date);
reset role;
select test.check((select version = 2 from performer_scores where profile_id = test.id('tp_m3') and period_start = :'pm'::date), 'asking again changes nothing when the records did not change');

-- ---------------------------------------------------------------------------
\echo '   who may see what'
set role authenticated;
select test.login('tp_dhb');
select test.must_fail($$select performers_department(date_trunc('month', private.hr_today()::timestamp - interval '1 month')::date, test.dept('tp-a'))$$, 'the Department Head of another department cannot open Alpha', 'FORBIDDEN');
select test.check((performers_department(:'pm'::date) -> 'department' ->> 'name') = 'TP Beta', 'and sees only their own department');
select test.must_fail($$select performers_company()$$, 'a Department Head cannot open the company view', 'FORBIDDEN');
select test.login('tp_tl1');
select test.must_fail($$select performers_department()$$, 'a Team Lead cannot open the rankings', 'FORBIDDEN');
select test.login('tp_m1');
select test.must_fail($$select performers_department()$$, 'a Team Member cannot open the rankings', 'FORBIDDEN');
select test.must_fail($$select count(*) from performer_scores$$, 'the tables have no direct access', 'permission denied');
select test.must_fail($$select count(*) from performer_recognitions$$, 'not even the recognition table', 'permission denied');
select test.login('tp_oh');
select test.must_fail($$select performers_department()$$, 'an Operations Head must name a department', 'department');
select test.check((performers_department(:'pm'::date, test.dept('tp-a')) ->> 'canDecide') = 'false', 'an Operations Head reads their department but cannot decide');
select test.must_fail($$select performers_department(date_trunc('month', private.hr_today()::timestamp - interval '1 month')::date, test.dept('tp-b'))$$, 'and cannot open a department they do not manage', 'FORBIDDEN');
select test.check((select jsonb_array_length(performers_company(:'pm'::date) -> 'departments')) = 1, 'the company view of an Operations Head holds only their departments');
select test.login('sa');
select test.check((select jsonb_array_length(performers_company(:'pm'::date) -> 'departments')) >= 2 and (performers_company(:'pm'::date) -> 'topEmployees') is not null, 'the Super Admin sees every department and the top employees across them');
select test.check((performers_department(:'pm'::date, test.dept('tp-b')) ->> 'canDecide') = 'false', 'and cannot decide either');
select test.login('tp_dha');
select test.must_fail($$select performers_department(date_trunc('month', private.hr_today()::timestamp + interval '1 month')::date)$$, 'a future month is refused', 'Choose a month');
select test.must_fail($$select performers_department(date_trunc('month', private.hr_today()::timestamp - interval '1 month')::date + 3)$$, 'and so is a date that is not the first of a month', 'Choose a month');

-- ---------------------------------------------------------------------------
\echo '   monthly recognition: the system recommends, the Department Head decides'
reset role;
select test.check((select count(*) from performer_recognitions where department_id = test.dept('tp-a') and period_start = :'pm'::date and status = 'RECOMMENDED') >= 7, 'recommendations were prepared (employee of the month, top three, best Team Lead, and more)');
select test.check((select p.full_name = 'TP m1' from performer_recognitions r join profiles p on p.id = r.profile_id where r.department_id = test.dept('tp-a') and r.period_start = :'pm'::date and r.award_type = 'EMPLOYEE_OF_MONTH'), 'Employee of the Month is the top ranked member');
select test.check((select count(*) = 3 from performer_recognitions where department_id = test.dept('tp-a') and period_start = :'pm'::date and award_type = 'TOP_EMPLOYEE'), 'three Top Employee places');
select test.check((select p.full_name = 'TP m2' from performer_recognitions r join profiles p on p.id = r.profile_id where r.department_id = test.dept('tp-a') and r.period_start = :'pm'::date and r.award_type = 'MOST_IMPROVED'), 'Most Improved is the member whose score went up from last month');
select test.check((select s.rank = 1 from performer_recognitions r join performer_scores s on s.profile_id = r.profile_id and s.period_start = r.period_start where r.department_id = test.dept('tp-a') and r.period_start = :'pm'::date and r.award_type = 'BEST_TEAM_LEAD'), 'Best Team Lead is the top ranked Team Lead');
select test.check((select count(*) = 0 from performer_recognitions where status <> 'RECOMMENDED'), 'nothing is official yet');
select test.check((select count(*) = 1 from notifications where type = 'TOP_PERFORMERS_READY' and recipient_id = test.id('tp_dha')), 'the daily run told the Department Head the recommendations are ready (once)');
select test.check((select count(*) = 0 from notifications where type = 'TOP_PERFORMERS_READY' and recipient_id in (test.id('tp_dhb'), test.id('tp_m1'), test.id('tp_tl1'))), 'and nobody else');
create temp table tp_rec as select id, award_type, place, profile_id from performer_recognitions where department_id = test.dept('tp-a') and period_start = :'pm'::date;
grant all on tp_rec to anon, authenticated, service_role;
set role authenticated;
select test.login('tp_oh');
select test.must_fail($$select performer_recognition_decide((select id from tp_rec where award_type = 'EMPLOYEE_OF_MONTH'), 'APPROVE', null)$$, 'an Operations Head cannot approve', 'FORBIDDEN');
select test.login('sa');
select test.must_fail($$select performer_recognition_decide((select id from tp_rec where award_type = 'EMPLOYEE_OF_MONTH'), 'APPROVE', null)$$, 'nor can the Super Admin', 'FORBIDDEN');
select test.login('tp_dhb');
select test.must_fail($$select performer_recognition_decide((select id from tp_rec where award_type = 'EMPLOYEE_OF_MONTH'), 'APPROVE', null)$$, 'the Department Head of another department cannot', 'NOT_FOUND');
select test.login('tp_tl1');
select test.must_fail($$select performer_recognition_decide((select id from tp_rec where award_type = 'EMPLOYEE_OF_MONTH'), 'APPROVE', null)$$, 'a Team Lead cannot', 'FORBIDDEN');
select test.login('tp_dha');
select test.must_fail($$select performer_recognition_decide((select id from tp_rec where award_type = 'EMPLOYEE_OF_MONTH'), 'MAYBE', null)$$, 'the decision must be approve or reject', 'approve or reject');
select test.must_fail($$select performer_recognition_decide((select id from tp_rec where award_type = 'MOST_IMPROVED'), 'REJECT', '')$$, 'a rejection needs a reason', 'reason');
select test.check((performer_recognition_decide((select id from tp_rec where award_type = 'EMPLOYEE_OF_MONTH'), 'APPROVE', 'Well deserved') ->> 'status') = 'APPROVED', 'the Department Head approves Employee of the Month');
select test.check((performer_recognition_decide((select id from tp_rec where award_type = 'MOST_IMPROVED'), 'REJECT', 'Prefer to wait one more month') ->> 'status') = 'REJECTED', 'and rejects Most Improved with a reason');
select test.must_fail($$select performer_recognition_decide((select id from tp_rec where award_type = 'EMPLOYEE_OF_MONTH'), 'REJECT', 'changed my mind')$$, 'a decided recommendation cannot be decided again', 'already decided');
reset role;
select test.check((select status = 'APPROVED' and decided_by = test.id('tp_dha') and decided_at is not null and decision_note = 'Well deserved' from performer_recognitions where id = (select id from tp_rec where award_type = 'EMPLOYEE_OF_MONTH')), 'who decided, when and why are stored');
select test.check((select count(*) = 2 from performer_recognition_events where recognition_id = (select id from tp_rec where award_type = 'EMPLOYEE_OF_MONTH')), 'the history holds the recommendation and the approval');
select test.check((select count(*) = 1 from notifications where type = 'RECOGNITION_APPROVED' and recipient_id = test.id('tp_m1')), 'the winner is told only after the approval');
select test.check((select count(*) = 1 from audit_logs where action = 'PERFORMER_RECOGNITION_APPROVED' and entity_id = (select id from tp_rec where award_type = 'EMPLOYEE_OF_MONTH')), 'and the decision is audited');
-- decided rows are never rewritten by a later recalculation, even when the figures change
update work_tasks set status = 'IN_PROGRESS', completed_at = null where assignee_id = test.id('tp_m1') and title = 'M1 task 1';
set role authenticated;
select test.login('tp_dha');
select performers_department(:'pm'::date);
reset role;
select test.check((select status = 'APPROVED' and profile_id = test.id('tp_m1') from performer_recognitions where id = (select id from tp_rec where award_type = 'EMPLOYEE_OF_MONTH')), 'an approved award stays as it was approved');
select test.check((select status = 'REJECTED' from performer_recognitions where id = (select id from tp_rec where award_type = 'MOST_IMPROVED')), 'and a rejected one stays rejected');
-- a month that is not over cannot be decided
insert into performer_recognitions (department_id, period_start, award_type, place, profile_id, score, value, reason)
  select test.dept('tp-a'), date_trunc('month', private.hr_today()::timestamp)::date, 'EMPLOYEE_OF_MONTH', 1, test.id('tp_m1'), 80, 80, 'test';
set role authenticated;
select test.login('tp_dha');
select test.must_fail($$select performer_recognition_decide((select test.tp_current_rec()), 'APPROVE', null)$$, 'a month that has not ended cannot be decided', 'not over');
reset role;

-- ---------------------------------------------------------------------------
\echo '   AI evaluations: stored per version of the figures, service role only'
set role authenticated;
select test.login('tp_dha');
select test.must_fail($$select performer_evaluations_to_write(test.dept('tp-a'), date_trunc('month', private.hr_today()::timestamp - interval '1 month')::date)$$, 'the evaluation queue is not open to users', 'permission denied');
select test.must_fail($$select performer_schedule()$$, 'nor is the daily run', 'permission denied');
reset role;
select test.service();
create temp table tp_todo as select jsonb_array_elements(performer_evaluations_to_write(test.dept('tp-a'), :'pm'::date, 50, false)) as j;
grant all on tp_todo to anon, authenticated, service_role;
select test.check((select count(*) = 6 from tp_todo), 'six ranked people need an evaluation (an Insufficient Data person does not)');
select test.check((select bool_and(j ? 'components' and j ? 'metrics' and j ? 'department') from tp_todo), 'each carries the real figures and the department average to compare with');
select test.check((select j ->> 'feedback' like '%Please redo%' from tp_todo where (j ->> 'score')::numeric = (select score from performer_scores where profile_id = test.id('tp_m2') and period_start = :'pm'::date)), 'the Team Lead''s written feedback on the reports goes with the figures');
select test.check(not performer_evaluation_store((select (j ->> 'scoreId')::uuid from tp_todo limit 1), 'stale-fingerprint', '{"summary":"x"}', 'RULES', 'NOT_CONFIGURED'), 'a write for old figures is refused');
select test.check(performer_evaluation_store((select (j ->> 'scoreId')::uuid from tp_todo limit 1), (select j ->> 'fingerprint' from tp_todo limit 1),
  '{"summary":"Strong month","strengths":["On time"],"improvementAreas":[],"whyRanked":"Above the department average"}', 'AI', 'OK', 'test-model'), 'the evaluation for the current figures is stored');
select test.check((select count(*) = 5 from jsonb_array_elements(performer_evaluations_to_write(test.dept('tp-a'), :'pm'::date, 50, false))), 'and leaves five to write');
select test.check((select ai_status = 'OK' and source = 'AI' and ai_model = 'test-model' and attempts = 1 from performer_evaluations limit 1), 'the log records the source, the model and the attempt');
set role authenticated;
select test.login('tp_dha');
select test.check((select count(*) = 1 from jsonb_array_elements(performers_department(:'pm'::date) -> 'employees' || (performers_department(:'pm'::date) -> 'teamLeads')) e where e -> 'evaluation' ->> 'summary' = 'Strong month' and (e -> 'evaluation' ->> 'current')::boolean), 'the Department Head sees the explanation on that person''s card');
reset role;
\echo '   top performers tests done'
